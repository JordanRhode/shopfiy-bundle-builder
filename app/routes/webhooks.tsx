import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { deleteBundlesForShop } from "../models/Bundle.server";
import { deletePackagingForShop } from "../models/Packaging.server";
import {
  deductForOrder,
  restockForRefund,
  restockForCancellation,
} from "../models/PackagingInventory.server";
import { checkLowStock } from "../services/packagingNotifications.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "APP_UNINSTALLED":
      console.log(`App uninstalled from ${shop}, cleaning up data...`);
      await deleteBundlesForShop(shop);
      await deletePackagingForShop(shop);
      break;

    // Deducting on paid rather than created keeps unpaid draft and abandoned
    // orders from consuming packaging that never actually ships.
    case "ORDERS_PAID": {
      const order = payload as Parameters<typeof deductForOrder>[1];
      const affected = await deductForOrder(shop, order);
      await checkLowStock(shop, affected);
      break;
    }

    case "REFUNDS_CREATE": {
      const refund = payload as Parameters<typeof restockForRefund>[1];
      const affected = await restockForRefund(shop, refund);
      await checkLowStock(shop, affected);
      break;
    }

    case "ORDERS_CANCELLED": {
      const order = payload as Parameters<typeof restockForCancellation>[1];
      const affected = await restockForCancellation(shop, order);
      await checkLowStock(shop, affected);
      break;
    }

    default:
      console.log(`Unhandled webhook topic: ${topic}`);
  }

  return new Response(null, { status: 200 });
};
