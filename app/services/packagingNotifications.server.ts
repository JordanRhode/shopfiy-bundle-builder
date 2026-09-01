import prisma from "../db.server";
import type { PackagingType } from "@prisma/client";

/**
 * Hours to wait before re-alerting on a packaging type that is still low.
 * Without this you get one email per order once you dip below the threshold.
 */
const COOLDOWN_HOURS = Number(process.env.PACKAGING_ALERT_COOLDOWN_HOURS ?? 12);

/**
 * Alerts are sent inline from the webhook handler, and Shopify expects a
 * response within 5 seconds — it retries on timeout and eventually removes a
 * subscription that keeps failing. Cap each provider call well inside that
 * budget: a missed email is recoverable, a deleted subscription is not.
 */
const SEND_TIMEOUT_MS = 2500;

function cooldownElapsed(lastNotifiedAt: Date | null): boolean {
  if (!lastNotifiedAt) {
    return true;
  }
  const elapsedMs = Date.now() - lastNotifiedAt.getTime();
  return elapsedMs >= COOLDOWN_HOURS * 60 * 60 * 1000;
}

function alertSubject(shopDomain: string, types: PackagingType[]): string {
  if (types.length === 1) {
    return `Low packaging stock: ${types[0].name} (${types[0].onHand} left) — ${shopDomain}`;
  }
  return `Low packaging stock: ${types.length} items — ${shopDomain}`;
}

function alertLines(types: PackagingType[]): string[] {
  return types.map(
    (type) =>
      `${type.name}${type.sku ? ` (${type.sku})` : ""}: ${type.onHand} on hand, threshold ${type.lowThreshold}`
  );
}

async function sendEmail(
  recipients: string[],
  subject: string,
  lines: string[]
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PACKAGING_ALERT_FROM;

  if (!apiKey || !from || recipients.length === 0) {
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject,
      text: [
        "The following packaging is at or below its reorder threshold:",
        "",
        ...lines.map((line) => `  - ${line}`),
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Resend responded ${response.status}: ${await response.text()}`
    );
  }
}

async function sendSlack(subject: string, lines: string[]): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: [`*${subject}*`, ...lines.map((line) => `• ${line}`)].join("\n"),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Slack responded ${response.status}: ${await response.text()}`
    );
  }
}

/**
 * Alert on any of the given packaging types that have fallen to or below their
 * threshold, then stamp lastNotifiedAt so the cooldown applies.
 *
 * Types that have climbed back above the threshold get lastNotifiedAt cleared,
 * so the next dip alerts straight away instead of waiting out a stale cooldown.
 *
 * Never throws: a notification outage must not fail the webhook and trigger a
 * Shopify retry.
 */
export async function checkLowStock(
  shopDomain: string,
  packagingTypeIds: string[]
): Promise<void> {
  if (packagingTypeIds.length === 0) {
    return;
  }

  try {
    const types = await prisma.packagingType.findMany({
      where: { id: { in: packagingTypeIds }, shopDomain, active: true },
    });

    const recovered = types.filter(
      (type) => type.onHand > type.lowThreshold && type.lastNotifiedAt !== null
    );
    if (recovered.length > 0) {
      await prisma.packagingType.updateMany({
        where: { id: { in: recovered.map((type) => type.id) } },
        data: { lastNotifiedAt: null },
      });
    }

    const low = types.filter(
      (type) =>
        type.onHand <= type.lowThreshold && cooldownElapsed(type.lastNotifiedAt)
    );
    if (low.length === 0) {
      return;
    }

    const subject = alertSubject(shopDomain, low);
    const lines = alertLines(low);

    const recipients = [
      ...new Set(
        low
          .flatMap((type) => (type.notifyEmails ?? "").split(","))
          .map((email) => email.trim())
          .filter(Boolean)
      ),
    ];

    const results = await Promise.allSettled([
      sendEmail(recipients, subject, lines),
      sendSlack(subject, lines),
    ]);

    for (const result of results) {
      if (result.status === "rejected") {
        console.error("[packaging] Low-stock alert failed:", result.reason);
      }
    }

    // Stamped even on a send failure: the in-app banner still surfaces the
    // shortage, and retrying every order would just repeat the same failure.
    await prisma.packagingType.updateMany({
      where: { id: { in: low.map((type) => type.id) } },
      data: { lastNotifiedAt: new Date() },
    });

    console.log(
      `[packaging] Low-stock alert for ${shopDomain}: ${lines.join("; ")}`
    );
  } catch (error) {
    console.error("[packaging] checkLowStock failed:", error);
  }
}
