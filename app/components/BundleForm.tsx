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
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";
import OptionCard, { type OptionData } from "./OptionCard";

interface VariantMapData {
  shopifyVariantId: string;
  variantTitle: string;
  selectionCount: number;
}

interface BundleFormProps {
  bundle?: {
    id: string;
    title: string;
    shopifyProductId: string;
    allowMultiples: boolean;
    active: boolean;
    variantMaps: VariantMapData[];
    options: OptionData[];
  };
  errors?: Record<string, string>;
}

export default function BundleForm({ bundle, errors }: BundleFormProps) {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const isSubmitting = navigation.state === "submitting";
  const isEditing = !!bundle;

  const [title, setTitle] = useState(bundle?.title || "");
  const [shopifyProductId, setShopifyProductId] = useState(
    bundle?.shopifyProductId || ""
  );
  const [allowMultiples, setAllowMultiples] = useState(
    bundle?.allowMultiples ?? true
  );
  const [variantMaps, setVariantMaps] = useState<VariantMapData[]>(
    bundle?.variantMaps || []
  );
  const [options, setOptions] = useState<OptionData[]>(
    bundle?.options || [
      { name: "", imageUrl: "", inStock: true, sortOrder: 0, active: true },
    ]
  );

  const handleSelectProduct = useCallback(async () => {
    try {
      const selection = await shopify.resourcePicker({
        type: "product",
        action: "select",
        filter: { variants: false, draft: false, archived: false },
      });

      if (selection && selection.length > 0) {
        const product = selection[0];
        setShopifyProductId(product.id);
        setTitle(product.title);

        if (product.variants) {
          setVariantMaps(
            product.variants.map((v: any) => ({
              shopifyVariantId: v.id,
              variantTitle: v.title,
              selectionCount: 0,
            }))
          );
        }
      }
    } catch (e) {
      // User cancelled the picker
    }
  }, [shopify]);

  const handleVariantCountChange = useCallback(
    (index: number, value: string) => {
      setVariantMaps((prev) =>
        prev.map((vm, i) =>
          i === index
            ? { ...vm, selectionCount: Math.max(1, parseInt(value) || 0) }
            : vm
        )
      );
    },
    []
  );

  const handleOptionChange = useCallback(
    (index: number, field: keyof OptionData, value: string | number | boolean) => {
      setOptions((prev) =>
        prev.map((opt, i) => (i === index ? { ...opt, [field]: value } : opt))
      );
    },
    []
  );

  const handleAddOption = useCallback(() => {
    setOptions((prev) => [
      ...prev,
      {
        name: "",
        imageUrl: "",
        inStock: true,
        sortOrder: prev.length,
        active: true,
      },
    ]);
  }, []);

  const handleRemoveOption = useCallback((index: number) => {
    setOptions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleMoveUp = useCallback((index: number) => {
    if (index === 0) return;
    setOptions((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next.map((opt, i) => ({ ...opt, sortOrder: i }));
    });
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setOptions((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next.map((opt, i) => ({ ...opt, sortOrder: i }));
    });
  }, []);

  const handleSubmit = useCallback(() => {
    const formData = new FormData();
    formData.set("title", title);
    formData.set("shopifyProductId", shopifyProductId);
    formData.set("allowMultiples", String(allowMultiples));
    formData.set("variantMaps", JSON.stringify(variantMaps));
    formData.set(
      "options",
      JSON.stringify(options.map((opt, i) => ({ ...opt, sortOrder: i })))
    );
    submit(formData, { method: "post" });
  }, [title, shopifyProductId, allowMultiples, variantMaps, options, submit]);

  return (
    <Page
      title={isEditing ? `Edit: ${bundle.title}` : "Create bundle"}
      backAction={{ content: "Bundles", onAction: () => navigate("/app") }}
      primaryAction={{
        content: isEditing ? "Save" : "Create",
        loading: isSubmitting,
        onAction: handleSubmit,
      }}
    >
      <Layout>
        {errors && Object.keys(errors).length > 0 && (
          <Layout.Section>
            <Banner tone="critical">
              <ul>
                {Object.values(errors).map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </Banner>
          </Layout.Section>
        )}

        {/* Product Selection */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Product
              </Text>
              {shopifyProductId ? (
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="100">
                    <Text variant="bodyMd" fontWeight="bold" as="span">
                      {title}
                    </Text>
                    <Text variant="bodySm" as="span" tone="subdued">
                      {shopifyProductId}
                    </Text>
                  </BlockStack>
                  <Button onClick={handleSelectProduct}>Change product</Button>
                </InlineStack>
              ) : (
                <Button onClick={handleSelectProduct} variant="primary">
                  Select product
                </Button>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Bundle Settings */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Settings
              </Text>
              <TextField
                label="Bundle title"
                value={title}
                onChange={setTitle}
                autoComplete="off"
                helpText="Display name for this bundle in your admin"
              />
              <Checkbox
                label="Allow multiple selections of the same option"
                checked={allowMultiples}
                onChange={setAllowMultiples}
                helpText="When enabled, customers can pick the same flavor more than once (e.g., 3x Dark Chocolate). When disabled, each flavor can only be selected once."
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Variant Mapping */}
        {variantMaps.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Variant selection counts
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  Set how many options the customer must select for each variant.
                  For example, "Box of 6" should require 6 selections.
                </Text>
                <FormLayout>
                  {variantMaps.map((vm, index) => (
                    <TextField
                      key={vm.shopifyVariantId}
                      label={vm.variantTitle}
                      type="number"
                      value={String(vm.selectionCount)}
                      onChange={(value) =>
                        handleVariantCountChange(index, value)
                      }
                      autoComplete="off"
                      min={1}
                      suffix="selections required"
                    />
                  ))}
                </FormLayout>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Bundle Options (Flavors) */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h2">
                  Options (Flavors)
                </Text>
                <Button onClick={handleAddOption}>Add option</Button>
              </InlineStack>
              <Text variant="bodySm" as="p" tone="subdued">
                These are the items customers can choose from when building their
                bundle. Set inventory to track available stock.
              </Text>
            </BlockStack>
          </Card>

          <Box paddingBlockStart="400">
            <BlockStack gap="400">
              {options.map((option, index) => (
                <OptionCard
                  key={index}
                  option={option}
                  index={index}
                  totalOptions={options.length}
                  onChange={handleOptionChange}
                  onRemove={handleRemoveOption}
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                />
              ))}
            </BlockStack>
          </Box>
        </Layout.Section>
      </Layout>
      <Box paddingBlockEnd="1600" />
    </Page>
  );
}
