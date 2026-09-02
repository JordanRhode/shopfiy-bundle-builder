import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { LedgerReason } from "./Packaging.server";

const WILDCARD_VARIANT = "*";

/** A line item as it arrives on an order/refund webhook payload. */
export interface WebhookLineItem {
  product_id?: number | string | null;
  variant_id?: number | string | null;
  quantity?: number | null;
}

interface PendingDelta {
  packagingTypeId: string;
  delta: number;
}

/**
 * Webhook payloads carry numeric ids; the admin UI stores GIDs from the
 * resource picker. Normalize to GID so the two agree.
 */
function toGid(kind: "Product" | "ProductVariant", raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const value = String(raw);
  return value.startsWith("gid://") ? value : `gid://shopify/${kind}/${value}`;
}

/** The assignment fields the matcher actually needs. */
export interface MatchableAssignment {
  packagingTypeId: string;
  shopifyProductId: string;
  shopifyVariantId: string;
  unitsPerItem: number;
}

/**
 * Work out how much packaging a set of line items consumes.
 *
 * A variant-specific assignment wins over the product-level wildcard for the
 * same packaging type, so "every mug uses a 4-count box, except the big one
 * which uses an 8-count" resolves the way a merchant would expect.
 *
 * Pure so it can be exercised without a database.
 */
export function computeUsage(
  lineItems: WebhookLineItem[],
  assignments: MatchableAssignment[]
): Map<string, number> {
  const byProduct = new Map<string, MatchableAssignment[]>();
  for (const assignment of assignments) {
    const list = byProduct.get(assignment.shopifyProductId) ?? [];
    list.push(assignment);
    byProduct.set(assignment.shopifyProductId, list);
  }

  const usage = new Map<string, number>();

  for (const item of lineItems) {
    const productGid = toGid("Product", item.product_id);
    const variantGid = toGid("ProductVariant", item.variant_id);
    const quantity = Number(item.quantity ?? 0);

    if (!productGid || quantity <= 0) {
      continue;
    }

    const candidates = byProduct.get(productGid);
    if (!candidates) {
      continue;
    }

    // Per packaging type, prefer an exact variant match over the wildcard.
    const chosen = new Map<string, MatchableAssignment>();
    for (const assignment of candidates) {
      const isExact =
        variantGid !== null && assignment.shopifyVariantId === variantGid;
      const isWildcard = assignment.shopifyVariantId === WILDCARD_VARIANT;

      if (!isExact && !isWildcard) {
        continue;
      }

      const current = chosen.get(assignment.packagingTypeId);
      if (!current || isExact) {
        chosen.set(assignment.packagingTypeId, assignment);
      }
    }

    for (const [packagingTypeId, assignment] of chosen) {
      const units = assignment.unitsPerItem * quantity;
      usage.set(packagingTypeId, (usage.get(packagingTypeId) ?? 0) + units);
    }
  }

  return usage;
}

/**
 * Load this shop's assignments for the products on these line items, then
 * match them. Only assignments on active packaging types are considered.
 */
export async function resolvePackagingUsage(
  shopDomain: string,
  lineItems: WebhookLineItem[]
): Promise<Map<string, number>> {
  const productGids = new Set<string>();
  for (const item of lineItems) {
    const gid = toGid("Product", item.product_id);
    if (gid) {
      productGids.add(gid);
    }
  }

  if (productGids.size === 0) {
    return new Map();
  }

  const assignments = await prisma.packagingAssignment.findMany({
    where: {
      shopDomain,
      shopifyProductId: { in: [...productGids] },
      packagingType: { active: true },
    },
  });

  return computeUsage(lineItems, assignments);
}

/**
 * Two 32-bit keys for pg_advisory_xact_lock, derived from a string.
 * A collision would only make two unrelated orders take turns, which is
 * harmless.
 */
function advisoryLockKeys(value: string): [number, number] {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  return [h1 | 0, h2 | 0];
}

async function computeOutstanding(
  client: Prisma.TransactionClient,
  shopDomain: string,
  shopifyOrderId: string
): Promise<Map<string, number>> {
  const grouped = await client.packagingLedgerEntry.groupBy({
    by: ["packagingTypeId"],
    where: { shopDomain, shopifyOrderId },
    _sum: { delta: true },
  });

  const outstanding = new Map<string, number>();
  for (const row of grouped) {
    const net = -(row._sum.delta ?? 0);
    if (net > 0) {
      outstanding.set(row.packagingTypeId, net);
    }
  }
  return outstanding;
}

/**
 * Serialize every packaging mutation for one order, then apply the planned
 * deltas atomically.
 *
 * The lock is what makes cancellation safe. Cancelling an order that carried a
 * refund makes Shopify fire refunds/create and orders/cancelled at the same
 * moment; without serialization both read the same outstanding balance before
 * either writes, and each restocks the full amount. Capping alone does not
 * help, because both see the uncapped balance.
 *
 * `plan` receives the outstanding balance read inside the lock, so restocks can
 * cap against a value that cannot change underneath them.
 */
