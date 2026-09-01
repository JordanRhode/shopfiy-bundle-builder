import { randomUUID } from "crypto";
import prisma from "../db.server";
import type { PackagingType, PackagingAssignment } from "@prisma/client";

export type PackagingTypeWithAssignments = PackagingType & {
  assignments: PackagingAssignment[];
};

export const LedgerReason = {
  ORDER: "ORDER",
  REFUND: "REFUND",
  CANCEL: "CANCEL",
  MANUAL: "MANUAL",
} as const;

export interface AssignmentInput {
  shopifyProductId: string;
  shopifyVariantId: string;
  productTitle?: string;
  variantTitle?: string;
  unitsPerItem: number;
}

export interface CreatePackagingTypeInput {
  shopDomain: string;
  name: string;
  sku?: string;
  onHand: number;
  lowThreshold: number;
  notifyEmails?: string;
  assignments: AssignmentInput[];
}

export interface UpdatePackagingTypeInput {
  name?: string;
  sku?: string;
  lowThreshold?: number;
  notifyEmails?: string;
  active?: boolean;
  assignments?: AssignmentInput[];
}

export async function getPackagingTypes(shopDomain: string) {
  return prisma.packagingType.findMany({
    where: { shopDomain },
    include: { assignments: true },
    orderBy: { name: "asc" },
  });
}

export async function getPackagingType(id: string, shopDomain: string) {
  return prisma.packagingType.findFirst({
    where: { id, shopDomain },
    include: {
      assignments: { orderBy: { createdAt: "asc" } },
      ledger: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
}

export async function createPackagingType(data: CreatePackagingTypeInput) {
  return prisma.packagingType.create({
    data: {
      shopDomain: data.shopDomain,
      name: data.name,
      sku: data.sku,
      onHand: data.onHand,
      lowThreshold: data.lowThreshold,
      notifyEmails: data.notifyEmails,
      assignments: {
        create: data.assignments.map((a) => ({
          shopDomain: data.shopDomain,
          shopifyProductId: a.shopifyProductId,
          shopifyVariantId: a.shopifyVariantId,
          productTitle: a.productTitle,
          variantTitle: a.variantTitle,
          unitsPerItem: a.unitsPerItem,
        })),
      },
      // Opening count is recorded so the ledger always reconciles to onHand.
      ...(data.onHand !== 0 && {
        ledger: {
          create: {
            shopDomain: data.shopDomain,
            delta: data.onHand,
            reason: LedgerReason.MANUAL,
            sourceId: `manual:${randomUUID()}`,
            note: "Opening count",
          },
        },
      }),
    },
    include: { assignments: true },
  });
}

export async function updatePackagingType(
  id: string,
  shopDomain: string,
  data: UpdatePackagingTypeInput
) {
  return prisma.$transaction(async (tx) => {
    // Confirm the packaging type belongs to this shop before touching its rows
    const owned = await tx.packagingType.findFirst({
      where: { id, shopDomain },
      select: { id: true },
    });
    if (!owned) {
      return null;
    }

    if (data.assignments) {
      await tx.packagingAssignment.deleteMany({ where: { packagingTypeId: id } });
    }

    return tx.packagingType.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.sku !== undefined && { sku: data.sku }),
        ...(data.lowThreshold !== undefined && {
          lowThreshold: data.lowThreshold,
        }),
        ...(data.notifyEmails !== undefined && {
          notifyEmails: data.notifyEmails,
        }),
        ...(data.active !== undefined && { active: data.active }),
        ...(data.assignments && {
          assignments: {
            create: data.assignments.map((a) => ({
              shopDomain,
              shopifyProductId: a.shopifyProductId,
              shopifyVariantId: a.shopifyVariantId,
              productTitle: a.productTitle,
              variantTitle: a.variantTitle,
              unitsPerItem: a.unitsPerItem,
            })),
          },
        }),
      },
      include: { assignments: true },
    });
  });
}

export async function deletePackagingType(id: string, shopDomain: string) {
  return prisma.packagingType.deleteMany({ where: { id, shopDomain } });
}

export async function deletePackagingForShop(shopDomain: string) {
  return prisma.packagingType.deleteMany({ where: { shopDomain } });
}

/**
 * Manually correct a count (stock arrival, breakage, recount).
 * `delta` is signed. Every manual entry gets its own sourceId so repeated
 * adjustments of the same size are never mistaken for duplicates.
 */
export async function adjustOnHand(
  id: string,
  shopDomain: string,
  delta: number,
  note?: string
) {
  return prisma.$transaction(async (tx) => {
    const owned = await tx.packagingType.findFirst({
      where: { id, shopDomain },
      select: { id: true },
    });
    if (!owned) {
      return null;
    }

    await tx.packagingLedgerEntry.create({
      data: {
        packagingTypeId: id,
        shopDomain,
        delta,
        reason: LedgerReason.MANUAL,
        sourceId: `manual:${randomUUID()}`,
        note,
      },
    });

    return tx.packagingType.update({
      where: { id },
      data: { onHand: { increment: delta } },
    });
  });
}

export async function getRecentLedger(shopDomain: string, take = 100) {
  return prisma.packagingLedgerEntry.findMany({
    where: { shopDomain },
    include: { packagingType: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take,
  });
}
