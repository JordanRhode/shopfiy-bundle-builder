import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getBundleByProductId } from "../models/Bundle.server";
import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  const { productId } = params;

  if (!productId || !session?.shop) {
    return json({ bundle: null }, { status: 400 });
  }

  // Storefront sends numeric product ID; convert to GID format
  const shopifyProductId = productId.startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;

  const bundle = await getBundleByProductId(shopifyProductId, session.shop);

  if (!bundle) {
    return json({ bundle: null });
  }

  // Transform variant IDs to include numeric format for storefront matching
  const response = {
    bundle: {
      id: bundle.id,
      title: bundle.title,
      allowMultiples: bundle.allowMultiples,
      variantMaps: bundle.variantMaps.map((vm) => ({
        shopifyVariantId: vm.shopifyVariantId,
        numericVariantId: vm.shopifyVariantId.replace(
          "gid://shopify/ProductVariant/",
          ""
        ),
        variantTitle: vm.variantTitle,
        selectionCount: vm.selectionCount,
      })),
      options: bundle.options.map((opt) => ({
        id: opt.id,
        name: opt.name,
        imageUrl: opt.imageUrl,
        inventory: opt.inventory,
        sortOrder: opt.sortOrder,
      })),
    },
  };

  return json(response, {
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
};
