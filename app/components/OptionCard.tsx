import { useState } from "react";
import {
  Card,
  TextField,
  Button,
  Checkbox,
  InlineStack,
  BlockStack,
  Text,
  Badge,
  Collapsible,
} from "@shopify/polaris";
import {
  DeleteIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@shopify/polaris-icons";

export interface OptionData {
  name: string;
  description: string;
  imageUrl: string;
  inStock: boolean;
  sortOrder: number;
  active: boolean;
}

interface OptionCardProps {
  option: OptionData;
  index: number;
  totalOptions: number;
  onChange: (index: number, field: keyof OptionData, value: string | number | boolean) => void;
  onRemove: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}

export default function OptionCard({
  option,
  index,
  totalOptions,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: OptionCardProps) {
  const [open, setOpen] = useState(!option.name);

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <Button
              icon={open ? ChevronUpIcon : ChevronDownIcon}
              onClick={() => setOpen(!open)}
              accessibilityLabel={open ? "Collapse" : "Expand"}
              variant="plain"
            >
                {option.name || `Option ${index + 1}`}
            </Button>
            {!option.inStock && <Badge tone="critical">Out of stock</Badge>}
          </InlineStack>
          <InlineStack gap="200">
            <Checkbox
              label="In stock"
              checked={option.inStock}
              onChange={(value) => onChange(index, "inStock", value)}
            />
            <Button
              icon={ArrowUpIcon}
              disabled={index === 0}
              onClick={() => onMoveUp(index)}
              accessibilityLabel="Move up"
              variant="plain"
            />
            <Button
              icon={ArrowDownIcon}
              disabled={index === totalOptions - 1}
              onClick={() => onMoveDown(index)}
              accessibilityLabel="Move down"
              variant="plain"
            />
            <Button
              icon={DeleteIcon}
              tone="critical"
              onClick={() => onRemove(index)}
              accessibilityLabel="Remove option"
              variant="plain"
            />
          </InlineStack>
        </InlineStack>

        <Collapsible open={open} id={`option-${index}`}>
          <BlockStack gap="300">
            <TextField
              label="Name"
              value={option.name}
              onChange={(value) => onChange(index, "name", value)}
              autoComplete="off"
              placeholder="e.g. Dark Chocolate Truffle"
            />

            <TextField
              label="Description"
              value={option.description}
              onChange={(value) => onChange(index, "description", value)}
              autoComplete="off"
              multiline={4}
              placeholder="Describe this flavor — ingredients, tasting notes, etc."
              helpText="Optional. Shown when customers click on this option."
            />

            <TextField
              label="Image URL"
              value={option.imageUrl}
              onChange={(value) => onChange(index, "imageUrl", value)}
              autoComplete="off"
              placeholder="https://example.com/image.jpg"
              helpText="Optional. URL to an image for this option."
            />
          </BlockStack>
        </Collapsible>
      </BlockStack>
    </Card>
  );
}
