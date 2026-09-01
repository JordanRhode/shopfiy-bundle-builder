import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import {
  markInstalled,
  markUninstalled,
  getShop,
  getUninstalledBefore,
  purgeShopData,
} from "./Shop.server";
import { createPackagingType } from "./Packaging.server";
import { createBundle } from "./Bundle.server";

const SHOP = "uninstall-itest.myshopify.com";
const OTHER_SHOP = "bystander-itest.myshopify.com";
const MUG = "gid://shopify/Product/111";

async function seedShopData(shopDomain: string) {
  await createBundle({
    shopDomain,
    shopifyProductId: MUG,
    title: "Gift box",
    allowMultiples: true,
    variantMaps: [
      {
        shopifyVariantId: "gid://shopify/ProductVariant/9001",
        variantTitle: "Default",
        selectionCount: 4,
      },
    ],
    options: [
      {
        name: "Vanilla",
        inStock: true,
        sortOrder: 0,
      },
    ],
  });

  await createPackagingType({
    shopDomain,
    name: "8-count box",
    onHand: 137,
    lowThreshold: 20,
    assignments: [
      { shopifyProductId: MUG, shopifyVariantId: "*", unitsPerItem: 1 },
    ],
  });
}

async function counts(shopDomain: string) {
  return {
    bundles: await prisma.bundle.count({ where: { shopDomain } }),
    packaging: await prisma.packagingType.count({ where: { shopDomain } }),
  };
}

async function cleanup() {
  for (const shopDomain of [SHOP, OTHER_SHOP]) {
    await prisma.bundle.deleteMany({ where: { shopDomain } });
    await prisma.packagingType.deleteMany({ where: { shopDomain } });
    await prisma.shop.deleteMany({ where: { shopDomain } });
  }
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("uninstall is non-destructive", () => {
  it("keeps bundles and packaging counts when the app is uninstalled", async () => {
    await seedShopData(SHOP);
    expect(await counts(SHOP)).toEqual({ bundles: 1, packaging: 1 });

    await markUninstalled(SHOP);

    // The whole point: physical stock counts are not recoverable by
    // reinstalling, so they must survive.
    expect(await counts(SHOP)).toEqual({ bundles: 1, packaging: 1 });

    const box = await prisma.packagingType.findFirstOrThrow({
      where: { shopDomain: SHOP },
    });
    expect(box.onHand).toBe(137);
  });

  it("records when the uninstall happened", async () => {
    await markUninstalled(SHOP);
    const shop = await getShop(SHOP);
    expect(shop?.uninstalledAt).toBeInstanceOf(Date);
  });

  it("records an uninstall even for a shop it has never seen", async () => {
    // The install hook may never have run for an older shop.
    const shop = await markUninstalled("never-seen.myshopify.com");
    expect(shop.uninstalledAt).not.toBeNull();
    await prisma.shop.delete({ where: { shopDomain: "never-seen.myshopify.com" } });
  });

  it("clears the uninstall marker on reinstall, data intact", async () => {
    await seedShopData(SHOP);
    await markUninstalled(SHOP);
    expect((await getShop(SHOP))?.uninstalledAt).not.toBeNull();

    await markInstalled(SHOP);

    expect((await getShop(SHOP))?.uninstalledAt).toBeNull();
    expect(await counts(SHOP)).toEqual({ bundles: 1, packaging: 1 });
  });

  it("is idempotent across redelivered uninstall webhooks", async () => {
    await seedShopData(SHOP);
    await markUninstalled(SHOP);
    await markUninstalled(SHOP);
    await markUninstalled(SHOP);

    expect(await prisma.shop.count({ where: { shopDomain: SHOP } })).toBe(1);
    expect(await counts(SHOP)).toEqual({ bundles: 1, packaging: 1 });
  });

  it("marks install for a shop with no prior row", async () => {
    await markInstalled(SHOP);
    const shop = await getShop(SHOP);
    expect(shop).not.toBeNull();
    expect(shop?.uninstalledAt).toBeNull();
  });
});

describe("deliberate purge", () => {
  it("deletes everything for the named shop only", async () => {
    await seedShopData(SHOP);
    await seedShopData(OTHER_SHOP);
    await markUninstalled(SHOP);

    const result = await purgeShopData(SHOP);
    expect(result).toEqual({ bundlesDeleted: 1, packagingTypesDeleted: 1 });

    expect(await counts(SHOP)).toEqual({ bundles: 0, packaging: 0 });
    expect(await getShop(SHOP)).toBeNull();

    // A purge must never reach past the shop it was asked about.
    expect(await counts(OTHER_SHOP)).toEqual({ bundles: 1, packaging: 1 });
  });

  it("cascades packaging assignments and ledger entries", async () => {
    await seedShopData(SHOP);
    expect(
      await prisma.packagingLedgerEntry.count({ where: { shopDomain: SHOP } })
    ).toBeGreaterThan(0);

    await purgeShopData(SHOP);

    expect(
      await prisma.packagingAssignment.count({ where: { shopDomain: SHOP } })
    ).toBe(0);
    expect(
      await prisma.packagingLedgerEntry.count({ where: { shopDomain: SHOP } })
    ).toBe(0);
  });

  it("is safe to run for a shop with nothing stored", async () => {
    const result = await purgeShopData("empty.myshopify.com");
    expect(result).toEqual({ bundlesDeleted: 0, packagingTypesDeleted: 0 });
  });
});

describe("retention helper", () => {
  it("lists only shops uninstalled before the cutoff", async () => {
    await markUninstalled(SHOP);
    await prisma.shop.update({
      where: { shopDomain: SHOP },
      data: { uninstalledAt: new Date("2020-01-01T00:00:00Z") },
    });
    await markUninstalled(OTHER_SHOP);

    const stale = await getUninstalledBefore(new Date("2021-01-01T00:00:00Z"));
    const domains = stale.map((shop) => shop.shopDomain);

    expect(domains).toContain(SHOP);
    expect(domains).not.toContain(OTHER_SHOP);
  });

  it("never lists a shop that is still installed", async () => {
    await markInstalled(SHOP);
    const stale = await getUninstalledBefore(new Date());
    expect(stale.map((shop) => shop.shopDomain)).not.toContain(SHOP);
  });
});
