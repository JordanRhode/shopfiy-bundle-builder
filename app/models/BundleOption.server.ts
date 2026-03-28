import prisma from "../db.server";

/**
 * Get all active options for a bundle.
 */
export async function getAvailableOptions(bundleId: string) {
  return prisma.bundleOption.findMany({
    where: {
      bundleId,
      active: true,
    },
    select: {
      id: true,
      name: true,
      imageUrl: true,
      inStock: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * Validate that selections are valid for a bundle.
 * Checks: option existence, active status, and in-stock status.
 */
export async function validateSelections(
  bundleId: string,
  selections: { optionId: string; quantity: number }[]
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const options = await prisma.bundleOption.findMany({
    where: {
      bundleId,
      id: { in: selections.map((s) => s.optionId) },
    },
  });

  const optionMap = new Map(options.map((o) => [o.id, o]));

  for (const selection of selections) {
    const option = optionMap.get(selection.optionId);
    if (!option) {
      errors.push(`Option ${selection.optionId} not found`);
      continue;
    }
    if (!option.active) {
      errors.push(`${option.name} is no longer available`);
      continue;
    }
    if (!option.inStock) {
      errors.push(`${option.name} is out of stock`);
    }
  }

  return { valid: errors.length === 0, errors };
}
