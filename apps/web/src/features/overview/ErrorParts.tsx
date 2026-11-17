import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { colorVars, radiusVars, sizeVars } from "@astryxdesign/core/theme/tokens.stylex";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import * as stylex from "@stylexjs/stylex";
import { Clock } from "lucide-react";
import { FileName } from "../files/FileName";
import type { OperationError } from "../sample-data/data";
import { formatRelative } from "../sample-data/format";
import { causeOf, methodIconOf, minutesAgo, nameOf, shortSpan, type Cause } from "./errors";

const styles = stylex.create({
  // A cause sits in a disc tinted with the error color, the one hue the page gives failures.
  disc: {
    inlineSize: sizeVars["--size-element-sm"],
    blockSize: sizeVars["--size-element-sm"],
    borderRadius: radiusVars["--radius-full"],
    backgroundColor: colorVars["--color-error-muted"],
    color: colorVars["--color-on-error-muted"],
    flexShrink: 0,
  },
  discLarge: {
    inlineSize: sizeVars["--size-element-lg"],
    blockSize: sizeVars["--size-element-lg"],
  },
  // A failed operation's status code takes the error color, as the failed count above it does.
  errorInk: {
    color: colorVars["--color-text-error"],
  },
  // An age keeps its few characters whole where a name beside it gives way.
  keep: {
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
  // A path breaks anywhere rather than reach past a phone's window.
  path: {
    overflowWrap: "anywhere",
  },
});

/** A cause as a picture, named for assistive technology, in a disc of the error color. */
export const CauseMark = ({ cause, isLarge = false }: { cause: Cause; isLarge?: boolean }) => (
  <VStack hAlign="center" vAlign="center" xstyle={[styles.disc, isLarge && styles.discLarge]}>
    <Icon icon={cause.icon} size={isLarge ? "md" : "sm"} label={cause.label} />
  </VStack>
);

/** How long ago an operation failed, such as "12m" on screen and "12 minutes ago" when read. */
export const Age = ({ at }: { at: string }) => (
  <HStack gap={0} vAlign="center" xstyle={styles.keep}>
    <HStack aria-hidden>
      <Text type="supporting" color="secondary" hasTabularNumbers>
        {shortSpan(minutesAgo(at))}
      </Text>
    </HStack>
    <VisuallyHidden>{formatRelative(at)}</VisuallyHidden>
  </HStack>
);

/** The file or folder an operation failed on, with a picture of its kind. */
export const ErrorSubject = ({ error }: { error: OperationError }) => (
  <FileName name={nameOf(error)} kind={error.kind} weight="semibold" />
);

/** An error's details: the status code and its cause, the request, the reason, and when. */
export const ErrorDetails = ({ error }: { error: OperationError }) => (
  <VStack gap={3}>
    <HStack gap={2} vAlign="center">
      <Text weight="semibold" hasTabularNumbers xstyle={styles.errorInk}>
        {error.status}
      </Text>
      <Text weight="semibold">{causeOf(error).label}</Text>
    </HStack>
    <HStack gap={2} vAlign="start">
      <Icon icon={methodIconOf(error)} size="sm" color="secondary" label={error.method} />
      <Text type="code" size="sm" xstyle={styles.path}>
        {error.path}
      </Text>
    </HStack>
    <Text type="supporting" color="secondary">
      {error.message}
    </Text>
    <HStack gap={2} vAlign="center">
      <Icon icon={Clock} size="sm" color="secondary" />
      <Text type="supporting" color="secondary">
        {formatRelative(error.at)}
      </Text>
    </HStack>
  </VStack>
);
