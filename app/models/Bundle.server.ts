import prisma from "../db.server";
import type { Bundle, BundleVariantMap, BundleOption } from "@prisma/client";

export type BundleWithRelations = Bundle & {
  variantMaps: BundleVariantMap[];
  options: BundleOption[];
};

export interface CreateBundleInput {
  shopDomain: string;
  shopifyProductId: string;
  title: string;
  allowMultiples: boolean;
  variantMaps: {
    shopifyVariantId: string;
    variantTitle: string;
    selectionCount: number;
  }[];
  options: {
    name: string;
    description?: string;
    imageUrl?: string;
    inStock: boolean;
    sortOrder: number;
  }[];
}

export interface UpdateBundleInput {
  title?: string;
  allowMultiples?: boolean;
  active?: boolean;
  variantMaps?: {
    shopifyVariantId: string;
    variantTitle: string;
    selectionCount: number;
  }[];
  options?: {
    name: string;
    description?: string;
    imageUrl?: string;
    inStock: boolean;
    sortOrder: number;
    active: boolean;
  }[];
}

export async function getBundles(shopDomain: string) {
  return prisma.bundle.findMany({
    where: { shopDomain },
    include: {
      variantMaps: true,
      options: { where: { active: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getBundle(
  id: string,
  shopDomain: string
): Promise<BundleWithRelations | null> {
  return prisma.bundle.findFirst({
    where: { id, shopDomain },
    include: {
      variantMaps: true,
      options: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function getBundleByProductId(
  shopifyProductId: string,
  shopDomain: string
): Promise<BundleWithRelations | null> {
  return prisma.bundle.findFirst({
    where: { shopifyProductId, shopDomain, active: true },
    include: {
      variantMaps: true,
      options: {
        where: { active: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
}

export async function createBundle(data: CreateBundleInput) {
  return prisma.bundle.create({
    data: {
      shopDomain: data.shopDomain,
      shopifyProductId: data.shopifyProductId,
      title: data.title,
      allowMultiples: data.allowMultiples,
      variantMaps: {
        create: data.variantMaps,
      },
      options: {
        create: data.options,
      },
    },
    include: {
      variantMaps: true,
      options: true,
    },
  });
}

export async function updateBundle(
  id: string,
  shopDomain: string,
  data: UpdateBundleInput
) {
  return prisma.$transaction(async (tx) => {
    // Delete old variant maps and options if new ones are provided
    if (data.variantMaps) {
      await tx.bundleVariantMap.deleteMany({ where: { bundleId: id } });
    }
    if (data.options) {
      await tx.bundleOption.deleteMany({ where: { bundleId: id } });
    }

    return tx.bundle.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.allowMultiples !== undefined && {
          allowMultiples: data.allowMultiples,
        }),
        ...(data.active !== undefined && { active: data.active }),
        ...(data.variantMaps && {
          variantMaps: { create: data.variantMaps },
        }),
        ...(data.options && {
          options: { create: data.options },
        }),
      },
      include: {
        variantMaps: true,
        options: true,
      },
    });
  });
}

export async function deleteBundle(id: string, shopDomain: string) {
  return prisma.bundle.deleteMany({
    where: { id, shopDomain },
  });
}

export async function deleteBundlesForShop(shopDomain: string) {
  return prisma.bundle.deleteMany({
    where: { shopDomain },
  });
}
