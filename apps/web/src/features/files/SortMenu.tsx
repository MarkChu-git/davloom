import {
  DropdownMenu,
  DropdownMenuDivider,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@astryxdesign/core/DropdownMenu";
import type { TableSortDirection, TableSortState } from "@astryxdesign/core/Table";
import { spacingVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { useT } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages/en";

/** What a listing sorts by: the name, the size, or the time of the last change. */
export type SortKey = "name" | "sizeBytes" | "modifiedAt";

interface SortOption {
  key: SortKey;
  label: MessageKey;
  /** The order in the button's words, after the key, such as "smallest first". */
  ascending: MessageKey;
  descending: MessageKey;
  /** The same order as a choice of the menu, such as "Smallest first". */
  ascendingItem: MessageKey;
  descendingItem: MessageKey;
}

const BY_NAME: SortOption = {
  key: "name",
  label: "field.name",
  ascending: "sort.aToZ",
  descending: "sort.zToA",
  ascendingItem: "sort.aToZ",
  descendingItem: "sort.zToA",
};

const KEYS: readonly SortOption[] = [
  BY_NAME,
  {
    key: "sizeBytes",
    label: "files.size",
    ascending: "sort.smallestFirst",
    descending: "sort.largestFirst",
    ascendingItem: "sort.smallestFirst.item",
    descendingItem: "sort.largestFirst.item",
  },
  {
    key: "modifiedAt",
    label: "files.modified",
    ascending: "sort.oldestFirst",
    descending: "sort.newestFirst",
    ascendingItem: "sort.oldestFirst.item",
    descendingItem: "sort.newestFirst.item",
  },
];

const styles = stylex.create({
  // A small button's padding would start its words past the names below. Pulled back by that
  // padding, the words start where each row's icon does, as the Name header's did.
  trigger: { marginInlineStart: `calc(-1 * ${spacingVars["--spacing-3"]})` },
});

/**
 * How a listing too narrow for its Size and Modified columns is sorted, since their headers were
 * where it was sorted. The menu takes the Name header's place and says the order it keeps, such as
 * "Size, largest first", and offers each key either way. Folders still stay above files.
 */
export const SortMenu = ({
  sort,
  onSortChange,
}: {
  sort: TableSortState<SortKey>;
  onSortChange: (sort: TableSortState<SortKey>) => void;
}) => {
  const t = useT();
  const current = sort[0];
  const key = KEYS.find((option) => option.key === current?.sortKey);
  const direction: TableSortDirection = current?.direction ?? "ascending";
  const orderOf = (option: SortOption) =>
    direction === "ascending" ? option.ascending : option.descending;
  // The order's words follow the key, Name's until the listing has one.
  const shown = key ?? BY_NAME;
  return (
    <DropdownMenu
      button={{
        label:
          key === undefined
            ? t("sort.sort")
            : t("sort.current", { key: t(key.label), order: t(orderOf(key)) }),
        variant: "ghost",
        size: "sm",
        xstyle: styles.trigger,
      }}
    >
      <DropdownMenuRadioGroup
        label={t("sort.by")}
        value={key?.key}
        onChange={(value) => {
          const chosen = KEYS.find((option) => option.key === value);
          if (chosen !== undefined) {
            onSortChange([{ sortKey: chosen.key, direction }]);
          }
        }}
      >
        {KEYS.map((option) => (
          <DropdownMenuRadioItem key={option.key} value={option.key} label={t(option.label)} />
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuDivider />
      <DropdownMenuRadioGroup
        label={t("sort.order")}
        value={key === undefined ? undefined : direction}
        onChange={(value) => {
          if (value === "ascending" || value === "descending") {
            onSortChange([{ sortKey: shown.key, direction: value }]);
          }
        }}
      >
        <DropdownMenuRadioItem value="ascending" label={t(shown.ascendingItem)} />
        <DropdownMenuRadioItem value="descending" label={t(shown.descendingItem)} />
      </DropdownMenuRadioGroup>
    </DropdownMenu>
  );
};
