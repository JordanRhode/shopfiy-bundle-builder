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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  );
}

/**
 * Apply ledger entries and move the cached counts.
 *
 * Each entry is its own transaction so one duplicate does not roll back the
 * rest of the order. The unique index on (packagingTypeId, reason, sourceId)
 * is what makes redelivered webhooks safe: the second attempt hits P2002 and
 * is skipped rather than double-counted.
 */
async function applyDeltas(
  shopDomain: string,
  deltas: PendingDelta[],
  reason: string,
  sourceId: string,
  shopifyOrderId: string | null,
  note?: string
): Promise<string[]> {
  const applied: string[] = [];

  for (const { packagingTypeId, delta } of deltas) {
    if (delta === 0) {
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
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
      });

      applied.push(packagingTypeId);
    } catch (error) {
      if (isUniqueViolation(error)) {
        console.log(
          `[packaging] Skipping duplicate ${reason} ${sourceId} for type ${packagingTypeId}`
        );
        continue;
      }
      throw error;
    }
  }

  return applied;
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
  const grouped = await prisma.packagingLedgerEntry.groupBy({
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

  const deltas = [...usage].map(([packagingTypeId, units]) => ({
    packagingTypeId,
    delta: -units,
  }));

  return applyDeltas(
    shopDomain,
    deltas,
    LedgerReason.ORDER,
    orderId,
    orderId,
    `Order ${order.order_number ?? orderId}`
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

  const outstanding = await outstandingForOrder(shopDomain, orderId);

  const deltas: PendingDelta[] = [];
  for (const [packagingTypeId, units] of usage) {
    const capped = Math.min(units, outstanding.get(packagingTypeId) ?? 0);
    if (capped > 0) {
      deltas.push({ packagingTypeId, delta: capped });
    }
  }

  return applyDeltas(
    shopDomain,
    deltas,
    LedgerReason.REFUND,
    refundId,
    orderId,
    `Refund ${refundId}`
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
  const outstanding = await outstandingForOrder(shopDomain, orderId);

  if (outstanding.size === 0) {
    return [];
  }

  const deltas = [...outstanding].map(([packagingTypeId, units]) => ({
    packagingTypeId,
    delta: units,
  }));

  return applyDeltas(
    shopDomain,
    deltas,
    LedgerReason.CANCEL,
    orderId,
    orderId,
    `Order ${orderId} cancelled`
  );
}
