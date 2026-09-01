import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { markUninstalled } from "../models/Shop.server";
import {
  deductForOrder,
  restockForRefund,
  restockForCancellation,
} from "../models/PackagingInventory.server";
import { checkLowStock } from "../services/packagingNotifications.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  switch (topic) {
    // Deliberately non-destructive. Bundle configuration and packaging counts
    // survive an uninstall so a reinstall resumes where the merchant left off;
    // packaging counts in particular track physical stock that cannot be
    // recovered by reinstalling. Permanent deletion is a manual act via
    // purgeShopData.
    case "APP_UNINSTALLED":
      console.log(`App uninstalled from ${shop}; data retained for reinstall`);
      await markUninstalled(shop);
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
