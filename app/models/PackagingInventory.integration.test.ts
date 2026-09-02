import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import prisma from "../db.server";
import { createPackagingType, adjustOnHand } from "./Packaging.server";
import {
  deductForOrder,
  restockForRefund,
  restockForCancellation,
  resolvePackagingUsage,
} from "./PackagingInventory.server";
import { checkLowStock } from "../services/packagingNotifications.server";

const SHOP = "packaging-itest.myshopify.com";
const MUG = "gid://shopify/Product/111";
const MUG_LARGE = "gid://shopify/ProductVariant/9002";

/** A packaging type assigned to every variant of the mug, one unit each. */
async function seedBox(overrides: { onHand?: number; lowThreshold?: number } = {}) {
  return createPackagingType({
    shopDomain: SHOP,
    name: "8-count box",
    onHand: overrides.onHand ?? 20,
    lowThreshold: overrides.lowThreshold ?? 5,
    assignments: [
      { shopifyProductId: MUG, shopifyVariantId: "*", unitsPerItem: 1 },
    ],
  });
}

async function onHandOf(id: string): Promise<number> {
  const row = await prisma.packagingType.findUniqueOrThrow({ where: { id } });
  return row.onHand;
}

/** The cached count must always equal the sum of the ledger. */
async function expectReconciled(id: string) {
  const sum = await prisma.packagingLedgerEntry.aggregate({
    where: { packagingTypeId: id },
    _sum: { delta: true },
  });
  expect(await onHandOf(id)).toBe(sum._sum.delta ?? 0);
}

function order(id: number, quantity: number) {
  return {
    id,
    order_number: id,
    line_items: [{ product_id: 111, variant_id: 9001, quantity }],
  };
}

function refund(id: number, orderId: number, quantity: number, restockType = "return") {
  return {
    id,
    order_id: orderId,
    refund_line_items: [
      {
        quantity,
        restock_type: restockType,
        line_item: { product_id: 111, variant_id: 9001 },
      },
    ],
  };
}

beforeEach(async () => {
  // Cascades to assignments and ledger entries.
  await prisma.packagingType.deleteMany({ where: { shopDomain: SHOP } });
});

afterAll(async () => {
  await prisma.packagingType.deleteMany({ where: { shopDomain: SHOP } });
  await prisma.$disconnect();
});

describe("order deduction", () => {
  it("records the opening count in the ledger", async () => {
    const box = await seedBox({ onHand: 20 });
    expect(await onHandOf(box.id)).toBe(20);
    await expectReconciled(box.id);
  });

  it("deducts one box per item on a paid order", async () => {
    const box = await seedBox();
    await deductForOrder(SHOP, order(1001, 3));
    expect(await onHandOf(box.id)).toBe(17);
    await expectReconciled(box.id);
  });

  it("does not double-deduct when Shopify redelivers the webhook", async () => {
    const box = await seedBox();
    await deductForOrder(SHOP, order(1001, 3));
    await deductForOrder(SHOP, order(1001, 3));
    await deductForOrder(SHOP, order(1001, 3));

    expect(await onHandOf(box.id)).toBe(17);
    expect(
      await prisma.packagingLedgerEntry.count({
        where: { packagingTypeId: box.id, reason: "ORDER" },
      })
    ).toBe(1);
  });

  it("ignores a paid order containing nothing assigned", async () => {
    const box = await seedBox();
    await deductForOrder(SHOP, {
      id: 1002,
      line_items: [{ product_id: 999, variant_id: 1, quantity: 5 }],
    });
    expect(await onHandOf(box.id)).toBe(20);
  });
});

