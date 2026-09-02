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

export type ChannelResult =
  | "sent"
  | "not_configured"
  | "no_recipients"
  | "failed";

export interface AlertOutcome {
  email: ChannelResult;
  slack: ChannelResult;
  recipients: string[];
  errors: string[];
}

/** True if at least one channel actually delivered something. */
export function alertDelivered(outcome: AlertOutcome): boolean {
  return outcome.email === "sent" || outcome.slack === "sent";
}

/** True if any channel is configured well enough to have been tried. */
export function alertAttempted(outcome: AlertOutcome): boolean {
  return (
    outcome.email === "sent" ||
    outcome.email === "failed" ||
    outcome.slack === "sent" ||
    outcome.slack === "failed"
  );
}

/** A one-line explanation suitable for logs or an admin banner. */
export function describeOutcome(outcome: AlertOutcome): string {
  const parts = [`email=${outcome.email}`, `slack=${outcome.slack}`];
  if (outcome.recipients.length > 0) {
    parts.push(`to=${outcome.recipients.join(",")}`);
  }
  if (outcome.errors.length > 0) {
    parts.push(`errors=${outcome.errors.join(" | ")}`);
  }
  return parts.join(" ");
}

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

function parseEmails(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

/**
 * Who to email about these types: the addresses on the packaging types
 * themselves, falling back to PACKAGING_ALERT_TO. The fallback exists because
 * leaving the per-type field blank is the easiest way to end up with alerts
 * that appear configured but reach nobody.
 */
function resolveRecipients(types: PackagingType[]): string[] {
  const perType = types.flatMap((type) => parseEmails(type.notifyEmails));
  if (perType.length > 0) {
    return [...new Set(perType)];
  }
  return [...new Set(parseEmails(process.env.PACKAGING_ALERT_TO))];
}

async function sendEmail(
  recipients: string[],
  subject: string,
  lines: string[],
  outcome: AlertOutcome
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PACKAGING_ALERT_FROM;

  if (!apiKey || !from) {
    outcome.email = "not_configured";
    return;
  }
  if (recipients.length === 0) {
    outcome.email = "no_recipients";
    return;
  }

  try {
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
      outcome.email = "failed";
      outcome.errors.push(
        `Resend ${response.status}: ${(await response.text()).slice(0, 300)}`
      );
      return;
    }

    outcome.email = "sent";
  } catch (error) {
    outcome.email = "failed";
    outcome.errors.push(`Resend: ${(error as Error).message}`);
  }
}

async function sendSlack(
  subject: string,
  lines: string[],
  outcome: AlertOutcome
): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    outcome.slack = "not_configured";
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: [`*${subject}*`, ...lines.map((line) => `• ${line}`)].join("\n"),
      }),
    });

    if (!response.ok) {
      outcome.slack = "failed";
      outcome.errors.push(
        `Slack ${response.status}: ${(await response.text()).slice(0, 300)}`
      );
      return;
    }

    outcome.slack = "sent";
  } catch (error) {
    outcome.slack = "failed";
    outcome.errors.push(`Slack: ${(error as Error).message}`);
  }
}

async function deliver(
  shopDomain: string,
  types: PackagingType[]
): Promise<AlertOutcome> {
  const outcome: AlertOutcome = {
    email: "not_configured",
    slack: "not_configured",
    recipients: resolveRecipients(types),
    errors: [],
  };

  const subject = alertSubject(shopDomain, types);
  const lines = alertLines(types);

  await Promise.all([
    sendEmail(outcome.recipients, subject, lines, outcome),
    sendSlack(subject, lines, outcome),
  ]);

  return outcome;
}

/**
 * Send a low-stock alert regardless of threshold or cooldown, so the merchant
 * can verify their configuration without waiting to actually run out of boxes.
 * Never stamps lastNotifiedAt — a test must not suppress a real alert.
 */
export async function sendTestAlert(
  shopDomain: string,
  packagingTypeId: string
): Promise<AlertOutcome | null> {
  const type = await prisma.packagingType.findFirst({
    where: { id: packagingTypeId, shopDomain },
  });
  if (!type) {
    return null;
  }

  const outcome = await deliver(shopDomain, [type]);
  console.log(`[packaging] Test alert for ${shopDomain}: ${describeOutcome(outcome)}`);
  return outcome;
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

    const outcome = await deliver(shopDomain, low);
    const summary = alertLines(low).join("; ");

    if (!alertAttempted(outcome)) {
      // Nothing was even tried, so there is no cooldown to start. Stamping here
      // would silently suppress alerts for hours after the configuration is
      // fixed, which is precisely the failure this branch exists to avoid.
      console.warn(
        `[packaging] Low stock for ${shopDomain} but NO alert channel is usable ` +
          `(${describeOutcome(outcome)}). Set RESEND_API_KEY + PACKAGING_ALERT_FROM ` +
          `and either a per-type notify email or PACKAGING_ALERT_TO, ` +
          `and/or SLACK_WEBHOOK_URL. Low: ${summary}`
      );
      return;
    }

    // Stamped even when a send failed: the admin banner still surfaces the
    // shortage, and retrying on every order would just repeat the failure.
    await prisma.packagingType.updateMany({
      where: { id: { in: low.map((type) => type.id) } },
      data: { lastNotifiedAt: new Date() },
    });

    if (alertDelivered(outcome)) {
      console.log(
        `[packaging] Low-stock alert sent for ${shopDomain}: ${summary} (${describeOutcome(outcome)})`
      );
    } else {
      console.error(
        `[packaging] Low-stock alert FAILED for ${shopDomain}: ${summary} (${describeOutcome(outcome)})`
      );
    }
  } catch (error) {
    console.error("[packaging] checkLowStock failed:", error);
  }
}
