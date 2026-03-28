import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import {
  getBundle,
  createBundle,
  updateBundle,
} from "../models/Bundle.server";
import BundleForm from "../components/BundleForm";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (id === "new") {
    return json({ bundle: null });
  }

  const bundle = await getBundle(id!, session.shop);
  if (!bundle) {
    throw new Response("Bundle not found", { status: 404 });
  }

  return json({ bundle });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  const formData = await request.formData();

  const title = formData.get("title") as string;
  const shopifyProductId = formData.get("shopifyProductId") as string;
  const allowMultiples = formData.get("allowMultiples") === "true";
  const variantMapsRaw = formData.get("variantMaps") as string;
  const optionsRaw = formData.get("options") as string;

  // Validate
  const errors: Record<string, string> = {};

  if (!title?.trim()) {
    errors.title = "Bundle title is required";
  }
  if (!shopifyProductId?.trim()) {
    errors.product = "Please select a Shopify product";
  }

  let variantMaps: any[] = [];
  try {
    variantMaps = JSON.parse(variantMapsRaw || "[]");
  } catch {
    errors.variantMaps = "Invalid variant data";
  }

  if (variantMaps.length === 0) {
    errors.variantMaps = "At least one variant mapping is required";
  }

  for (const vm of variantMaps) {
    if (!vm.selectionCount || vm.selectionCount < 1) {
      errors.variantMaps = `All variants must have a selection count of at least 1`;
      break;
    }
  }

  let options: any[] = [];
  try {
    options = JSON.parse(optionsRaw || "[]");
  } catch {
    errors.options = "Invalid options data";
  }

  if (options.length === 0) {
    errors.options = "At least one option is required";
  }

  for (const opt of options) {
    if (!opt.name?.trim()) {
      errors.options = "All options must have a name";
      break;
    }
    if (opt.inventory < 0) {
      errors.options = "Inventory cannot be negative";
      break;
    }
  }

  if (Object.keys(errors).length > 0) {
    return json({ errors }, { status: 422 });
  }

  // Create or update
  if (id === "new") {
    await createBundle({
      shopDomain: session.shop,
      shopifyProductId,
      title,
      allowMultiples,
      variantMaps: variantMaps.map((vm: any) => ({
        shopifyVariantId: vm.shopifyVariantId,
        variantTitle: vm.variantTitle,
        selectionCount: vm.selectionCount,
      })),
      options: options.map((opt: any, i: number) => ({
        name: opt.name,
        imageUrl: opt.imageUrl || null,
        inventory: opt.inventory,
        sortOrder: i,
      })),
    });
  } else {
    await updateBundle(id!, session.shop, {
      title,
      allowMultiples,
      variantMaps: variantMaps.map((vm: any) => ({
        shopifyVariantId: vm.shopifyVariantId,
        variantTitle: vm.variantTitle,
        selectionCount: vm.selectionCount,
      })),
      options: options.map((opt: any, i: number) => ({
        name: opt.name,
        imageUrl: opt.imageUrl || null,
        inventory: opt.inventory,
        sortOrder: i,
        active: opt.active !== false,
      })),
    });
  }

  return redirect("/app");
};

export default function BundleEditPage() {
  const { bundle } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <BundleForm
      bundle={
        bundle
          ? {
              id: bundle.id,
              title: bundle.title,
              shopifyProductId: bundle.shopifyProductId,
              allowMultiples: bundle.allowMultiples,
              active: bundle.active,
              variantMaps: bundle.variantMaps,
              options: bundle.options.map((opt) => ({
                name: opt.name,
                imageUrl: opt.imageUrl || "",
                inventory: opt.inventory,
                sortOrder: opt.sortOrder,
                active: opt.active,
              })),
            }
          : undefined
      }
      errors={(actionData as any)?.errors}
    />
  );
}
