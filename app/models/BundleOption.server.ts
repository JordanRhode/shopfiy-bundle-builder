import prisma from "../db.server";

/**
 * Atomically decrement inventory for a single option.
 * Uses WHERE inventory >= quantity to prevent going negative.
 * Returns the number of rows affected (0 = insufficient stock).
 */
export async function decrementInventory(
  optionId: string,
  quantity: number
): Promise<boolean> {
  const result = await prisma.$executeRaw`
    UPDATE BundleOption
    SET inventory = inventory - ${quantity},
        updatedAt = datetime('now')
    WHERE id = ${optionId}
      AND inventory >= ${quantity}
      AND active = 1
  `;
  return result > 0;
}

/**
 * Atomically decrement inventory for multiple options in a single transaction.
 * If any single decrement fails, the entire transaction is rolled back.
 */
export async function decrementMultiple(
  items: { optionId: string; quantity: number }[]
): Promise<{ success: boolean; failedOptionId?: string }> {
  try {
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const result = await tx.$executeRaw`
          UPDATE BundleOption
          SET inventory = inventory - ${item.quantity},
              updatedAt = datetime('now')
          WHERE id = ${item.optionId}
            AND inventory >= ${item.quantity}
            AND active = 1
        `;
        if (result === 0) {
          throw new Error(`INSUFFICIENT_STOCK:${item.optionId}`);
        }
      }
    });
    return { success: true };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INSUFFICIENT_STOCK:")) {
      const failedOptionId = error.message.split(":")[1];
      return { success: false, failedOptionId };
    }
    throw error;
  }
}

/**
 * Get all active options for a bundle with current inventory.
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
      inventory: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * Validate that selections are valid for a bundle.
 * Checks: option existence, active status, and inventory availability.
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
    if (option.inventory < selection.quantity) {
      errors.push(
        `${option.name} only has ${option.inventory} in stock (requested ${selection.quantity})`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
