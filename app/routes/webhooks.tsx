import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { deleteBundlesForShop } from "../models/Bundle.server";
import { decrementMultiple } from "../models/BundleOption.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "APP_UNINSTALLED":
      console.log(`App uninstalled from ${shop}, cleaning up data...`);
      await deleteBundlesForShop(shop);
      break;

    case "ORDERS_CREATE":
      await handleOrderCreate(shop, payload);
      break;

    default:
      console.log(`Unhandled webhook topic: ${topic}`);
  }

  return new Response(null, { status: 200 });
};

async function handleOrderCreate(shop: string, payload: any) {
  const lineItems = payload.line_items || [];

  for (const item of lineItems) {
    const properties = item.properties || [];

    // Find bundle-related properties
    const bundleIdProp = properties.find(
      (p: any) => p.name === "_bundle_id"
    );
    const selectionsProp = properties.find(
      (p: any) => p.name === "_bundle_selections"
    );

    if (!bundleIdProp || !selectionsProp) {
      continue; // Not a bundle line item
    }

    const bundleId = bundleIdProp.value;
    let selections: Record<string, number>;

    try {
      selections = JSON.parse(selectionsProp.value);
    } catch (e) {
      console.error(
        `Failed to parse bundle selections for order line item:`,
        e
      );
      continue;
    }

    // Multiply by line item quantity (customer may have ordered 2 of the same bundle)
    const lineQuantity = item.quantity || 1;

    const decrementItems = Object.entries(selections).map(
      ([optionId, quantity]) => ({
        optionId,
        quantity: (quantity as number) * lineQuantity,
      })
    );

    if (decrementItems.length === 0) continue;

    const result = await decrementMultiple(decrementItems);

    if (!result.success) {
      // Log the oversold situation — the order already exists so we can't reject it.
      // The merchant will need to handle this manually.
      console.error(
        `[OVERSOLD] Bundle ${bundleId} in shop ${shop}: ` +
          `Option ${result.failedOptionId} had insufficient inventory. ` +
          `Order will need manual review.`
      );
    } else {
      console.log(
        `Successfully decremented inventory for bundle ${bundleId} ` +
          `(${decrementItems.length} options, line qty: ${lineQuantity})`
      );
    }
  }
}