describe("refunds", () => {
  it("returns packaging for a partial refund", async () => {
    const box = await seedBox();
    await deductForOrder(SHOP, order(1001, 3));

    await restockForRefund(SHOP, refund(5001, 1001, 1));
    expect(await onHandOf(box.id)).toBe(18);
    await expectReconciled(box.id);
  });

  it("does not double-restock a redelivered refund webhook", async () => {
    const box = await seedBox();
    await deductForOrder(SHOP, order(1001, 3));

    await restockForRefund(SHOP, refund(5001, 1001, 1));
    await restockForRefund(SHOP, refund(5001, 1001, 1));
    expect(await onHandOf(box.id)).toBe(18);
  });

  it("ignores a refund the merchant chose not to restock", async () => {
    const box = await seedBox();
    await deductForOrder(SHOP, order(1001, 3));

    await restockForRefund(SHOP, refund(5002, 1001, 1, "no_restock"));
    expect(await onHandOf(box.id)).toBe(17);
  });

  it("caps a refund at what the order still has outstanding", async () => {
    const box = await seedBox();
    await deductForOrder(SHOP, order(1001, 3));

    // A refund larger than the order must not invent stock.
    await restockForRefund(SHOP, refund(5003, 1001, 99));
    expect(await onHandOf(box.id)).toBe(20);
    await expectReconciled(box.id);
  });
});

describe("cancellation", () => {
  it("returns only the remainder after a partial refund", async () => {
    const box = await seedBox();
    await deductForOrder(SHOP, order(1001, 3));
    await restockForRefund(SHOP, refund(5001, 1001, 1));

    await restockForCancellation(SHOP, { id: 1001 });

    // 3 out, 1 back via refund, so cancelling returns 2 - not another 3.
    expect(await onHandOf(box.id)).toBe(20);
    await expectReconciled(box.id);
  });

  it("does not over-restock on a redelivered cancellation", async () => {
    const box = await seedBox();
    await deductForOrder(SHOP, order(1001, 3));

    await restockForCancellation(SHOP, { id: 1001 });
    await restockForCancellation(SHOP, { id: 1001 });
    expect(await onHandOf(box.id)).toBe(20);
  });

  it("is a no-op for an order that never consumed packaging", async () => {
    const box = await seedBox();
    await restockForCancellation(SHOP, { id: 4242 });
    expect(await onHandOf(box.id)).toBe(20);
  });
});

describe("assignment resolution", () => {
  it("prefers a variant-specific assignment over the wildcard", async () => {
    const box = await seedBox();
    await prisma.packagingAssignment.create({
      data: {
        packagingTypeId: box.id,
        shopDomain: SHOP,
        shopifyProductId: MUG,
        shopifyVariantId: MUG_LARGE,
        unitsPerItem: 3,
      },
    });

    const large = await resolvePackagingUsage(SHOP, [
      { product_id: 111, variant_id: 9002, quantity: 2 },
    ]);
    expect(large.get(box.id)).toBe(6);

    const small = await resolvePackagingUsage(SHOP, [
      { product_id: 111, variant_id: 9001, quantity: 2 },
    ]);
    expect(small.get(box.id)).toBe(2);
  });

  it("skips inactive packaging types", async () => {
    const box = await seedBox();
    await prisma.packagingType.update({
      where: { id: box.id },
      data: { active: false },
    });

    const usage = await resolvePackagingUsage(SHOP, [
      { product_id: 111, variant_id: 9001, quantity: 5 },
    ]);
    expect(usage.size).toBe(0);
  });

  it("never resolves another shop's assignments", async () => {
    await seedBox();
    const usage = await resolvePackagingUsage("someone-else.myshopify.com", [
      { product_id: 111, variant_id: 9001, quantity: 5 },
    ]);
    expect(usage.size).toBe(0);
  });
});

