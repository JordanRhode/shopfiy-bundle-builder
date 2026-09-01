import prisma from "../db.server";
import { deleteBundlesForShop } from "./Bundle.server";
import { deletePackagingForShop } from "./Packaging.server";

/**
 * Record that a shop has the app installed, clearing any previous uninstall.
 *
 * Called from the afterAuth hook, so a reinstall picks up the merchant's
 * existing bundles and packaging counts exactly where they left off.
 */
export async function markInstalled(shopDomain: string) {
  return prisma.shop.upsert({
    where: { shopDomain },
    create: { shopDomain },
    update: { uninstalledAt: null },
  });
}

/**
 * Record an uninstall without touching the merchant's data.
 *
 * Packaging counts represent physical stock that would have to be recounted by
 * hand, and bundle configuration takes real effort to rebuild. An uninstall is
 * often temporary — a plan change, a reinstall, an accidental click — so the
 * rows stay put and only the timestamp moves. Use purgeShopData for a
 * deliberate, permanent cleanup.
 */
export async function markUninstalled(shopDomain: string) {
  const now = new Date();
  return prisma.shop.upsert({
    where: { shopDomain },
    create: { shopDomain, uninstalledAt: now },
    update: { uninstalledAt: now },
  });
}

export async function getShop(shopDomain: string) {
  return prisma.shop.findUnique({ where: { shopDomain } });
}

/** Shops that uninstalled before the given date and still hold data. */
export async function getUninstalledBefore(cutoff: Date) {
  return prisma.shop.findMany({
    where: { uninstalledAt: { not: null, lt: cutoff } },
    orderBy: { uninstalledAt: "asc" },
  });
}

/**
 * Permanently delete everything belonging to a shop.
 *
 * Deliberately NOT wired to the uninstall webhook — this is destructive and
 * irreversible, so it should only ever run as a conscious act.
 */
export async function purgeShopData(shopDomain: string) {
  return prisma.$transaction(async (tx) => {
    const bundles = await tx.bundle.deleteMany({ where: { shopDomain } });
    const packaging = await tx.packagingType.deleteMany({ where: { shopDomain } });
    await tx.shop.deleteMany({ where: { shopDomain } });

    return {
      bundlesDeleted: bundles.count,
      packagingTypesDeleted: packaging.count,
    };
  });
}

// Re-exported so a purge script has one obvious place to import from.
export { deleteBundlesForShop, deletePackagingForShop };
