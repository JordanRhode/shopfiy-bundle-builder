import { useState, useCallback } from "react";
import { useNavigate, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Checkbox,
  Divider,
  Box,
  Badge,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";

const WILDCARD_VARIANT = "*";

export interface AssignmentData {
  shopifyProductId: string;
  shopifyVariantId: string;
  productTitle: string;
  variantTitle: string;
  unitsPerItem: number;
}

export interface LedgerEntryData {
  id: string;
  delta: number;
  reason: string;
  note: string | null;
  shopifyOrderId: string | null;
  createdAt: string;
}

interface PackagingFormProps {
  packagingType?: {
    id: string;
    name: string;
    sku: string | null;
    onHand: number;
    lowThreshold: number;
    notifyEmails: string | null;
    active: boolean;
    assignments: AssignmentData[];
    ledger: LedgerEntryData[];
  };
  errors?: Record<string, string>;
}

export default function PackagingForm({
  packagingType,
  errors,
}: PackagingFormProps) {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const isSubmitting = navigation.state === "submitting";
  const isEditing = !!packagingType;

  const [name, setName] = useState(packagingType?.name || "");
  const [sku, setSku] = useState(packagingType?.sku || "");
  const [onHand, setOnHand] = useState(String(packagingType?.onHand ?? 0));
  const [lowThreshold, setLowThreshold] = useState(
    String(packagingType?.lowThreshold ?? 0)
  );
  const [notifyEmails, setNotifyEmails] = useState(
    packagingType?.notifyEmails || ""
  );
  const [active, setActive] = useState(packagingType?.active ?? true);
  const [assignments, setAssignments] = useState<AssignmentData[]>(
    packagingType?.assignments || []
  );

  const addAssignments = useCallback(
    (incoming: AssignmentData[]) => {
      setAssignments((prev) => {
        const seen = new Set(
          prev.map((a) => `${a.shopifyProductId}|${a.shopifyVariantId}`)
        );
        const merged = [...prev];
        for (const assignment of incoming) {
          const key = `${assignment.shopifyProductId}|${assignment.shopifyVariantId}`;
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(assignment);
          }
        }
        return merged;
      });
    },
    []
  );

  const handleAddProducts = useCallback(async () => {
    try {
      const selection = await shopify.resourcePicker({
        type: "product",
        action: "select",
        multiple: true,
        filter: { variants: false, draft: false, archived: false },
      });

      if (!selection || selection.length === 0) {
        return;
      }

      addAssignments(
        selection.map((product: any) => ({
          shopifyProductId: product.id,
          shopifyVariantId: WILDCARD_VARIANT,
          productTitle: product.title,
          variantTitle: "All variants",
          unitsPerItem: 1,
        }))
      );
    } catch (e) {
      // User cancelled the picker
    }
  }, [shopify, addAssignments]);

  const handleAddVariants = useCallback(async () => {
    try {
      const selection = await shopify.resourcePicker({
        type: "product",
        action: "select",
        multiple: true,
        filter: { variants: true, draft: false, archived: false },
      });

      if (!selection || selection.length === 0) {
        return;
      }

      const incoming: AssignmentData[] = [];
      for (const product of selection as any[]) {
        for (const variant of product.variants || []) {
          incoming.push({
            shopifyProductId: product.id,
            shopifyVariantId: variant.id,
            productTitle: product.title,
            variantTitle: variant.title || "Default",
            unitsPerItem: 1,
          });
        }
      }
      addAssignments(incoming);
    } catch (e) {
      // User cancelled the picker
    }
  }, [shopify, addAssignments]);

  const handleUnitsChange = useCallback((index: number, value: string) => {
    setAssignments((prev) =>
      prev.map((assignment, i) =>
        i === index
          ? { ...assignment, unitsPerItem: Math.max(1, parseInt(value, 10) || 1) }
          : assignment
      )
    );
  }, []);

  const handleRemoveAssignment = useCallback((index: number) => {
    setAssignments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = useCallback(() => {
    const formData = new FormData();
    formData.set("name", name);
    formData.set("sku", sku);
    formData.set("onHand", onHand);
    formData.set("lowThreshold", lowThreshold);
    formData.set("notifyEmails", notifyEmails);
    formData.set("active", String(active));
    formData.set("assignments", JSON.stringify(assignments));
    submit(formData, { method: "post" });
  }, [
    name,
    sku,
    onHand,
    lowThreshold,
    notifyEmails,
    active,
    assignments,
    submit,
  ]);

  return (
    <Page
      title={isEditing ? packagingType.name : "Add packaging type"}
      backAction={{ content: "Packaging", onAction: () => navigate("/app/packaging") }}
      primaryAction={{
        content: isEditing ? "Save" : "Create",
        onAction: handleSubmit,
        loading: isSubmitting,
      }}
    >
      <Layout>
        {errors?.form && (
          <Layout.Section>
            <Banner tone="critical">{errors.form}</Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Details
              </Text>
              <FormLayout>
                <TextField
                  label="Name"
                  value={name}
                  onChange={setName}
                  autoComplete="off"
                  error={errors?.name}
                  placeholder="8-count box"
                />
                <TextField
                  label="SKU"
                  value={sku}
                  onChange={setSku}
                  autoComplete="off"
                  helpText="Optional. Your own reference for reordering."
                />
                {isEditing ? (
                  <TextField
                    label="On hand"
                    value={onHand}
                    onChange={() => {}}
                    autoComplete="off"
                    disabled
                    helpText="Use Adjust on the packaging list to change the count, so the history stays accurate."
                  />
                ) : (
                  <TextField
                    label="Opening count"
                    type="number"
                    value={onHand}
                    onChange={setOnHand}
                    autoComplete="off"
                    error={errors?.onHand}
                  />
                )}
                <TextField
                  label="Low stock threshold"
                  type="number"
                  value={lowThreshold}
                  onChange={setLowThreshold}
                  autoComplete="off"
                  error={errors?.lowThreshold}
                  helpText="You'll be alerted when the count falls to or below this number."
                />
                <TextField
                  label="Notify emails"
                  value={notifyEmails}
                  onChange={setNotifyEmails}
                  autoComplete="off"
                  helpText="Comma-separated. Leave blank to rely on the in-app banner and Slack."
                />
                <Checkbox
                  label="Active"
                  checked={active}
                  onChange={setActive}
                  helpText="Inactive packaging is not deducted when orders come in."
                />
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">
                  Products using this packaging
                </Text>
                <InlineStack gap="200">
                  <Button onClick={handleAddProducts}>Add products</Button>
                  <Button onClick={handleAddVariants}>Add variants</Button>
                </InlineStack>
              </InlineStack>

              {errors?.assignments && (
                <Banner tone="critical">{errors.assignments}</Banner>
              )}

              {assignments.length === 0 ? (
                <Box paddingBlock="400">
                  <Text as="p" tone="subdued">
                    No products assigned yet. Add a product to deduct this
                    packaging whenever it sells. A variant-level assignment
                    overrides an all-variants one for the same product.
                  </Text>
                </Box>
              ) : (
                <BlockStack gap="300">
                  {assignments.map((assignment, index) => (
                    <Box key={`${assignment.shopifyProductId}|${assignment.shopifyVariantId}`}>
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                        gap="400"
                      >
                        <BlockStack gap="050">
                          <Text variant="bodyMd" fontWeight="semibold" as="span">
                            {assignment.productTitle}
                          </Text>
                          <InlineStack gap="200" blockAlign="center">
                            {assignment.shopifyVariantId === WILDCARD_VARIANT ? (
                              <Badge tone="info">All variants</Badge>
                            ) : (
                              <Badge>{assignment.variantTitle}</Badge>
                            )}
                          </InlineStack>
                        </BlockStack>
                        <InlineStack gap="300" blockAlign="center">
                          <Box width="120px">
                            <TextField
                              label="Units each"
                              labelHidden
                              type="number"
                              value={String(assignment.unitsPerItem)}
                              onChange={(value) =>
                                handleUnitsChange(index, value)
                              }
                              autoComplete="off"
                              prefix="x"
                            />
                          </Box>
                          <Button
                            variant="plain"
                            tone="critical"
                            onClick={() => handleRemoveAssignment(index)}
                          >
                            Remove
                          </Button>
                        </InlineStack>
                      </InlineStack>
                      <Box paddingBlockStart="300">
                        <Divider />
                      </Box>
                    </Box>
                  ))}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {isEditing && packagingType.ledger.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Recent history
                </Text>
                <BlockStack gap="200">
                  {packagingType.ledger.map((entry) => (
                    <InlineStack
                      key={entry.id}
                      align="space-between"
                      blockAlign="center"
                    >
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd">
                          {entry.note || entry.reason}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {new Date(entry.createdAt).toLocaleString()}
                        </Text>
                      </BlockStack>
                      <Text
                        as="span"
                        variant="bodyMd"
                        numeric
                        tone={entry.delta < 0 ? "critical" : "success"}
                      >
                        {entry.delta > 0 ? `+${entry.delta}` : String(entry.delta)}
                      </Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
