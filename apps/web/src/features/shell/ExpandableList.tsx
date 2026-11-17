import { Card } from "@astryxdesign/core/Card";
import { useAnimatedLayout, useMergedRefs } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useRef, useState, type ReactNode, type Ref } from "react";

/** One record as a row that opens in place. */
export interface ExpandableRecord {
  id: string;
  /** The record's name. A string shows in bold on one line of its own. */
  title: ReactNode;
  /** A picture at the row's start, such as the cause of a failed operation. */
  icon?: ReactNode;
  /** The line under the title, such as a key's first characters with its status at the end. */
  summary?: ReactNode;
  /** A short value at the row's end, before its chevron, such as how long ago it happened. */
  meta?: ReactNode;
  /** What opening the row shows under it: the record's other details, then its actions. */
  details: ReactNode;
  /** The name of the row's chevron and of its details, such as "Details for key Laptop". */
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
  const chevron = (
    <IconButton
      ref={toggle}
      label={record.toggleLabel}
      tooltip={record.toggleLabel}
      variant="ghost"
      size="sm"
      icon={<Icon icon={isOpen ? ChevronUp : ChevronDown} size="sm" />}
      aria-expanded={isOpen}
      aria-controls={isOpen ? detailsId : undefined}
      onClick={onToggle}
    />
  );
  return (
    <>
      <ListItem
        itemKey={record.id}
        startContent={record.icon}
        label={
          typeof record.title === "string" ? (
            <Text weight="semibold" maxLines={1}>
              {record.title}
            </Text>
          ) : (
            record.title
          )
        }
        description={record.summary}
        endContent={
          record.meta === undefined ? (
            chevron
          ) : (
            <HStack gap={1} vAlign="center">
              {record.meta}
              {chevron}
            </HStack>
          )
        }
        interactiveRef={toggle}
      />
      {isOpen ? (
        // The ids of keys, mounts and errors never hold a slash, so this key cannot be another row's.
        <ListItem
          itemKey={`${record.id}/details`}
          label={
            // Named like the chevron, so a screen reader says whose details these are.
            <VStack id={detailsId} role="group" aria-label={record.toggleLabel} gap={4}>
              {record.details}
            </VStack>
          }
        />
      ) : null}
    </>
  );
};

/**
 * Records as rows that open in place. Each row shows a record's name and at most one line under
 * it; a tap opens the row to show the rest and the record's actions, and another tap closes it.
 * Several rows can be open at once, so two records can be compared. Rows have no dividers and keep
 * the list's padding, so a pressed or hovered row shows a rounded background rather than a band
 * across its card.
 */
export const ExpandableRows = ({
  records,
  edge = "padded",
}: {
  records: readonly ExpandableRecord[];
  /**
   * Where the rows sit in their container: inside its padding, as in a card of their own, or with
   * their content on the line of a heading above them, as in a panel with a title (Astryx List).
   */
  edge?: "padded" | "outset";
}) => {
  const rows = useRef<HTMLElement>(null);
  // Opening and closing a row moves the rows under it into place rather than at once. The list
  // holds which rows are open, so that it renders again, and animates, when one opens or closes.
  const animatedLayout = useAnimatedLayout({ containerRef: rows });
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  // A record that leaves the list forgets that its row was open, so a mount removed and added
  // again under the same folder name, which is its id, starts closed.
  const kept = [...open].filter((id) => records.some((record) => record.id === id));
  if (kept.length !== open.size) {
    setOpen(new Set(kept));
  }
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  return (
    <VStack ref={rows}>
      <List edge={edge} animatedLayout={animatedLayout}>
        {records.map((record) => (
          <Row
            key={record.id}
            record={record}
            isOpen={open.has(record.id)}
            onToggle={() => toggle(record.id)}
          />
        ))}
      </List>
    </VStack>
  );
};

/**
 * Records as rows in a card, where a table has no room for a column per detail, as on a phone.
 * Each row shows a record's name in bold on a line of its own and one line under it, so a phone
 * shows a short list (ExpandableRows).
 */
export const ExpandableList = ({
  records,
  ref,
}: {
  records: readonly ExpandableRecord[];
  /** The card's ref, for example to measure the room the list has. */
  ref?: Ref<HTMLElement>;
}) => {
  // Card takes the ref of its own element, which the callers measure as any element.
  const cardRef = useMergedRefs(ref);
  return (
    <Card ref={cardRef} elevation="low">
      <ExpandableRows records={records} />
    </Card>
  );
};
