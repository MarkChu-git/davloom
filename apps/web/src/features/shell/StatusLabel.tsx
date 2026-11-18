import { Icon } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";

export type Tone = "success" | "warning" | "error" | "info";

/**
 * A status as an icon in the status's color and a word. Each tone also has its own glyph, and the
 * label always carries the meaning (WCAG 1.4.1: never color alone).
 */
export const StatusLabel = ({ tone, label }: { tone: Tone; label: string }) => (
  <HStack gap={1.5} vAlign="center">
    <Icon icon={tone} color={tone} size="sm" />
    <Text type="body" weight={tone === "error" ? "semibold" : undefined}>
      {label}
    </Text>
  </HStack>
);
