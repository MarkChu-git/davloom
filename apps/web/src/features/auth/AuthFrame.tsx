import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { colorVars } from "@astryxdesign/core/theme/tokens.stylex";
import { LoomMark } from "@davloom/ui";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

const styles = stylex.create({
  // A page outside the Dashboard's shell paints its own ground.
  page: {
    minHeight: "100dvh",
    backgroundColor: colorVars["--color-background-body"],
  },
  // At most 400 px, narrowing with a phone's screen.
  column: {
    width: "100%",
    maxWidth: 400,
  },
});

/** A page of its own, outside the Dashboard: the brand above a card that holds a form. */
export const AuthFrame = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) => (
  // The page's main landmark, as the Dashboard's shell gives its pages one, so that every part of
  // the page sits in a landmark.
  <Center role="main" axis="both" padding={4} xstyle={styles.page}>
    <VStack gap={6} hAlign="center" xstyle={styles.column}>
      <HStack gap={2} vAlign="center">
        <LoomMark />
        <Text type="large" size="xl">
          Davloom
        </Text>
      </HStack>
      <Card padding={6} width="100%" elevation="low">
        <VStack gap={4} hAlign="stretch">
          <VStack gap={1}>
            <Heading level={1}>{title}</Heading>
            {description === undefined ? null : (
              <Text type="supporting" color="secondary">
                {description}
              </Text>
            )}
          </VStack>
          {children}
        </VStack>
      </Card>
    </VStack>
  </Center>
);

/** What a page shows while it asks the server where the person stands. */
export const Waiting = ({ label }: { label: string }) => (
  <Center role="main" axis="both" padding={4} xstyle={styles.page}>
    <Spinner label={label} />
  </Center>
);
