import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import type { ReactNode } from "react";

/**
 * One record as a row of a list, where a table has no room for a column per detail, as on a phone.
 * Every row has the same shape at every width: the record's name in bold on a line of its own,
 * level with its menu; then, for a key, its first characters with its status at the end of that
 * line; then a line or two of details. The name has the whole line, so a status never cuts it
 * short. Each line keeps to one line and ends in an ellipsis, whose tooltip holds the rest.
 */
export const SummaryRow = ({
  title,
  code,
  status,
  details,
  menu,
}: {
  title: string;
  /** What tells the record apart in code type, such as a key's first characters. */
  code?: string;
  status?: ReactNode;
  details: readonly string[];
  menu: ReactNode;
}) => (
  <ListItem
    align="first-line"
    label={
      <Text weight="semibold" maxLines={1}>
        {title}
      </Text>
    }
    description={
      <VStack gap={0.5}>
        {code === undefined && status === undefined ? null : (
          <HStack gap={3} vAlign="center">
            <StackItem size="fill">
              {code === undefined ? null : (
                <Text type="code" color="secondary" maxLines={1}>
                  {code}
                </Text>
              )}
            </StackItem>
            {status}
          </HStack>
        )}
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
