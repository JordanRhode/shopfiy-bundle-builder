import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import {
  getPackagingType,
  createPackagingType,
  updatePackagingType,
  type AssignmentInput,
} from "../models/Packaging.server";
import PackagingForm from "../components/PackagingForm";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (id === "new") {
    return json({ packagingType: null });
  }

  const packagingType = await getPackagingType(id!, session.shop);
  if (!packagingType) {
    throw new Response("Packaging type not found", { status: 404 });
  }

  // Titles are snapshots taken at assignment time and may be absent on older
  // rows; the form wants plain strings.
  return json({
    packagingType: {
      ...packagingType,
      assignments: packagingType.assignments.map((assignment) => ({
        shopifyProductId: assignment.shopifyProductId,
        shopifyVariantId: assignment.shopifyVariantId,
        productTitle: assignment.productTitle ?? assignment.shopifyProductId,
        variantTitle: assignment.variantTitle ?? "All variants",
        unitsPerItem: assignment.unitsPerItem,
      })),
      ledger: packagingType.ledger.map((entry) => ({
        id: entry.id,
        delta: entry.delta,
        reason: entry.reason,
        note: entry.note,
        shopifyOrderId: entry.shopifyOrderId,
        createdAt: entry.createdAt.toISOString(),
      })),
    },
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;
  const formData = await request.formData();

  const name = formData.get("name") as string;
  const sku = (formData.get("sku") as string)?.trim();
  const notifyEmails = (formData.get("notifyEmails") as string)?.trim();
  const active = formData.get("active") === "true";
  const assignmentsRaw = formData.get("assignments") as string;

  const errors: Record<string, string> = {};

  if (!name?.trim()) {
    errors.name = "Name is required";
  }

  const onHand = parseInt(formData.get("onHand") as string, 10);
  if (!Number.isFinite(onHand) || onHand < 0) {
    errors.onHand = "Opening count must be zero or more";
  }

  const lowThreshold = parseInt(formData.get("lowThreshold") as string, 10);
  if (!Number.isFinite(lowThreshold) || lowThreshold < 0) {
    errors.lowThreshold = "Threshold must be zero or more";
  }

  let assignments: AssignmentInput[] = [];
  try {
    assignments = JSON.parse(assignmentsRaw || "[]");
  } catch {
    errors.assignments = "Invalid product assignment data";
  }

  for (const assignment of assignments) {
    if (!assignment.shopifyProductId) {
      errors.assignments = "Every assignment needs a product";
      break;
    }
    if (!assignment.unitsPerItem || assignment.unitsPerItem < 1) {
      errors.assignments = "Units per item must be at least 1";
      break;
    }
  }

  if (Object.keys(errors).length > 0) {
    return json({ errors }, { status: 400 });
  }

  if (id === "new") {
    try {
      await createPackagingType({
        shopDomain: session.shop,
        name: name.trim(),
        sku: sku || undefined,
        onHand,
        lowThreshold,
        notifyEmails: notifyEmails || undefined,
        assignments,
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return json(
          { errors: { name: "You already have a packaging type with that name" } },
          { status: 400 }
        );
      }
      throw error;
    }

    return redirect("/app/packaging");
  }

  const updated = await updatePackagingType(id!, session.shop, {
    name: name.trim(),
    sku: sku || undefined,
    lowThreshold,
    notifyEmails: notifyEmails || undefined,
    active,
    assignments,
  });

  if (!updated) {
    throw new Response("Packaging type not found", { status: 404 });
  }

  return redirect("/app/packaging");
};

export default function PackagingDetailPage() {
  const { packagingType } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <PackagingForm
      packagingType={packagingType ?? undefined}
      errors={actionData && "errors" in actionData ? actionData.errors : undefined}
    />
  );
}
