import {
  Card,
  TextField,
  Button,
  Checkbox,
  InlineStack,
  BlockStack,
  Text,
} from "@shopify/polaris";
import { DeleteIcon, ArrowUpIcon, ArrowDownIcon } from "@shopify/polaris-icons";

export interface OptionData {
  name: string;
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
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingSm" as="h3">
            Option {index + 1}
          </Text>
          <InlineStack gap="200">
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

        <TextField
          label="Name"
          value={option.name}
          onChange={(value) => onChange(index, "name", value)}
          autoComplete="off"
          placeholder="e.g. Dark Chocolate Truffle"
        />

        <TextField
          label="Image URL"
          value={option.imageUrl}
          onChange={(value) => onChange(index, "imageUrl", value)}
          autoComplete="off"
          placeholder="https://example.com/image.jpg"
          helpText="Optional. URL to an image for this option."
        />

        <Checkbox
          label="In stock"
          checked={option.inStock}
          onChange={(value) => onChange(index, "inStock", value)}
          helpText="Uncheck to mark this flavor as out of stock"
        />
      </BlockStack>
    </Card>
  );
}