async function applyOrderDeltas(
  shopDomain: string,
  shopifyOrderId: string,
  reason: string,
  sourceId: string,
  note: string | undefined,
  plan: (outstanding: Map<string, number>) => PendingDelta[]
): Promise<string[]> {
  const [key1, key2] = advisoryLockKeys(`${shopDomain}:${shopifyOrderId}`);

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key1}::int4, ${key2}::int4)`;

      const outstanding = await computeOutstanding(tx, shopDomain, shopifyOrderId);
      const applied: string[] = [];

      for (const { packagingTypeId, delta } of plan(outstanding)) {
        if (delta === 0) {
          continue;
        }

        // Checked rather than caught: a unique violation inside an interactive
        // transaction aborts the whole transaction, so the P2002 could not be
        // swallowed here. Holding the advisory lock means no concurrent writer
        // can slip in between this check and the insert. The unique index
        // stays as a backstop.
        const existing = await tx.packagingLedgerEntry.findFirst({
          where: { packagingTypeId, reason, sourceId },
          select: { id: true },
        });

        if (existing) {
          console.log(
            `[packaging] Skipping duplicate ${reason} ${sourceId} for type ${packagingTypeId}`
          );
          continue;
        }

        await tx.packagingLedgerEntry.create({
          data: {
            packagingTypeId,
            shopDomain,
            delta,
            reason,
            sourceId,
            shopifyOrderId,
            note,
          },
        });

        await tx.packagingType.update({
          where: { id: packagingTypeId },
          data: { onHand: { increment: delta } },
        });

        applied.push(packagingTypeId);
      }

      return applied;
    },
    // Generous enough to absorb waiting behind a sibling webhook. Overrunning
    // Shopify's 5s budget just means a retry, which is idempotent.
    { timeout: 15_000, maxWait: 10_000 }
  );
}

/**
 * How many units of each packaging type an order still has outstanding.
 *
 * Deductions are negative and restocks positive, so the negated sum is what is
 * still "out". Restocks are capped by this, which is what stops a cancelled
 * order that was also refunded from putting the same box back twice.
 */
export async function outstandingForOrder(
  shopDomain: string,
  shopifyOrderId: string
): Promise<Map<string, number>> {
  return computeOutstanding(prisma, shopDomain, shopifyOrderId);
}

/** Deduct packaging for a paid order. Safe to call more than once. */
export async function deductForOrder(
  shopDomain: string,
  order: {
    id: number | string;
    order_number?: number | string | null;
    line_items?: WebhookLineItem[];
  }
): Promise<string[]> {
  const orderId = String(order.id);
  const usage = await resolvePackagingUsage(shopDomain, order.line_items ?? []);

  if (usage.size === 0) {
    return [];
  }

  return applyOrderDeltas(
    shopDomain,
    orderId,
    LedgerReason.ORDER,
    orderId,
    `Order ${order.order_number ?? orderId}`,
    () =>
      [...usage].map(([packagingTypeId, units]) => ({
        packagingTypeId,
        delta: -units,
      }))
  );
}

/**
 * Put packaging back for a refund.
 *
 * Only counts refund lines Shopify actually restocked — a refund with
 * restock_type "no_restock" means the goods, and their packaging, are gone.
 */
export async function restockForRefund(
  shopDomain: string,
  refund: {
    id: number | string;
    order_id: number | string;
    refund_line_items?: {
      quantity?: number | null;
      restock_type?: string | null;
      line_item?: WebhookLineItem | null;
    }[];
  }
): Promise<string[]> {
  const refundId = String(refund.id);
  const orderId = String(refund.order_id);

  const restockedLines: WebhookLineItem[] = [];
  for (const line of refund.refund_line_items ?? []) {
    if (line.restock_type === "no_restock") {
      continue;
    }
    if (!line.line_item) {
      continue;
    }
    restockedLines.push({
      product_id: line.line_item.product_id,
      variant_id: line.line_item.variant_id,
      quantity: Number(line.quantity ?? 0),
    });
  }

  if (restockedLines.length === 0) {
    return [];
  }

  const usage = await resolvePackagingUsage(shopDomain, restockedLines);
  if (usage.size === 0) {
    return [];
  }

  return applyOrderDeltas(
    shopDomain,
    orderId,
    LedgerReason.REFUND,
    refundId,
    `Refund ${refundId}`,
    (outstanding) => {
      const deltas: PendingDelta[] = [];
      for (const [packagingTypeId, units] of usage) {
        const capped = Math.min(units, outstanding.get(packagingTypeId) ?? 0);
        if (capped > 0) {
          deltas.push({ packagingTypeId, delta: capped });
        }
      }
      return deltas;
    }
  );
}

/**
 * Put back everything an order still has outstanding.
 *
 * Driven off the ledger rather than the order payload, so a cancellation that
 * follows a partial refund only returns the remainder.
 */
export async function restockForCancellation(
  shopDomain: string,
  order: { id: number | string }
): Promise<string[]> {
  const orderId = String(order.id);

  return applyOrderDeltas(
    shopDomain,
    orderId,
    LedgerReason.CANCEL,
    orderId,
    `Order ${orderId} cancelled`,
    // Driven entirely off the balance read inside the lock, so a cancellation
    // that follows a refund returns only what is left.
    (outstanding) =>
      [...outstanding].map(([packagingTypeId, units]) => ({
        packagingTypeId,
        delta: units,
      }))
  );
}
