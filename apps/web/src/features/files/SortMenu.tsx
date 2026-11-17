import {
  DropdownMenu,
  DropdownMenuDivider,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@astryxdesign/core/DropdownMenu";
import type { TableSortDirection, TableSortState } from "@astryxdesign/core/Table";
import { spacingVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";

/** What a listing sorts by: the name, the size, or the time of the last change. */
export type SortKey = "name" | "sizeBytes" | "modifiedAt";

interface SortOption {
  key: SortKey;
  label: string;
  ascending: string;
  descending: string;
}

const BY_NAME: SortOption = {
  key: "name",
  label: "Name",
  ascending: "A to Z",
  descending: "Z to A",
};

const KEYS: readonly SortOption[] = [
  BY_NAME,
  { key: "sizeBytes", label: "Size", ascending: "smallest first", descending: "largest first" },
  { key: "modifiedAt", label: "Modified", ascending: "oldest first", descending: "newest first" },
];

const styles = stylex.create({
  // A small button's padding would start its words past the names below. Pulled back by that
  // padding, the words start where each row's icon does, as the Name header's did.
  trigger: { marginInlineStart: `calc(-1 * ${spacingVars["--spacing-3"]})` },
});

const sentence = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

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
        label: key === undefined ? "Sort" : `${key.label}, ${orderOf(key)}`,
        variant: "ghost",
        size: "sm",
        xstyle: styles.trigger,
      }}
    >
      <DropdownMenuRadioGroup
        label="Sort by"
        value={key?.key}
        onChange={(value) => {
          const chosen = KEYS.find((option) => option.key === value);
          if (chosen !== undefined) {
            onSortChange([{ sortKey: chosen.key, direction }]);
          }
        }}
      >
        {KEYS.map((option) => (
          <DropdownMenuRadioItem key={option.key} value={option.key} label={option.label} />
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuDivider />
      <DropdownMenuRadioGroup
        label="Order"
        value={key === undefined ? undefined : direction}
        onChange={(value) => {
          if (value === "ascending" || value === "descending") {
            onSortChange([{ sortKey: shown.key, direction: value }]);
          }
        }}
      >
        <DropdownMenuRadioItem value="ascending" label={sentence(shown.ascending)} />
        <DropdownMenuRadioItem value="descending" label={sentence(shown.descending)} />
      </DropdownMenuRadioGroup>
    </DropdownMenu>
  );
};
