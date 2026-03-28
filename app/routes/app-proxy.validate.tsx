import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getBundle } from "../models/Bundle.server";
import { validateSelections } from "../models/BundleOption.server";
import type { ActionFunctionArgs } from "@remix-run/node";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);

  if (request.method !== "POST") {
    return json({ valid: false, errors: ["Method not allowed"] }, { status: 405 });
  }

  if (!session?.shop) {
    return json({ valid: false, errors: ["Unauthorized"] }, { status: 401 });
  }

  let body: {
    bundleId: string;
    variantId: string;
    selections: { optionId: string; quantity: number }[];
  };

  try {
    body = await request.json();
  } catch {
    return json(
      { valid: false, errors: ["Invalid request body"] },
      { status: 400 }
    );
  }

  const { bundleId, variantId, selections } = body;

  if (!bundleId || !variantId || !Array.isArray(selections)) {
    return json(
      {
        valid: false,
        errors: ["Missing required fields: bundleId, variantId, selections"],
      },
      { status: 400 }
    );
  }

  // Look up the bundle
  const bundle = await getBundle(bundleId, session.shop);
  if (!bundle || !bundle.active) {
    return json(
      { valid: false, errors: ["Bundle not found or inactive"] },
      { status: 404 }
    );
  }

  // Find the variant mapping — match by GID or numeric ID
  const variantMap = bundle.variantMaps.find(
    (vm) =>
      vm.shopifyVariantId === variantId ||
      vm.shopifyVariantId === `gid://shopify/ProductVariant/${variantId}`
  );

  if (!variantMap) {
    return json(
      { valid: false, errors: ["Variant not associated with this bundle"] },
      { status: 400 }
    );
  }

  // Check total selection count
  const totalSelected = selections.reduce((sum, s) => sum + s.quantity, 0);
  if (totalSelected !== variantMap.selectionCount) {
    return json({
      valid: false,
      errors: [
        `Expected ${variantMap.selectionCount} selections, got ${totalSelected}`,
      ],
    });
  }

  // Check if multiples are allowed
  if (!bundle.allowMultiples) {
    const hasMultiples = selections.some((s) => s.quantity > 1);
    if (hasMultiples) {
      return json({
        valid: false,
        errors: ["This bundle does not allow multiple selections of the same option"],
      });
    }
  }

  // Validate individual option inventory
  const inventoryCheck = await validateSelections(bundleId, selections);
  if (!inventoryCheck.valid) {
    return json({ valid: false, errors: inventoryCheck.errors });
  }

  return json(
    { valid: true, errors: [] },
    {
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
};
