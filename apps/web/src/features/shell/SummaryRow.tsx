import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import type { ReactNode } from "react";

/**
 * One record as a row of a list, where a table has no room for a column per detail, as on a phone.
 * Every row has the same shape: the record's name in bold with its status at the end of that line,
 * a line or two of details beneath, and its menu level with the name. Each line keeps to one line
 * and ends in an ellipsis, whose tooltip holds the rest.
 */
export const SummaryRow = ({
  title,
  status,
  details,
  menu,
}: {
  title: string;
  status?: ReactNode;
  details: readonly string[];
  menu: ReactNode;
}) => (
  <ListItem
    align="first-line"
    label={
      <HStack gap={3} vAlign="center">
        <StackItem size="fill">
          <Text weight="semibold" maxLines={1}>
            {title}
          </Text>
        </StackItem>
        {status}
      </HStack>
    }
    description={
      <VStack gap={0.5}>
        {details.map((line) => (
          <Text key={line} type="supporting" color="secondary" maxLines={1}>
            {line}
          </Text>
        ))}
      </VStack>
    }
    endContent={menu}
  />
);
