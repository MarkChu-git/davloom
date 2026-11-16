import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { ReactNode } from "react";

/** The title row every Dashboard page starts with. */
export const PageHeader = ({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) => (
  <HStack hAlign="between" vAlign="center" gap={4} wrap="wrap">
    <VStack gap={1}>
      <Heading level={1}>{title}</Heading>
      <Text type="supporting" color="secondary">
        {description}
      </Text>
    </VStack>
    {actions === undefined ? null : (
      <HStack gap={2} vAlign="center" wrap="wrap">
        {actions}
      </HStack>
    )}
  </HStack>
);
