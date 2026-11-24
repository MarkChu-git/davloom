import { useImperativeAlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { useAnnounce } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutPanel,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import {
  Table,
  TableSelectionToolbar,
  pixel,
  proportional,
  useTableSelection,
  useTableSelectionState,
  useTableSortable,
  useTableSortableState,
  type TableColumn,
  type TableSortState,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { spacingVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FolderPlus, HardDrive, Lock, Upload as UploadIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createFolder,
  DavError,
  davProblem,
  downloadFile,
  isDavError,
  listFolder,
  lockEntry,
  readText,
  removeEntry,
  transferEntry,
  unlockEntry,
  type Entry,
  type EntryKind,
  type EntryLock,
  type Transfer,
} from "../api/dav";
import { keys, useBackends, useMounts } from "../api/queries";
import { buttonLabelled, inMain, linkTo, refocusIfLost } from "../shell/focus";
import { formatBytes, formatDateTime, formatRelative } from "../shell/format";
import { PageHeader, TitleLine } from "../shell/PageHeader";
import { useIsNarrowPage, usePageGutter } from "../shell/pageWidth";
import { LoadingRows } from "../shell/QueryState";
import { TitleAction } from "../shell/TitleRow";
import { nextFormKey, useFormDialog } from "../shell/useFormDialog";
import { useNarrowerThan } from "../shell/useNarrowerThan";
import { backendDetail } from "./backendDetail";
import { NameForm, TransferForm, type ListFolders } from "./dialogs";
import { isPreviewable } from "./preview";
import { FileName, splitExtension } from "./FileName";
import {
  destinationProblem,
  filesHref,
  joinPath,
  nameProblem,
  normalizePath,
  splitPath,
} from "./paths";
import { SortMenu, type SortKey } from "./SortMenu";
import { UploadPanel } from "./UploadPanel";
import { useRowWindow } from "./useRowWindow";
import type { Upload } from "./uploadStore";

const styles = stylex.create({
  // The cell is as wide as its column, so the name inside can end in an ellipsis.
  nameLink: { display: "block", maxWidth: "100%" },
  // Under the name, past its small icon and the gap after it, so the two lines start together.
  detail: { paddingInlineStart: spacingVars["--spacing-6"] },
  nameCell: { minWidth: 0 },
});

/** A compact row's height, in pixels, until the window measures one (useRowWindow). */
const ROW_ESTIMATE = 41;
/** A narrow listing's row, with its size and age under the name. */
const NARROW_ROW_ESTIMATE = 57;

/** The narrowest listing, in rem, with room for its Size and Modified columns. */
const WIDE_FILE_TABLE = 37;

/** The narrowest row, in rem, that holds the folder's path and a search field beside it. */
const WIDE_TOOLBAR = 32;

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  kind: EntryKind;
  sizeBytes: number;
  modifiedAt: string;
  lock: EntryLock | null;
  /** The height of the rows a windowed listing leaves out here; such a row shows nothing else. */
  spacer?: number;
}

const isSpacer = (row: Row): boolean => row.spacer !== undefined;

/** The folders inside a folder, for the destination of a move or copy. */
const listFolderNames: ListFolders = async (parts) =>
  (await listFolder(parts)).filter((entry) => entry.kind === "folder").map((entry) => entry.name);

/** "Locked by Finder, until 5:30 PM", or who holds a lock without a timeout. */
const lockText = (lock: EntryLock): string => {
  const by = lock.owner === "" ? "Locked" : `Locked by ${lock.owner}`;
  return lock.expiresAt === "" ? by : `${by}, ${formatRelative(lock.expiresAt)}`;
};

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

const describe = (names: readonly string[]): string =>
  names.length === 1 ? `“${names[0]}”` : `${names.length} items`;

const searchInput = (): HTMLElement | undefined => inMain('input[type="search"]')[0];

const ageOf = (iso: string): string => (iso === "" ? "—" : formatRelative(iso));

/** Runs `run` on each name in turn, and stops at the first refusal, which it returns. */
const eachInTurn = async (
  names: readonly string[],
  run: (name: string) => Promise<void>,
): Promise<{ done: string[]; error?: unknown }> => {
  const done: string[] = [];
  for (const name of names) {
    try {
      await run(name);
      done.push(name);
    } catch (error) {
      return { done, error };
    }
  }
  return { done };
};

/** File Explorer (PRD §8.2): browse a mount, upload, download, and organize what is stored. */
export const FileExplorerPage = ({
  path,
  selectedName,
}: {
  path: string;
  selectedName?: string;
}) => {
  const client = useQueryClient();
  const mountsQuery = useMounts();
  const backendsQuery = useBackends();
  const toast = useToast();
  const navigate = useNavigate();
  // Responsive contract: on a page wider than 776px, which a 1024px window leaves beside the side
  // navigation at its default width, the details sit in a 360px panel beside the listing; on a
  // narrower page they open in a dialog, so the listing keeps the full width.
  const isNarrow = useIsNarrowPage();
  const gutter = usePageGutter();
  // A narrower listing, as on a phone, puts each entry's size and age under its name instead of in
  // columns of their own, so its actions stay in view rather than past the edge.
  const [listingRef, isNarrowListing] = useNarrowerThan(WIDE_FILE_TABLE);
  // A narrower row puts the search field on a line of its own, as wide as the listing.
  const [toolbarRef, isNarrowToolbar] = useNarrowerThan(WIDE_TOOLBAR);
  // Astryx advises one announcer per kind of message: the match count changes as the user types,
  // so only its latest value is said, and an error must not cancel a count or another error.
  const announceCount = useAnnounce({ hasReplace: true });
  const announce = useAnnounce();
  const nameDialog = useFormDialog(440);
  const transferDialog = useFormDialog(480);
  const confirm = useImperativeAlertDialog();
  const [query, setQuery] = useState("");
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const parts = splitPath(path);
  const isRoot = parts.length === 0;
  const mounts = mountsQuery.data;
  const mount = mounts?.find((candidate) => candidate.name === parts[0]);
  const backend = backendsQuery.data?.find((candidate) => candidate.id === mount?.backendId);
  // A backend that did not answer when the backends were read is not asked for the folder.
  const isUnreachable = backend !== undefined && !backend.available;
  const listing = useQuery({
    queryKey: [...keys.dav, "list", path],
    queryFn: () => listFolder(parts),
    enabled: mount !== undefined && !isUnreachable,
    // A refusal says at once why the folder cannot be listed; a dropped connection gets one more try.
    retry: (count, error) => count < 1 && isDavError(error) && error.status === 0,
  });

  const entries = useMemo<Entry[] | undefined>(() => {
    if (isRoot) {
      return mounts?.map((item) => ({
        name: item.name,
        kind: "folder",
        sizeBytes: 0,
        modifiedAt: item.createdAt,
        contentType: "",
        lock: null,
      }));
    }
    return listing.data;
  }, [isRoot, mounts, listing.data]);
  const isMissing =
    !isRoot &&
    ((mounts !== undefined && mount === undefined) ||
      (isDavError(listing.error) && listing.error.status === 404));
  const isLoading =
    entries === undefined &&
    !isMissing &&
    !isUnreachable &&
    !listing.isError &&
    !mountsQuery.isError;
  const loadError = isRoot ? mountsQuery.error : (mountsQuery.error ?? listing.error);
  const failedToLoad = entries === undefined && !isMissing && loadError !== null;
  // What the backend said of itself, which a refusal of the listing alone cannot tell.
  const backendProblem =
    backend !== undefined && isUnreachable
      ? `${backend.name} ${backendDetail(backend)}.`
      : undefined;
  const blockedReason = isUnreachable ? backendProblem : undefined;
  // Changes need a folder that exists inside a mount. The top level lists the mounts themselves,
  // which Storage & Mounts manages.
  const canChange = !isRoot && entries !== undefined;

  const rows = useMemo<Row[]>(() => {
    const needle = query.trim().toLowerCase();
    return (entries ?? [])
      .filter((entry) => needle === "" || entry.name.toLowerCase().includes(needle))
      .map((entry) => ({
        id: entry.name,
        name: entry.name,
        kind: entry.kind,
        sizeBytes: entry.sizeBytes,
        modifiedAt: entry.modifiedAt,
        lock: entry.lock,
      }));
  }, [entries, query]);
  const folderNames = useMemo(
    () => new Set((entries ?? []).filter((entry) => entry.kind === "folder").map((e) => e.name)),
    [entries],
  );

  // The page keeps the order, so the column headers and a narrow listing's sort menu share it.
  const [sort, setSort] = useState<TableSortState<SortKey>>([
    { sortKey: "name", direction: "ascending" },
  ]);
  const { sortedData, sortConfig } = useTableSortableState<Row, SortKey>({
    data: rows,
    sort,
    onSortChange: setSort,
    comparators: {
      name: (a, b) => collator.compare(a.name, b.name),
      sizeBytes: (a, b) => a.sizeBytes - b.sizeBytes,
      modifiedAt: (a, b) => a.modifiedAt.localeCompare(b.modifiedAt),
    },
  });
  // Folders stay above files whichever way the table is sorted.
  const ordered = useMemo(
    () => [
      ...sortedData.filter((row) => row.kind === "folder"),
      ...sortedData.filter((row) => row.kind === "file"),
    ],
    [sortedData],
  );
  // The selection only ever names rows on screen, also right after a rename or a move.
  const selected = useMemo(() => {
    const shown = new Set(ordered.map((row) => row.id));
    return new Set([...selectedKeys].filter((key) => shown.has(key)));
  }, [ordered, selectedKeys]);
  const sortable = useTableSortable<Row, SortKey>(sortConfig);
  const { selectionConfig, selectionState } = useTableSelectionState<Row>({
    data: ordered,
    idKey: "id",
    selectedKeys: selected,
    setSelectedKeys,
    getIsItemSelectable: (row) => canChange && !isSpacer(row),
  });
  // Named rows let a screen reader say "Select Contracts" rather than "Select row" for each one.
  const selection = useTableSelection<Row>(
    useMemo(() => ({ ...selectionConfig, getRowLabel: (row: Row) => row.name }), [selectionConfig]),
  );

  useEffect(() => {
    if (query.trim() !== "") {
      announceCount(`${rows.length} ${rows.length === 1 ? "item matches" : "items match"}`);
    }
  }, [announceCount, query, rows.length]);

  // A listing that fails is announced as an error, since moving between pages announces nothing.
  // A missing folder needs no announcement here: its EmptyState announces itself.
  const pageProblem =
    isUnreachable && backendProblem !== undefined
      ? `Cannot list ${path}. ${backendProblem}`
      : failedToLoad
        ? `Cannot list ${path}. ${backendProblem ?? davProblem(loadError, path)}`
        : undefined;
  useEffect(() => {
    if (pageProblem !== undefined) {
      announce(pageProblem, "assertive");
    }
  }, [announce, pageProblem]);

  const selectedEntry = entries?.find(
    (entry) => entry.kind === "file" && entry.name === selectedName,
  );
  const selectedParts = selectedEntry === undefined ? undefined : [...parts, selectedEntry.name];
  const preview = useQuery({
    queryKey: [...keys.dav, "text", path, selectedEntry?.name, selectedEntry?.modifiedAt],
    queryFn: () => readText(selectedParts ?? []),
    enabled: selectedEntry !== undefined && isPreviewable(selectedEntry),
    staleTime: 60_000,
  });

  // At the top level, a mount's backend says more under its name than when it last changed.
  const backendOf = (mountName: string): string => {
    const backendId = mounts?.find((item) => item.name === mountName)?.backendId;
    return backendsQuery.data?.find((candidate) => candidate.id === backendId)?.name ?? "";
  };

  const rowHref = (row: { name: string; kind: EntryKind }): string =>
    row.kind === "folder" ? filesHref(joinPath([...parts, row.name])) : filesHref(path, row.name);

  /** After a change, every listing and every count of stored bytes reads again. */
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.dav }),
      client.invalidateQueries({ queryKey: keys.overview }),
      client.invalidateQueries({ queryKey: keys.backends }),
    ]);

  // When rows go away, focus moves to the row that took the first one's place, or to the search.
  const focusAfterRemoval = (names: readonly string[]) => {
    const first = Math.max(
      ordered.findIndex((row) => names.includes(row.id)),
      0,
    );
    const rest = ordered.filter((row) => !names.includes(row.id));
    const next = rest[Math.min(first, rest.length - 1)];
    return () => (next === undefined ? searchInput() : linkTo(rowHref(next)));
  };

  // Unselect All takes the toolbar away with the button that had focus, so focus moves to the
  // checkbox of the first row that was selected.
  const toolbarSelection = {
    ...selectionState,
    clearSelection: () => {
      const first = ordered.find((row) => selected.has(row.id));
      selectionState.clearSelection();
      if (first !== undefined) {
        refocusIfLost(
          () =>
            linkTo(rowHref(first))
              ?.closest("tr")
              ?.querySelector<HTMLElement>('input[type="checkbox"]') ?? undefined,
        );
      }
    },
  };

  const closeDetailsOf = (name: string) => {
    if (selectedName === name) {
      void navigate({ href: filesHref(path), replace: true });
    }
  };

  const showUploadResult = (uploads: Upload[]) => {
    void refresh();
    const done = uploads.filter((upload) => upload.state === "done").length;
    const failed = uploads.length - done;
    if (failed === 0) {
      toast({ body: `Uploaded ${done === 1 ? "1 file" : `${done} files`} to ${path}.` });
    } else {
      toast({
        type: "error",
        body: `${failed} of ${uploads.length} ${uploads.length === 1 ? "upload" : "uploads"} failed.`,
      });
    }
  };

  const kindOf = (name: string): EntryKind =>
    entries?.find((entry) => entry.name === name)?.kind ?? "file";

  // Each form gets a new key, so that it starts from its own values (useFormDialog).
  const openNewFolder = () =>
    nameDialog.show(
      <NameForm
        key={nextFormKey()}
        title="New folder"
        submitLabel="Create folder"
        onCancel={() => nameDialog.hide()}
        onSubmit={async (name) => {
          const problem = nameProblem(
            name,
            (entries ?? []).map((entry) => entry.name),
          );
          if (problem !== undefined) {
            return problem;
          }
          const created = name.trim();
          try {
            await createFolder([...parts, created]);
          } catch (error) {
            return davProblem(error, path);
          }
          await refresh();
          // A search can hide the new folder, and then focus goes to the search field.
          nameDialog.hide(
            () => linkTo(rowHref({ name: created, kind: "folder" })) ?? searchInput(),
          );
          toast({ body: `Created “${created}”.` });
          return undefined;
        }}
      />,
    );

  const openRename = (entry: { name: string; kind: EntryKind }) =>
    nameDialog.show(
      <NameForm
        key={nextFormKey()}
        title={`Rename “${entry.name}”`}
        submitLabel="Rename"
        initialName={entry.name}
        onCancel={() => nameDialog.hide()}
        onSubmit={async (name) => {
          const to = name.trim();
          if (to === entry.name) {
            nameDialog.hide();
            return undefined;
          }
          const problem = nameProblem(
            to,
            (entries ?? []).filter((item) => item.name !== entry.name).map((item) => item.name),
          );
          if (problem !== undefined) {
            return problem;
          }
          try {
            await transferEntry("move", [...parts, entry.name], [...parts, to], entry.kind);
          } catch (error) {
            return davProblem(error, path);
          }
          await refresh();
          // The old row's menu is gone, and a search can hide the new name too.
          nameDialog.hide(() => linkTo(rowHref({ name: to, kind: entry.kind })) ?? searchInput());
          setSelectedKeys((current) =>
            current.has(entry.name)
              ? new Set([...current].map((key) => (key === entry.name ? to : key)))
              : current,
          );
          if (selectedName === entry.name) {
            void navigate({ href: filesHref(path, to), replace: true });
          }
          toast({ body: `Renamed to “${to}”.` });
          return undefined;
        }}
      />,
      // Opened from the row's menu, which is gone once the dialog is open.
      () => buttonLabelled(`Actions for ${entry.name}`),
    );

  // A mount whose backend did not answer cannot take anything either.
  const reachableMounts = (mounts ?? [])
    .filter(
      (item) =>
        backendsQuery.data?.find((candidate) => candidate.id === item.backendId)?.available !==
        false,
    )
    .map((item) => item.name);

  const openTransfer = (transfer: Transfer, names: readonly string[]) =>
    transferDialog.show(
      <TransferForm
        key={nextFormKey()}
        transfer={transfer}
        names={names}
        from={path}
        mounts={reachableMounts}
        listFolders={listFolderNames}
        onCancel={() => transferDialog.hide()}
        onSubmit={async (destination) => {
          const problem = destinationProblem(path, names, destination);
          if (problem !== undefined) {
            return problem;
          }
          const target = splitPath(normalizePath(destination));
          const { done, error } = await eachInTurn(names, (name) =>
            transferEntry(transfer, [...parts, name], [...target, name], kindOf(name)),
          );
          if (done.length > 0) {
            await refresh();
          }
          if (error !== undefined) {
            const reason =
              isDavError(error) && error.status === 412
                ? `Something named “${names[done.length]}” is already in ${joinPath(target)}.`
                : davProblem(error, joinPath(target));
            return done.length === 0
              ? reason
              : `${transfer === "move" ? "Moved" : "Copied"} ${describe(done)}, then: ${reason}`;
          }
          if (transfer === "move") {
            transferDialog.hide(focusAfterRemoval(names));
            setSelectedKeys(new Set());
            names.forEach(closeDetailsOf);
          } else {
            transferDialog.hide();
          }
          toast({
            body: `${transfer === "move" ? "Moved" : "Copied"} ${describe(names)} to ${joinPath(target)}.`,
          });
          return undefined;
        }}
      />,
    );

  const openDelete = (names: readonly string[]) =>
    confirm.show({
      title: `Delete ${describe(names)}?`,
      description: "This cannot be undone.",
      actionLabel: "Delete",
      onAction: () => {
        confirm.hide();
        const refocus = focusAfterRemoval(names);
        void eachInTurn(names, (name) => removeEntry([...parts, name], kindOf(name))).then(
          async ({ done, error }) => {
            await refresh();
            setSelectedKeys(new Set());
            done.forEach(closeDetailsOf);
            if (error !== undefined) {
              toast({ type: "error", body: davProblem(error, path) });
              return;
            }
            toast({ body: `Deleted ${describe(names)}.` });
            refocusIfLost(refocus);
          },
        );
      },
    });

  const toggleLock = (entry: { name: string; kind: EntryKind; lock: EntryLock | null }) => {
    const target = [...parts, entry.name];
    const token = entry.lock?.token ?? null;
    const change =
      entry.lock === null
        ? lockEntry(target, entry.kind)
        : token === null
          ? Promise.reject(new DavError(403))
          : unlockEntry(target, entry.kind, token);
    change.then(
      async () => {
        await refresh();
        toast({ body: `${entry.lock === null ? "Locked" : "Unlocked"} “${entry.name}”.` });
      },
      (error: unknown) => toast({ type: "error", body: davProblem(error, path) }),
    );
  };

  const download = (name: string) => {
    toast({ body: `Downloading “${name}”.`, uniqueID: "download" });
    downloadFile([...parts, name]).catch((error: unknown) =>
      toast({ type: "error", body: davProblem(error, path), uniqueID: "download" }),
    );
  };

  const columns: TableColumn<Row>[] = [
    {
      key: "name",
      // Without the Size and Modified headers, the menu sorts a narrow listing in their place.
      header: isNarrowListing ? <SortMenu sort={sort} onSortChange={setSort} /> : "Name",
      sortable: !isNarrowListing,
      width: proportional(3, { minWidth: isNarrowListing ? 160 : 220 }),
      renderCell: (row) => {
        if (row.spacer !== undefined) {
          return <VStack height={row.spacer} />;
        }
        const link = (
          <Link xstyle={styles.nameLink} href={rowHref(row)}>
            <FileName name={row.name} kind={row.kind} />
          </Link>
        );
        const name =
          row.lock === null ? (
            link
          ) : (
            <HStack gap={2} vAlign="center">
              <StackItem size="fill" xstyle={styles.nameCell}>
                {link}
              </StackItem>
              <Icon icon={Lock} size="sm" color="secondary" label={lockText(row.lock)} />
            </HStack>
          );
        return isNarrowListing ? (
          <VStack gap={0.5}>
            {name}
            <Text type="supporting" color="secondary" hasTabularNumbers xstyle={styles.detail}>
              {isRoot
                ? backendOf(row.name)
                : row.kind === "folder"
                  ? ageOf(row.modifiedAt)
                  : `${formatBytes(row.sizeBytes)} · ${ageOf(row.modifiedAt)}`}
            </Text>
          </VStack>
        ) : (
          name
        );
      },
    },
    ...(isNarrowListing
      ? []
      : ([
          {
            key: "sizeBytes",
            header: "Size",
            sortable: true,
            width: pixel(112),
            align: "end",
            renderCell: (row: Row) =>
              isSpacer(row) ? null : (
                <Text color="secondary" hasTabularNumbers>
                  {row.kind === "folder" ? "—" : formatBytes(row.sizeBytes)}
                </Text>
              ),
          },
          {
            key: "modifiedAt",
            header: isRoot ? "Added" : "Modified",
            sortable: true,
            width: pixel(160),
            renderCell: (row: Row) =>
              isSpacer(row) ? null : <Text color="secondary">{ageOf(row.modifiedAt)}</Text>,
          },
        ] satisfies TableColumn<Row>[])),
    ...(canChange
      ? [
          {
            key: "actions",
            header: <VisuallyHidden>Actions</VisuallyHidden>,
            width: pixel(64),
            align: "end",
            renderCell: (row: Row) =>
              isSpacer(row) ? null : (
                <MoreMenu
                  label={`Actions for ${row.name}`}
                  size="sm"
                  alignment="end"
                  items={[
                    row.kind === "folder"
                      ? { label: "Open", onClick: () => void navigate({ href: rowHref(row) }) }
                      : { label: "Download", onClick: () => download(row.name) },
                    { label: "Rename", onClick: () => openRename(row) },
                    { label: "Move", onClick: () => openTransfer("move", [row.name]) },
                    { label: "Copy", onClick: () => openTransfer("copy", [row.name]) },
                    row.lock === null
                      ? { label: "Lock", onClick: () => toggleLock(row) }
                      : {
                          label: "Unlock",
                          isDisabled: row.lock.token === null,
                          onClick: () => toggleLock(row),
                        },
                    { type: "divider" },
                    {
                      label: "Delete",
                      variant: "destructive",
                      onClick: () => openDelete([row.name]),
                    },
                  ]}
                />
              ),
          } satisfies TableColumn<Row>,
        ]
      : []),
  ];

  const { wrapperRef, ...rowWindow } = useRowWindow(
    ordered,
    isNarrowListing ? NARROW_ROW_ESTIMATE : ROW_ESTIMATE,
  );
  const windowed = useMemo<Row[]>(() => {
    if (!rowWindow.isWindowed) {
      return [...rowWindow.rows];
    }
    const spacer = (id: string, height: number): Row[] =>
      height > 0
        ? [{ id, name: "", kind: "file", sizeBytes: 0, modifiedAt: "", lock: null, spacer: height }]
        : [];
    // Slashes never appear in a name, so these ids are no entry's.
    return [
      ...spacer("/before", rowWindow.before),
      ...rowWindow.rows,
      ...spacer("/after", rowWindow.after),
    ];
  }, [rowWindow.isWindowed, rowWindow.rows, rowWindow.before, rowWindow.after]);

  const content = (() => {
    if (isLoading) {
      return <LoadingRows />;
    }
    if (isMissing) {
      return (
        <EmptyState
          headingLevel={2}
          title="This folder does not exist"
          actions={<Button label="Go to Files" variant="secondary" href="/files" />}
        />
      );
    }
    if (failedToLoad || isUnreachable) {
      return (
        <Banner
          status="error"
          title={`Cannot list ${path}`}
          description={backendProblem ?? davProblem(loadError, path)}
          endContent={
            <Button
              label="Try again"
              variant="secondary"
              size="sm"
              isLoading={listing.isFetching || mountsQuery.isFetching || backendsQuery.isFetching}
              onClick={() => {
                void mountsQuery.refetch();
                void backendsQuery.refetch();
                if (!isRoot && !isUnreachable) {
                  void listing.refetch();
                }
              }}
            />
          }
        />
      );
    }
    if (rows.length === 0 && query.trim() !== "") {
      return (
        <EmptyState
          headingLevel={2}
          title={`Nothing here matches “${query.trim()}”`}
          actions={
            <Button
              label="Clear search"
              variant="secondary"
              onClick={() => {
                setQuery("");
                refocusIfLost(searchInput);
              }}
            />
          }
        />
      );
    }
    if (rows.length === 0) {
      return (
        <EmptyState
          headingLevel={2}
          title={isRoot ? "No mounts yet" : "This folder is empty"}
          actions={
            isRoot ? (
              <Button label="Manage mounts" variant="secondary" href="/storage" />
            ) : (
              <>
                <Button label="New folder" variant="secondary" onClick={openNewFolder} />
                <Button label="Upload" variant="primary" onClick={() => setIsUploadOpen(true)} />
              </>
            )
          }
        />
      );
    }
    return (
      <VStack ref={listingRef} gap={2}>
        {selectionState.hasSelection ? (
          <TableSelectionToolbar
            selection={toolbarSelection}
            startContent={
              <>
                <Button
                  label="Move"
                  variant="ghost"
                  onClick={() => openTransfer("move", [...selected])}
                />
                <Button
                  label="Copy"
                  variant="ghost"
                  onClick={() => openTransfer("copy", [...selected])}
                />
                <Button
                  label="Delete"
                  variant="destructive"
                  onClick={() => openDelete([...selected])}
                />
              </>
            }
          />
        ) : null}
        <VStack ref={wrapperRef}>
          <Table<Row>
            data={windowed}
            columns={columns}
            idKey="id"
            density="compact"
            textOverflow="truncate"
            hasHover
            // Mounts are not items to select, so the top level has no checkbox column at all.
            plugins={canChange ? { sortable, selection } : { sortable }}
            {...(rowWindow.isWindowed ? { rowIndexStart: 1, rowCount: ordered.length } : {})}
          />
        </VStack>
      </VStack>
    );
  })();

  const closeDetails = () => {
    const name = selectedEntry?.name;
    void navigate({ href: filesHref(path) });
    if (name !== undefined) {
      refocusIfLost(() => linkTo(filesHref(path, name)));
    }
  };

  const details =
    selectedEntry === undefined ? null : (
      <EntryDetails
        path={path}
        entry={selectedEntry}
        backendName={backend?.name}
        preview={
          !isPreviewable(selectedEntry)
            ? { state: "none" }
            : preview.data !== undefined
              ? { state: "text", text: preview.data }
              : preview.isError
                ? { state: "error", problem: davProblem(preview.error, path) }
                : { state: "loading" }
        }
        onDownload={() => download(selectedEntry.name)}
        onRename={() => openRename(selectedEntry)}
        onToggleLock={() => toggleLock(selectedEntry)}
        onDelete={() => openDelete([selectedEntry.name])}
      />
    );

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={gutter}>
          <VStack gap={6}>
            <PageHeader
              // Each set of actions has its own key, so the header measures the new set.
              key={isRoot ? "mounts" : canChange ? "folder" : isUnreachable ? "blocked" : "none"}
              title="Files"
              actions={
                isRoot ? (
                  <TitleAction
                    label="Manage mounts"
                    variant="secondary"
                    icon={<Icon icon={HardDrive} size="sm" />}
                    href="/storage"
                  />
                ) : canChange ? (
                  <>
                    <TitleAction
                      label="New folder"
                      variant="secondary"
                      icon={<Icon icon={FolderPlus} size="sm" />}
                      onClick={openNewFolder}
                    />
                    <TitleAction
                      label="Upload"
                      variant="primary"
                      icon={<Icon icon={UploadIcon} size="sm" />}
                      onClick={() => setIsUploadOpen((isOpen) => !isOpen)}
                    />
                  </>
                ) : isUnreachable ? (
                  <>
                    <TitleAction
                      label="New folder"
                      variant="secondary"
                      icon={<Icon icon={FolderPlus} size="sm" />}
                      isDisabled
                      tooltip={blockedReason}
                      onClick={openNewFolder}
                    />
                    <TitleAction
                      label="Upload"
                      variant="primary"
                      icon={<Icon icon={UploadIcon} size="sm" />}
                      isDisabled
                      tooltip={blockedReason}
                      onClick={() => setIsUploadOpen((isOpen) => !isOpen)}
                    />
                  </>
                ) : undefined
              }
            />

            <HStack ref={toolbarRef} gap={4} hAlign="between" vAlign="center" wrap="wrap">
              {/* On a narrow page the top level's path would only repeat the page's title. */}
              {isRoot && isNarrowToolbar ? null : (
                <Breadcrumbs label="Folder">
                  <BreadcrumbItem href="/files" isCurrent={isRoot}>
                    Files
                  </BreadcrumbItem>
                  {parts.map((part, index) => (
                    <BreadcrumbItem
                      key={joinPath(parts.slice(0, index + 1))}
                      href={filesHref(joinPath(parts.slice(0, index + 1)))}
                      isCurrent={index === parts.length - 1}
                    >
                      {part}
                    </BreadcrumbItem>
                  ))}
                </Breadcrumbs>
              )}
              <TextInput
                type="search"
                label="Search this folder"
                isLabelHidden
                placeholder="Search this folder"
                value={query}
                onChange={(value) => {
                  setQuery(value);
                  setSelectedKeys(new Set());
                }}
                hasClear
                size="sm"
                width={isNarrowToolbar ? "100%" : 260}
                autoCapitalize="none"
                hasAutoCorrect={false}
                hasSpellCheck={false}
              />
            </HStack>

            {isUploadOpen && canChange ? (
              <UploadPanel path={path} folders={folderNames} onSettled={showUploadResult} />
            ) : null}

            {content}
          </VStack>
          {/* The dialog mounts open, with its header, once the file is known: one that opened
              later than it mounted took no name from its header. */}
          {isNarrow && selectedEntry !== undefined ? (
            <Dialog
              key={selectedEntry.name}
              isOpen
              onOpenChange={(isOpen) => {
                if (!isOpen) {
                  closeDetails();
                }
              }}
              width={480}
            >
              <Layout
                header={<DialogHeader title={selectedEntry.name} onOpenChange={closeDetails} />}
                content={<LayoutContent>{details}</LayoutContent>}
              />
            </Dialog>
          ) : null}
          {nameDialog.element}
          {transferDialog.element}
          {confirm.element}
        </LayoutContent>
      }
      end={
        isNarrow || selectedEntry === undefined ? undefined : (
          <LayoutPanel hasDivider width={360} padding={gutter} label="Details">
            <VStack gap={6}>
              <HStack gap={2} vAlign="start" hAlign="between">
                <StackItem size="fill">
                  <TitleLine canWrap>
                    <Heading level={2} maxLines={3} wordBreak="break-word">
                      {selectedEntry.name}
                    </Heading>
                  </TitleLine>
                </StackItem>
                <IconButton
                  label="Close details"
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon="close" size="sm" />}
                  onClick={closeDetails}
                />
              </HStack>
              {details}
            </VStack>
          </LayoutPanel>
        )
      }
    />
  );
};