describe("low stock alerting", () => {
  // The cooldown only starts once a channel actually delivers, so these tests
  // need one configured.
  beforeEach(() => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/x";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 })
    );
  });

  afterEach(() => {
    delete process.env.SLACK_WEBHOOK_URL;
    vi.restoreAllMocks();
  });

  it("alerts once, then respects the cooldown, then resets on recovery", async () => {
    const box = await seedBox({ onHand: 6, lowThreshold: 5 });

    await deductForOrder(SHOP, order(1001, 2));
    expect(await onHandOf(box.id)).toBe(4);

    await checkLowStock(SHOP, [box.id]);
    const first = await prisma.packagingType.findUniqueOrThrow({
      where: { id: box.id },
    });
    expect(first.lastNotifiedAt).not.toBeNull();

    // Still low, within the cooldown: must not alert again.
    await checkLowStock(SHOP, [box.id]);
    const second = await prisma.packagingType.findUniqueOrThrow({
      where: { id: box.id },
    });
    expect(second.lastNotifiedAt?.getTime()).toBe(first.lastNotifiedAt?.getTime());

    // Back above the threshold: clear the stamp so the next dip alerts at once
    // rather than waiting out a stale cooldown.
    await adjustOnHand(box.id, SHOP, 50, "Supplier delivery");
    await checkLowStock(SHOP, [box.id]);
    const recovered = await prisma.packagingType.findUniqueOrThrow({
      where: { id: box.id },
    });
    expect(recovered.lastNotifiedAt).toBeNull();
  });

  it("does not alert while stock is above the threshold", async () => {
    const box = await seedBox({ onHand: 20, lowThreshold: 5 });
    await deductForOrder(SHOP, order(1001, 1));

    await checkLowStock(SHOP, [box.id]);
    const row = await prisma.packagingType.findUniqueOrThrow({
      where: { id: box.id },
    });
    expect(row.lastNotifiedAt).toBeNull();
  });
});

describe("manual adjustment", () => {
  it("writes a ledger entry so history stays reconciled", async () => {
    const box = await seedBox({ onHand: 10 });

    await adjustOnHand(box.id, SHOP, 250, "Pallet arrived");
    await adjustOnHand(box.id, SHOP, -3, "Water damage");

    expect(await onHandOf(box.id)).toBe(257);
    await expectReconciled(box.id);
  });

  it("refuses to adjust another shop's packaging", async () => {
    const box = await seedBox({ onHand: 10 });

    const result = await adjustOnHand(box.id, "attacker.myshopify.com", -10);
    expect(result).toBeNull();
    expect(await onHandOf(box.id)).toBe(10);
  });
});

describe("concurrent webhook delivery", () => {
  // A single concurrent run passes even against the racy implementation - the
  // very first one happens to serialize. Repeating is what makes this a real
  // regression test: before the advisory lock, this failed on ~39 of 40 runs.
  const RUNS = 12;

  it("does not double-restock when refund and cancel arrive together", async () => {
    for (let i = 0; i < RUNS; i++) {
      const orderId = 7000 + i;
      await prisma.packagingType.deleteMany({ where: { shopDomain: SHOP } });
      const box = await seedBox();

      await deductForOrder(SHOP, order(orderId, 3));

      // Cancelling an order that carried a refund makes Shopify fire
      // refunds/create and orders/cancelled at essentially the same moment.
      await Promise.all([
        restockForRefund(SHOP, refund(orderId * 10, orderId, 3)),
        restockForCancellation(SHOP, { id: orderId }),
      ]);

      expect(await onHandOf(box.id), `run ${i}`).toBe(20);
      await expectReconciled(box.id);
    }
  });

  it("deducts once when the same paid order is delivered twice at once", async () => {
    for (let i = 0; i < RUNS; i++) {
      const orderId = 8000 + i;
      await prisma.packagingType.deleteMany({ where: { shopDomain: SHOP } });
      const box = await seedBox();

      await Promise.all([
        deductForOrder(SHOP, order(orderId, 3)),
        deductForOrder(SHOP, order(orderId, 3)),
      ]);

      expect(await onHandOf(box.id), `run ${i}`).toBe(17);
      expect(
        await prisma.packagingLedgerEntry.count({
          where: { packagingTypeId: box.id, reason: "ORDER" },
        })
      ).toBe(1);
    }
  });

  it("restocks once when the same refund is delivered twice at once", async () => {
    for (let i = 0; i < RUNS; i++) {
      const orderId = 9000 + i;
      await prisma.packagingType.deleteMany({ where: { shopDomain: SHOP } });
      const box = await seedBox();

      await deductForOrder(SHOP, order(orderId, 3));
      await Promise.all([
        restockForRefund(SHOP, refund(orderId * 10, orderId, 2)),
        restockForRefund(SHOP, refund(orderId * 10, orderId, 2)),
      ]);

      expect(await onHandOf(box.id), `run ${i}`).toBe(19);
      await expectReconciled(box.id);
    }
  });
});
