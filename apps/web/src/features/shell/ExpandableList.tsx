import { Card } from "@astryxdesign/core/Card";
import { useAnimatedLayout, useMergedRefs } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useRef, useState, type ReactNode, type Ref } from "react";

/** One record as a row that opens in place. */
export interface ExpandableRecord {
  id: string;
  title: string;
  /** The line under the title, such as a key's first characters with its status at the end. */
  summary: ReactNode;
  /** What opening the row shows under it: the record's other details, then its actions. */
  details: ReactNode;
  /** The name of the row's toggle, such as "Details for key Laptop", for assistive technology. */
  toggleLabel: string;
}

const Row = ({
  record,
  isOpen,
  onToggle,
}: {
  record: ExpandableRecord;
  isOpen: boolean;
  onToggle: () => void;
}) => {
  // The chevron is the row's one control, so it tells assistive technology whether the details
  // are open. A tap anywhere on the row presses it (ListItem interactiveRef).
  const toggle = useRef<HTMLButtonElement>(null);
  const detailsId = useId();
  return (
    <>
      <ListItem
        itemKey={record.id}
        label={
          <Text weight="semibold" maxLines={1}>
            {record.title}
          </Text>
        }
        description={record.summary}
        endContent={
          <IconButton
            ref={toggle}
            label={record.toggleLabel}
            variant="ghost"
            size="sm"
            icon={<Icon icon={isOpen ? ChevronUp : ChevronDown} size="sm" />}
            aria-expanded={isOpen}
            aria-controls={isOpen ? detailsId : undefined}
            onClick={onToggle}
          />
        }
        interactiveRef={toggle}
      />
      {isOpen ? (
        <ListItem
          itemKey={`${record.id} details`}
          label={
            <VStack id={detailsId} gap={4}>
              {record.details}
            </VStack>
          }
        />
      ) : null}
    </>
  );
};

/**
 * Records as rows of a list in a card, where a table has no room for a column per detail, as on a
 * phone. Each row shows a record's name in bold on a line of its own and one line under it, so a
 * phone shows a short list; a tap opens the row in place to show the rest and the record's
 * actions, and another tap closes it. Several rows can be open at once, so two records can be
 * compared. Rows have no dividers and keep the list's padding, so a pressed or hovered row shows a
 * rounded background inside the card rather than a band across it.
 */
export const ExpandableList = ({
  records,
  ref,
}: {
  records: readonly ExpandableRecord[];
  /** The card's ref, for example to measure the room the list has. */
  ref?: Ref<HTMLElement>;
}) => {
  const card = useRef<HTMLElement>(null);
  const cardRef = useMergedRefs(card, ref);
  // Opening and closing a row moves the rows under it into place rather than at once.
  const animatedLayout = useAnimatedLayout({ containerRef: card });
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  return (
    <Card ref={cardRef} elevation="low">
      <List edge="padded" animatedLayout={animatedLayout}>
        {records.map((record) => (
          <Row
            key={record.id}
            record={record}
            isOpen={open.has(record.id)}
            onToggle={() => toggle(record.id)}
          />
        ))}
      </List>
    </Card>
  );
};
