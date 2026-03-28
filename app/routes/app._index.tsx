import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  EmptyState,
  useBreakpoints,
  Button,
  Modal,
  BlockStack,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { getBundles, deleteBundle } from "../models/Bundle.server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const bundles = await getBundles(session.shop);
  return json({ bundles });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "delete") {
    const bundleId = formData.get("bundleId") as string;
    await deleteBundle(bundleId, session.shop);
    return json({ success: true });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function BundleListPage() {
  const { bundles } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const { smUp } = useBreakpoints();

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [bundleToDelete, setBundleToDelete] = useState<string | null>(null);

  const handleDeleteClick = useCallback((bundleId: string) => {
    setBundleToDelete(bundleId);
    setDeleteModalOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (bundleToDelete) {
      submit(
        { action: "delete", bundleId: bundleToDelete },
        { method: "post" }
      );
    }
    setDeleteModalOpen(false);
    setBundleToDelete(null);
  }, [bundleToDelete, submit]);

  const emptyState = (
    <EmptyState
      heading="Create your first bundle product"
      action={{
        content: "Create bundle",
        onAction: () => navigate("/app/bundles/new"),
      }}
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>
        Let customers build their own bundles by choosing from your available
        options. Perfect for gift boxes, sample packs, and more.
      </p>
    </EmptyState>
  );

  if (bundles.length === 0) {
    return (
      <Page>
        <Layout>
          <Layout.Section>
            <Card>{emptyState}</Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const resourceName = { singular: "bundle", plural: "bundles" };

  const rowMarkup = bundles.map((bundle, index) => {
    const lowInventoryOptions = bundle.options.filter(
      (opt) => opt.inventory <= 5 && opt.inventory > 0
    );
    const outOfStockOptions = bundle.options.filter(
      (opt) => opt.inventory === 0
    );

    return (
      <IndexTable.Row
        id={bundle.id}
        key={bundle.id}
        position={index}
        onClick={() => navigate(`/app/bundles/${bundle.id}`)}
      >
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {bundle.title}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {bundle.variantMaps.length}{" "}
          {bundle.variantMaps.length === 1 ? "variant" : "variants"}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {bundle.options.length}{" "}
          {bundle.options.length === 1 ? "option" : "options"}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="100">
            {bundle.active ? (
              <Badge tone="success">Active</Badge>
            ) : (
              <Badge>Inactive</Badge>
            )}
            {outOfStockOptions.length > 0 && (
              <Badge tone="critical">
                {outOfStockOptions.length} out of stock
              </Badge>
            )}
            {lowInventoryOptions.length > 0 && (
              <Badge tone="warning">
                {lowInventoryOptions.length} low stock
              </Badge>
            )}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Button
            variant="plain"
            tone="critical"
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteClick(bundle.id);
            }}
          >
            Delete
          </Button>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title="Bundles"
      primaryAction={{
        content: "Create bundle",
        onAction: () => navigate("/app/bundles/new"),
      }}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              condensed={!smUp}
              resourceName={resourceName}
              itemCount={bundles.length}
              headings={[
                { title: "Bundle" },
                { title: "Variants" },
                { title: "Options" },
                { title: "Status" },
                { title: "Actions" },
              ]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete bundle"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDeleteConfirm,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setDeleteModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to delete this bundle? This action cannot be
            undone. The Shopify product will not be affected.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
