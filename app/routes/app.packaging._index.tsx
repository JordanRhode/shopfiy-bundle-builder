import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  Banner,
  EmptyState,
  useBreakpoints,
  Button,
  Modal,
  TextField,
  BlockStack,
  InlineStack,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import {
  getPackagingTypes,
  deletePackagingType,
  adjustOnHand,
} from "../models/Packaging.server";
import { checkLowStock } from "../services/packagingNotifications.server";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const packagingTypes = await getPackagingTypes(session.shop);
  return json({ packagingTypes });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  if (action === "delete") {
    const id = formData.get("packagingTypeId") as string;
    await deletePackagingType(id, session.shop);
    return json({ success: true });
  }

  if (action === "adjust") {
    const id = formData.get("packagingTypeId") as string;
    const delta = parseInt(formData.get("delta") as string, 10);
    const note = (formData.get("note") as string) || undefined;

    if (!Number.isFinite(delta) || delta === 0) {
      return json({ error: "Enter a non-zero adjustment" }, { status: 400 });
    }

    const updated = await adjustOnHand(id, session.shop, delta, note);
    if (!updated) {
      return json({ error: "Packaging type not found" }, { status: 404 });
    }

    // A manual drawdown can cross the threshold just like an order can.
    await checkLowStock(session.shop, [id]);
    return json({ success: true });
  }

  return json({ error: "Unknown action" }, { status: 400 });
};

export default function PackagingListPage() {
  const { packagingTypes } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const { smUp } = useBreakpoints();

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<string | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustNote, setAdjustNote] = useState("");

  const handleDeleteConfirm = useCallback(() => {
    if (deleteTarget) {
      submit(
        { action: "delete", packagingTypeId: deleteTarget },
        { method: "post" }
      );
    }
    setDeleteTarget(null);
  }, [deleteTarget, submit]);

  const handleAdjustConfirm = useCallback(() => {
    if (adjustTarget) {
      submit(
        {
          action: "adjust",
          packagingTypeId: adjustTarget,
          delta: adjustDelta,
          note: adjustNote,
        },
        { method: "post" }
      );
    }
    setAdjustTarget(null);
    setAdjustDelta("");
    setAdjustNote("");
  }, [adjustTarget, adjustDelta, adjustNote, submit]);

  const lowStock = packagingTypes.filter(
    (type) => type.active && type.onHand <= type.lowThreshold
  );

  if (packagingTypes.length === 0) {
    return (
      <Page title="Packaging">
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Track your packaging stock"
                action={{
                  content: "Add packaging type",
                  onAction: () => navigate("/app/packaging/new"),
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Add your boxes and inserts — 4-count, 8-count, etch boxes —
                  then assign them to the products that use them. Counts are
                  deducted automatically when orders are paid and restored on
                  refunds and cancellations.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const resourceName = { singular: "packaging type", plural: "packaging types" };

  const rowMarkup = packagingTypes.map((type, index) => {
    const isLow = type.onHand <= type.lowThreshold;

    return (
      <IndexTable.Row
        id={type.id}
        key={type.id}
        position={index}
        onClick={() => navigate(`/app/packaging/${type.id}`)}
      >
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text variant="bodyMd" fontWeight="bold" as="span">
              {type.name}
            </Text>
            {type.sku && (
              <Text variant="bodySm" tone="subdued" as="span">
                {type.sku}
              </Text>
            )}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" as="span" numeric>
            {String(type.onHand)}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" as="span" numeric>
            {String(type.lowThreshold)}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {type.assignments.length}{" "}
          {type.assignments.length === 1 ? "product" : "products"}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="100">
            {!type.active ? (
              <Badge>Inactive</Badge>
            ) : isLow ? (
              <Badge tone="critical">Low stock</Badge>
            ) : (
              <Badge tone="success">In stock</Badge>
            )}
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {/* Polaris Button.onClick takes no event, so the row's navigation is
              stopped on a wrapper instead. */}
          <div
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            role="presentation"
          >
            <InlineStack gap="300">
              <Button variant="plain" onClick={() => setAdjustTarget(type.id)}>
                Adjust
              </Button>
              <Button
                variant="plain"
                tone="critical"
                onClick={() => setDeleteTarget(type.id)}
              >
                Delete
              </Button>
            </InlineStack>
          </div>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title="Packaging"
      primaryAction={{
        content: "Add packaging type",
        onAction: () => navigate("/app/packaging/new"),
      }}
    >
      <Layout>
        {lowStock.length > 0 && (
          <Layout.Section>
            <Banner tone="critical" title="Packaging running low">
              <BlockStack gap="100">
                {lowStock.map((type) => (
                  <Text as="p" key={type.id}>
                    {type.name}: {type.onHand} on hand (threshold{" "}
                    {type.lowThreshold})
                  </Text>
                ))}
              </BlockStack>
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <Card padding="0">
            <IndexTable
              condensed={!smUp}
              resourceName={resourceName}
              itemCount={packagingTypes.length}
              headings={[
                { title: "Packaging" },
                { title: "On hand" },
                { title: "Threshold" },
                { title: "Assigned to" },
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
        open={adjustTarget !== null}
        onClose={() => setAdjustTarget(null)}
        title="Adjust count"
        primaryAction={{ content: "Apply", onAction: handleAdjustConfirm }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setAdjustTarget(null) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <TextField
              label="Adjustment"
              type="number"
              value={adjustDelta}
              onChange={setAdjustDelta}
              autoComplete="off"
              helpText="Positive to add stock, negative to remove. e.g. 250 for a new case, -3 for damaged boxes."
            />
            <TextField
              label="Note"
              value={adjustNote}
              onChange={setAdjustNote}
              autoComplete="off"
              placeholder="Restock from supplier"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete packaging type"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDeleteConfirm,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setDeleteTarget(null) },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure? This removes the packaging type, its product
            assignments, and its full count history. This cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