type Preview =
  | { state: "none" }
  | { state: "loading" }
  | { state: "text"; text: string }
  | { state: "error"; problem: string };

/** What the details show below the file's name, in the side panel or the dialog. */
const EntryDetails = ({
  path,
  entry,
  backendName,
  preview,
  onDownload,
  onRename,
  onToggleLock,
  onDelete,
}: {
  path: string;
  entry: Entry;
  backendName?: string;
  preview: Preview;
  onDownload: () => void;
  onRename: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
}) => {
  const extension = splitExtension(entry.name)[1].slice(1).toUpperCase();
  return (
    <VStack gap={4}>
      <HStack gap={2} wrap="wrap">
        <Button label="Download" variant="secondary" size="sm" onClick={onDownload} />
        <Button label="Rename" variant="ghost" size="sm" onClick={onRename} />
        <Button
          label={entry.lock === null ? "Lock" : "Unlock"}
          variant="ghost"
          size="sm"
          isDisabled={entry.lock !== null && entry.lock.token === null}
          onClick={onToggleLock}
        />
        <Button label="Delete" variant="destructive" size="sm" onClick={onDelete} />
      </HStack>
      <MetadataList>
        <MetadataListItem label="Location">{path}</MetadataListItem>
        <MetadataListItem label="Size">{formatBytes(entry.sizeBytes)}</MetadataListItem>
        <MetadataListItem label="Modified">
          {entry.modifiedAt === "" ? "Unknown" : formatDateTime(entry.modifiedAt)}
        </MetadataListItem>
        <MetadataListItem label="Type">
          {entry.contentType !== ""
            ? entry.contentType.split(";")[0]
            : extension === ""
              ? "File"
              : `${extension} file`}
        </MetadataListItem>
        <MetadataListItem label="Stored on">{backendName ?? "Unknown"}</MetadataListItem>
        <MetadataListItem label="Lock">
          {entry.lock === null ? "Not locked" : lockText(entry.lock)}
        </MetadataListItem>
      </MetadataList>
      <VStack gap={2}>
        <Heading level={3}>Preview</Heading>
        {preview.state === "none" ? (
          <Text type="supporting" color="secondary">
            No preview for this kind of file.
          </Text>
        ) : preview.state === "loading" ? (
          <Skeleton width="100%" height={80} />
        ) : preview.state === "error" ? (
          <Text type="supporting" color="secondary">
            {`The preview could not be read. ${preview.problem}`}
          </Text>
        ) : (
          <CodeBlock
            code={preview.text}
            isWrapped
            maxHeight={280}
            width="100%"
            size="sm"
            hasCopyButton={false}
          />
        )}
      </VStack>
    </VStack>
  );
};
