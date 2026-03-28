import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { deleteBundlesForShop } from "../models/Bundle.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);

  switch (topic) {
    case "APP_UNINSTALLED":
      console.log(`App uninstalled from ${shop}, cleaning up data...`);
      await deleteBundlesForShop(shop);
      break;

    case "ORDERS_CREATE":
      console.log(`Order created in ${shop}`);
      break;

    default:
      console.log(`Unhandled webhook topic: ${topic}`);
  }

  return new Response(null, { status: 200 });
};
