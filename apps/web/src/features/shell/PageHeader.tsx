import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/Layout";
import type { ReactNode } from "react";

/** The title row every Dashboard page starts with: its name and the actions for the whole page. */
export const PageHeader = ({ title, actions }: { title: string; actions?: ReactNode }) => (
  <HStack hAlign="between" vAlign="center" gap={4} wrap="wrap">
    <Heading level={1}>{title}</Heading>
    {actions === undefined ? null : (
      <HStack gap={2} vAlign="center" wrap="wrap">
        {actions}
      </HStack>
    )}
  </HStack>
);
