import type { TableSortState } from "@astryxdesign/core/Table";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderPage } from "../../test/render";
import { SortMenu, type SortKey } from "./SortMenu";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = async (sort: TableSortState<SortKey>) => {
  const onSortChange = vi.fn<(next: TableSortState<SortKey>) => void>();
  await renderPage(<SortMenu sort={sort} onSortChange={onSortChange} />);
  return onSortChange;
};

describe("SortMenu", () => {
  it.each([
    [[], "Sort"],
    [[{ sortKey: "name", direction: "ascending" }], "Name, A to Z"],
    [[{ sortKey: "name", direction: "descending" }], "Name, Z to A"],
    [[{ sortKey: "sizeBytes", direction: "ascending" }], "Size, smallest first"],
    [[{ sortKey: "sizeBytes", direction: "descending" }], "Size, largest first"],
    [[{ sortKey: "modifiedAt", direction: "ascending" }], "Modified, oldest first"],
    [[{ sortKey: "modifiedAt", direction: "descending" }], "Modified, newest first"],
  ] satisfies [TableSortState<SortKey>, string][])("%j reads %s", async (sort, label) => {
    await show(sort);
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  });

  it.each([
    [[], "Modified", [{ sortKey: "modifiedAt", direction: "ascending" }]],
    [
      [{ sortKey: "sizeBytes", direction: "descending" }],
      "Name",
      [{ sortKey: "name", direction: "descending" }],
    ],
    [
      [{ sortKey: "name", direction: "ascending" }],
      "Size",
      [{ sortKey: "sizeBytes", direction: "ascending" }],
    ],
  ] satisfies [TableSortState<SortKey>, string, TableSortState<SortKey>][])(
    "from %j, choosing %s keeps the order: %j",
    async (sort, key, next) => {
      const onSortChange = await show(sort);
      await userEvent.click(screen.getByRole("button"));
      // A menu's popover never opens in happy-dom, so user-event takes its items for unclickable.
      fireEvent.click(await screen.findByRole("menuitemradio", { name: key }));
      expect(onSortChange).toHaveBeenCalledWith(next);
    },
  );

  it.each([
    [[], "Z to A", [{ sortKey: "name", direction: "descending" }]],
    [
      [{ sortKey: "modifiedAt", direction: "ascending" }],
      "Newest first",
      [{ sortKey: "modifiedAt", direction: "descending" }],
    ],
    [
      [{ sortKey: "sizeBytes", direction: "descending" }],
      "Smallest first",
      [{ sortKey: "sizeBytes", direction: "ascending" }],
    ],
  ] satisfies [TableSortState<SortKey>, string, TableSortState<SortKey>][])(
    "from %j, the order %s keeps the key: %j",
    async (sort, order, next) => {
      const onSortChange = await show(sort);
      await userEvent.click(screen.getByRole("button"));
      fireEvent.click(await screen.findByRole("menuitemradio", { name: order }));
      expect(onSortChange).toHaveBeenCalledWith(next);
    },
  );

  it("offers each key and both orders of the key it sorts by", async () => {
    await show([{ sortKey: "sizeBytes", direction: "ascending" }]);
    await userEvent.click(screen.getByRole("button"));
    const items = await screen.findAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([
      "Name",
      "Size",
      "Modified",
      "Smallest first",
      "Largest first",
    ]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
      "true",
      "false",
    ]);
  });
});
