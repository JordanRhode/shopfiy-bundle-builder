import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import prisma from "../db.server";
import { createPackagingType } from "../models/Packaging.server";
import { checkLowStock, sendTestAlert } from "./packagingNotifications.server";

const SHOP = "alerts-itest.myshopify.com";

const ALERT_ENV = [
  "RESEND_API_KEY",
  "PACKAGING_ALERT_FROM",
  "PACKAGING_ALERT_TO",
  "SLACK_WEBHOOK_URL",
] as const;

function clearAlertEnv() {
  for (const key of ALERT_ENV) {
    delete process.env[key];
  }
}

async function seedLowBox(notifyEmails?: string) {
  return createPackagingType({
    shopDomain: SHOP,
    name: "8-count box",
    onHand: 2,
    lowThreshold: 5,
    notifyEmails,
    assignments: [],
  });
}

async function stampOf(id: string) {
  const row = await prisma.packagingType.findUniqueOrThrow({ where: { id } });
  return row.lastNotifiedAt;
}

beforeEach(async () => {
  clearAlertEnv();
  vi.restoreAllMocks();
  await prisma.packagingType.deleteMany({ where: { shopDomain: SHOP } });
});

afterAll(async () => {
  clearAlertEnv();
  await prisma.packagingType.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.$disconnect();
});

describe("when no alert channel is configured", () => {
  it("does not start a cooldown, so alerts work once configured", async () => {
    const box = await seedLowBox("ops@example.com");

    await checkLowStock(SHOP, [box.id]);

    // The original bug: stamping here suppressed every alert for 12 hours
    // after the merchant fixed their configuration.
    expect(await stampOf(box.id)).toBeNull();

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/x";

    await checkLowStock(SHOP, [box.id]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await stampOf(box.id)).not.toBeNull();
  });

  it("warns loudly rather than failing silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const box = await seedLowBox();

    await checkLowStock(SHOP, [box.id]);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("NO alert channel is usable");
  });
});

describe("email recipients", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.PACKAGING_ALERT_FROM = "alerts@example.com";
  });

  it("emails the addresses set on the packaging type", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const box = await seedLowBox("ops@example.com, buyer@example.com");

    await checkLowStock(SHOP, [box.id]);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.to).toEqual(["ops@example.com", "buyer@example.com"]);
  });

  it("falls back to PACKAGING_ALERT_TO when the type has no addresses", async () => {
    // Leaving the per-type field blank is the easy way to end up with alerts
    // that look configured but reach nobody.
    process.env.PACKAGING_ALERT_TO = "fallback@example.com";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const box = await seedLowBox();

    await checkLowStock(SHOP, [box.id]);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.to).toEqual(["fallback@example.com"]);
  });

  it("reports no_recipients when there is nobody to email", async () => {
    const box = await seedLowBox();
    const outcome = await sendTestAlert(SHOP, box.id);
    expect(outcome?.email).toBe("no_recipients");
  });
});

describe("delivery failures", () => {
  beforeEach(() => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/x";
  });

  it("starts the cooldown anyway, to avoid hammering a broken provider", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 500 })
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const box = await seedLowBox();

    await checkLowStock(SHOP, [box.id]);

    expect(await stampOf(box.id)).not.toBeNull();
    expect(error).toHaveBeenCalled();
  });

  it("survives a provider timeout without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("aborted", "TimeoutError")
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const box = await seedLowBox();

    // A notification outage must never fail the webhook, because Shopify
    // removes subscriptions that keep failing.
    await expect(checkLowStock(SHOP, [box.id])).resolves.toBeUndefined();
  });
});

describe("test alert", () => {
  it("sends regardless of threshold and never starts a cooldown", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/x";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const healthy = await createPackagingType({
      shopDomain: SHOP,
      name: "Well stocked",
      onHand: 500,
      lowThreshold: 5,
      assignments: [],
    });

    const outcome = await sendTestAlert(SHOP, healthy.id);

    expect(outcome?.slack).toBe("sent");
    expect(fetchMock).toHaveBeenCalledOnce();
    // A test must not suppress a subsequent real alert.
    expect(await stampOf(healthy.id)).toBeNull();
  });

  it("returns null for another shop's packaging type", async () => {
    const box = await seedLowBox();
    expect(await sendTestAlert("attacker.myshopify.com", box.id)).toBeNull();
  });
});
