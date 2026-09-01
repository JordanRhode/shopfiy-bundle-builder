import { describe, it, expect } from "vitest";
import {
  computeUsage,
  type MatchableAssignment,
} from "./PackagingInventory.server";

const BOX4 = "pkg_4count";
const BOX8 = "pkg_8count";
const INSERT = "pkg_insert";

const MUG = "gid://shopify/Product/111";
const MUG_SMALL = "gid://shopify/ProductVariant/9001";
const MUG_LARGE = "gid://shopify/ProductVariant/9002";
const CANDLE = "gid://shopify/Product/222";

const wildcard = (
  packagingTypeId: string,
  shopifyProductId: string,
  unitsPerItem = 1
): MatchableAssignment => ({
  packagingTypeId,
  shopifyProductId,
  shopifyVariantId: "*",
  unitsPerItem,
});

const forVariant = (
  packagingTypeId: string,
  shopifyProductId: string,
  shopifyVariantId: string,
  unitsPerItem = 1
): MatchableAssignment => ({
  packagingTypeId,
  shopifyProductId,
  shopifyVariantId,
  unitsPerItem,
});

describe("computeUsage", () => {
  it("deducts one unit of packaging per item sold", () => {
    const usage = computeUsage(
      [{ product_id: 111, variant_id: 9001, quantity: 3 }],
      [wildcard(BOX4, MUG)]
    );
    expect(usage.get(BOX4)).toBe(3);
  });

  it("normalizes numeric webhook ids to the GIDs the admin stores", () => {
    // Order webhooks send numbers; the resource picker stores GIDs. If these
    // ever stop agreeing, nothing is deducted and the failure is silent.
    expect(
      computeUsage(
        [{ product_id: "111", variant_id: "9001", quantity: 1 }],
        [wildcard(BOX4, MUG)]
      ).get(BOX4)
    ).toBe(1);

    expect(
      computeUsage(
        [{ product_id: MUG, variant_id: MUG_SMALL, quantity: 2 }],
        [wildcard(BOX4, MUG)]
      ).get(BOX4)
    ).toBe(2);
  });

  it("multiplies by unitsPerItem", () => {
    const usage = computeUsage(
      [{ product_id: 111, variant_id: 9001, quantity: 4 }],
      [wildcard(BOX4, MUG, 2)]
    );
    expect(usage.get(BOX4)).toBe(8);
  });

  it("lets a variant-specific assignment override the product wildcard", () => {
    const assignments = [
      wildcard(BOX4, MUG, 1),
      forVariant(BOX4, MUG, MUG_LARGE, 3),
    ];

    expect(
      computeUsage(
        [{ product_id: 111, variant_id: 9002, quantity: 2 }],
        assignments
      ).get(BOX4)
    ).toBe(6);

    expect(
      computeUsage(
        [{ product_id: 111, variant_id: 9001, quantity: 2 }],
        assignments
      ).get(BOX4)
    ).toBe(2);
  });

  it("applies the override regardless of assignment order", () => {
    const usage = computeUsage(
      [{ product_id: 111, variant_id: 9002, quantity: 1 }],
      [forVariant(BOX4, MUG, MUG_LARGE, 3), wildcard(BOX4, MUG, 1)]
    );
    expect(usage.get(BOX4)).toBe(3);
  });

  it("lets one product consume several packaging types at once", () => {
    const usage = computeUsage(
      [{ product_id: 111, variant_id: 9001, quantity: 2 }],
      [wildcard(BOX8, MUG), wildcard(INSERT, MUG, 4)]
    );
    expect(usage.get(BOX8)).toBe(2);
    expect(usage.get(INSERT)).toBe(8);
  });

  it("accumulates across line items sharing a packaging type", () => {
    const usage = computeUsage(
      [
        { product_id: 111, variant_id: 9001, quantity: 2 },
        { product_id: 222, variant_id: 9100, quantity: 5 },
      ],
      [wildcard(BOX4, MUG), wildcard(BOX4, CANDLE)]
    );
    expect(usage.get(BOX4)).toBe(7);
  });

  it("does not leak a variant-only assignment to sibling variants", () => {
    const assignments = [forVariant(BOX8, MUG, MUG_LARGE, 1)];

    expect(
      computeUsage(
        [{ product_id: 111, variant_id: 9002, quantity: 1 }],
        assignments
      ).get(BOX8)
    ).toBe(1);

    expect(
      computeUsage(
        [{ product_id: 111, variant_id: 9001, quantity: 1 }],
        assignments
      ).size
    ).toBe(0);
  });

  it("ignores products with no assignment", () => {
    const usage = computeUsage(
      [{ product_id: 999, variant_id: 1, quantity: 10 }],
      [wildcard(BOX4, MUG)]
    );
    expect(usage.size).toBe(0);
  });

  it("ignores zero, missing and negative quantities", () => {
    const assignments = [wildcard(BOX4, MUG)];
    expect(computeUsage([{ product_id: 111, quantity: 0 }], assignments).size).toBe(0);
    expect(computeUsage([{ product_id: 111 }], assignments).size).toBe(0);
    expect(computeUsage([{ product_id: 111, quantity: -2 }], assignments).size).toBe(0);
  });

  it("ignores line items with no product, such as custom lines", () => {
    const usage = computeUsage(
      [{ product_id: null, variant_id: null, quantity: 3 }],
      [wildcard(BOX4, MUG)]
    );
    expect(usage.size).toBe(0);
  });
});
