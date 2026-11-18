import { Icon } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import * as stylex from "@stylexjs/stylex";

export type Tone = "success" | "warning" | "error" | "info";

const styles = stylex.create({
  // The words give the label its baseline, so a row that lines up baselines, such as a backend
  // card's header, puts them on the line of the text beside them. The icon stays centered on them.
  label: {
    alignItems: "baseline",
  },
  icon: {
    alignSelf: "center",
  },
});

/**
 * A status as an icon in the status's color and a word. Each tone also has its own glyph, and the
 * label always carries the meaning (WCAG 1.4.1: never color alone).
 */
export const StatusLabel = ({ tone, label }: { tone: Tone; label: string }) => (
  <HStack gap={1.5} xstyle={styles.label}>
    <Icon icon={tone} color={tone} size="sm" xstyle={styles.icon} />
    <Text type="body" weight={tone === "error" ? "semibold" : undefined}>
      {label}
    </Text>
  </HStack>
);
