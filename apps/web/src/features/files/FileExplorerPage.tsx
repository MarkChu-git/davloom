import { useImperativeAlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { useAnnounce, useMediaQuery } from "@astryxdesign/core/hooks";
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
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import * as stylex from "@stylexjs/stylex";
import { useNavigate } from "@tanstack/react-router";
import { FolderPlus, HardDrive, Upload as UploadIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { backends, SAMPLE_NOW, type Entry, type EntryKind } from "../sample-data/data";
import { formatBytes, formatDateTime, formatRelative } from "../sample-data/format";
import { sampleId } from "../sample-data/id";
import { buttonLabelled, inMain, linkTo, refocusIfLost } from "../shell/focus";
import { PageHeader } from "../shell/PageHeader";
import { useFormDialog } from "../shell/useFormDialog";
import { useMounts } from "../storage/mountStore";
import { NameForm, TransferForm } from "./dialogs";
import { FileName, splitExtension } from "./FileName";
import { createFolder, removeEntries, renameEntry, transferEntries, useTrees } from "./fileStore";
import { destinationsFor, folderIn, joinPath, splitPath, type Transfer } from "./tree";
import { UploadPanel } from "./UploadPanel";
import type { Upload } from "./uploadStore";

const styles = stylex.create({
  // The cell is as wide as its column, so the name inside can end in an ellipsis.
  nameLink: { display: "block", maxWidth: "100%" },
});

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  kind: EntryKind;
  sizeBytes: number;
  modifiedAt: string;
}

/** The Files URL for a folder, and optionally the file whose details are open. */
export const filesHref = (path: string, file?: string): string => {
  const search = new URLSearchParams();
  if (path !== "/") {
    search.set("path", path);
  }
  if (file !== undefined) {
    search.set("file", file);
  }
  const query = search.toString();
  return query === "" ? "/files" : `/files?${query}`;
};

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

const describe = (names: readonly string[]): string =>
  names.length === 1 ? `“${names[0]}”` : `${names.length} items`;

const searchInput = (): HTMLElement | undefined => inMain('input[type="search"]')[0];

/** The listing appears after a short pause, as it would while the API answers. */
const useListingDelay = (ms: number): boolean => {
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return isLoading;
};

const LoadingRows = () => (
  <VStack gap={3}>
    {[0, 1, 2, 3, 4].map((row) => (
      <HStack key={row} gap={4} vAlign="center">
        <Skeleton width={280} height={16} index={row * 3} />
        <Skeleton width={80} height={16} index={row * 3 + 1} />
        <Skeleton width={120} height={16} index={row * 3 + 2} />
      </HStack>
    ))}
  </VStack>
);

/** File Explorer (PRD §8.2): browse a mount, upload, download, and organize what is stored. */
export const FileExplorerPage = ({
  path,
  selectedName,
}: {
  path: string;
  selectedName?: string;
}) => {
  const trees = useTrees();
  const mounts = useMounts();
  const toast = useToast();
  const navigate = useNavigate();
  // Responsive contract: above 1024px the details sit in a 360px panel beside the listing;
  // at 1024px and below they open in a dialog, so the listing keeps the full width.
  const isNarrow = useMediaQuery("(width <= 1024px)");
  // Astryx advises one announcer per kind of message: the match count changes as the user types,
  // so only its latest value is said, and an error must not cancel a count or another error.
  const announceCount = useAnnounce({ hasReplace: true });
  const announce = useAnnounce();
  const nameDialog = useFormDialog(440);
  const transferDialog = useFormDialog(480);
  const confirm = useImperativeAlertDialog();
  const isLoading = useListingDelay(350);
  const [query, setQuery] = useState("");
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const parts = splitPath(path);
  const isRoot = parts.length === 0;
  const mount = mounts.find((candidate) => candidate.id === parts[0]);
  const backend = backends.find((candidate) => candidate.id === mount?.backendId);
  const isUnreachable = backend?.status === "unreachable";
  const entries = useMemo<Entry[] | undefined>(
    () =>
      isRoot
        ? mounts.map((item) => ({
            name: item.id,
            kind: "folder",
            sizeBytes: 0,
            modifiedAt: SAMPLE_NOW.toISOString(),
          }))
        : folderIn(
            trees,
            mounts.map((item) => item.id),
            path,
          ),
    [isRoot, mounts, trees, path],
  );
  // Changes need a folder that exists, inside a mount whose backend answers. The top level lists
  // the mounts themselves, which Storage & Mounts manages.
  const canChange = !isRoot && entries !== undefined && !isUnreachable;
  const blockedReason = isUnreachable
    ? `${backend?.name ?? "The backend"} is not answering.`
    : undefined;

  const rows = useMemo<Row[]>(() => {
    const needle = query.trim().toLowerCase();
    return (isUnreachable ? [] : (entries ?? []))
      .filter((entry) => needle === "" || entry.name.toLowerCase().includes(needle))
      .map((entry) => ({
        id: entry.name,
        name: entry.name,
        kind: entry.kind,
        sizeBytes: entry.sizeBytes,
        modifiedAt: entry.modifiedAt,
      }));
  }, [entries, isUnreachable, query]);

  const { sortedData, sortConfig } = useTableSortableState<Row>({
    data: rows,
    defaultSort: [{ sortKey: "name", direction: "ascending" }],
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
  const sortable = useTableSortable<Row>(sortConfig);
  const { selectionConfig, selectionState } = useTableSelectionState<Row>({
    data: ordered,
    idKey: "id",
    selectedKeys: selected,
    setSelectedKeys,
    getIsItemSelectable: () => canChange,
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

  // A backend that does not answer is announced as an error, since moving between pages announces
  // nothing. A missing folder needs no announcement here: its EmptyState announces itself.
  const pageProblem =
    !isLoading && isUnreachable && backend !== undefined
      ? `Cannot list ${path}. ${backend.name} gave ${backend.statusDetail}.`
      : undefined;
  useEffect(() => {
    if (pageProblem !== undefined) {
      announce(pageProblem, "assertive");
    }
  }, [announce, pageProblem]);

  const selectedEntry = isUnreachable
    ? undefined
    : entries?.find((entry) => entry.kind === "file" && entry.name === selectedName);

  const rowHref = (row: { name: string; kind: EntryKind }): string =>
    row.kind === "folder" ? filesHref(joinPath([...parts, row.name])) : filesHref(path, row.name);

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

  // Each form gets a new key, so that it starts from its own values (useFormDialog).
  const openNewFolder = () =>
    nameDialog.show(
      <NameForm
        key={sampleId()}
        title="New folder"
        submitLabel="Create folder"
        onCancel={() => nameDialog.hide()}
        onSubmit={(name) => {
          const problem = createFolder(path, name);
          if (problem === undefined) {
            // A search can hide the new folder, and then focus goes to the search field.
            nameDialog.hide(
              () => linkTo(rowHref({ name: name.trim(), kind: "folder" })) ?? searchInput(),
            );
            toast({ body: `Created “${name.trim()}”.` });
          }
          return problem;
        }}
      />,
    );

  const openRename = (entry: { name: string; kind: EntryKind }) =>
    nameDialog.show(
      <NameForm
        key={sampleId()}
        title={`Rename “${entry.name}”`}
        submitLabel="Rename"
        initialName={entry.name}
        onCancel={() => nameDialog.hide()}
        onSubmit={(name) => {
          const to = name.trim();
          if (to === entry.name) {
            nameDialog.hide();
            return undefined;
          }
          const problem = renameEntry(path, entry.name, to);
          if (problem === undefined) {
            // The old row's menu is gone, and a search can hide the new name too.
            nameDialog.hide(() => linkTo(rowHref({ name: to, kind: entry.kind })) ?? searchInput());
            setSelectedKeys((keys) =>
              keys.has(entry.name)
                ? new Set([...keys].map((key) => (key === entry.name ? to : key)))
                : keys,
            );
            if (selectedName === entry.name) {
              void navigate({ href: filesHref(path, to), replace: true });
            }
            toast({ body: `Renamed to “${to}”.` });
          }
          return problem;
        }}
      />,
      // Opened from the row's menu, which is gone once the dialog is open.
      () => buttonLabelled(`Actions for ${entry.name}`),
    );

  const openTransfer = (transfer: Transfer, names: readonly string[]) => {
    // A mount whose backend does not answer cannot take anything either.
    const reachable = mounts
      .filter(
        (item) =>
          backends.find((candidate) => candidate.id === item.backendId)?.status !== "unreachable",
      )
      .map((item) => item.id);
    transferDialog.show(
      <TransferForm
        key={sampleId()}
        transfer={transfer}
        names={names}
        destinations={destinationsFor(trees, reachable, path, names)}
        onCancel={() => transferDialog.hide()}
        onSubmit={(destination) => {
          const problem = transferEntries(transfer, path, new Set(names), destination);
          if (problem === undefined) {
            if (transfer === "move") {
              transferDialog.hide(focusAfterRemoval(names));
              setSelectedKeys(new Set());
              names.forEach(closeDetailsOf);
            } else {
              transferDialog.hide();
            }
            toast({
              body: `${transfer === "move" ? "Moved" : "Copied"} ${describe(names)} to ${destination}.`,
            });
          }
          return problem;
        }}
      />,
    );
  };

  const openDelete = (names: readonly string[]) =>
    confirm.show({
      title: `Delete ${describe(names)}?`,
      description: "This cannot be undone.",
      actionLabel: "Delete",
      onAction: () => {
        const problem = removeEntries(path, new Set(names));
        confirm.hide();
        if (problem !== undefined) {
          toast({ type: "error", body: problem });
          return;
        }
        setSelectedKeys(new Set());
        names.forEach(closeDetailsOf);
        toast({ body: `Deleted ${describe(names)}.` });
        refocusIfLost(focusAfterRemoval(names));
      },
    });

  const download = (name: string) =>
    toast({ body: `Downloading “${name}”.`, uniqueID: "download" });

  // Leaving the folder ends the try, so its answer is never announced on another page.
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(retryTimer.current), []);
  const retry = () => {
    setIsRetrying(true);
    clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => {
      setIsRetrying(false);
      if (backend !== undefined) {
        announce(
          `Still cannot list ${path}. ${backend.name} gave ${backend.statusDetail}.`,
          "assertive",
        );
      }
    }, 900);
  };

  const columns: TableColumn<Row>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      width: proportional(3, { minWidth: 220 }),
      renderCell: (row) => (
        <Link xstyle={styles.nameLink} href={rowHref(row)}>
          <FileName name={row.name} kind={row.kind} />
        </Link>
      ),
    },
    {
      key: "sizeBytes",
      header: "Size",
      sortable: true,
      width: pixel(112),
      align: "end",
      renderCell: (row) => (
        <Text color="secondary" hasTabularNumbers>
          {row.kind === "folder" ? "—" : formatBytes(row.sizeBytes)}
        </Text>
      ),
    },
    {
      key: "modifiedAt",
      header: "Modified",
      sortable: true,
      width: pixel(160),
      renderCell: (row) => <Text color="secondary">{formatRelative(row.modifiedAt)}</Text>,
    },
    ...(canChange
      ? [
          {
            key: "actions",
            header: <VisuallyHidden>Actions</VisuallyHidden>,
            width: pixel(64),
            align: "end",
            renderCell: (row: Row) => (
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

  const listing = (() => {
    if (isLoading) {
      return <LoadingRows />;
    }
    if (isUnreachable && backend !== undefined) {
      return (
        <Banner
          status="error"
          title={`Cannot list ${path}`}
          description={`${backend.name} gave ${backend.statusDetail}.`}
          endContent={
            <Button
              label="Try again"
              variant="secondary"
              size="sm"
              isLoading={isRetrying}
              onClick={retry}
            />
          }
        />
      );
    }
    if (entries === undefined) {
      return (
        <EmptyState
          title="This folder does not exist"
          actions={<Button label="Go to Files" variant="secondary" href="/files" />}
        />
      );
    }
    if (rows.length === 0 && query.trim() !== "") {
      return (
        <EmptyState
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
      <VStack gap={2}>
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
                <Button label="Delete" variant="ghost" onClick={() => openDelete([...selected])} />
              </>
            }
          />
        ) : null}
        <Table<Row>
          data={ordered}
          columns={columns}
          idKey="id"
          density="compact"
          textOverflow="truncate"
          hasHover
          // Mounts are not items to select, so the top level has no checkbox column at all.
          plugins={canChange ? { sortable, selection } : { sortable }}
        />
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
        onDownload={() => download(selectedEntry.name)}
        onRename={() => openRename(selectedEntry)}
        onDelete={() => openDelete([selectedEntry.name])}
      />
    );

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={6}>
          <VStack gap={5}>
            <PageHeader
              title="Files"
              actions={
                isRoot ? (
                  <Button
                    label="Manage mounts"
                    variant="secondary"
                    icon={<Icon icon={HardDrive} size="sm" />}
                    href="/storage"
                  />
                ) : entries === undefined ? undefined : (
                  <>
                    <Button
                      label="New folder"
                      variant="secondary"
                      icon={<Icon icon={FolderPlus} size="sm" />}
                      isDisabled={!canChange}
                      tooltip={blockedReason}
                      onClick={openNewFolder}
                    />
                    <Button
                      label="Upload"
                      variant="primary"
                      icon={<Icon icon={UploadIcon} size="sm" />}
                      isDisabled={!canChange}
                      tooltip={blockedReason}
                      onClick={() => setIsUploadOpen((isOpen) => !isOpen)}
                    />
                  </>
                )
              }
            />

            <HStack gap={4} hAlign="between" vAlign="center" wrap="wrap">
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
                width={260}
                autoCapitalize="none"
                hasAutoCorrect={false}
                hasSpellCheck={false}
              />
            </HStack>

            {isUploadOpen && canChange ? (
              <UploadPanel path={path} onSettled={showUploadResult} />
            ) : null}

            {listing}
          </VStack>
          {isNarrow ? (
            <Dialog
              isOpen={details !== null}
              onOpenChange={(isOpen) => {
                if (!isOpen) {
                  closeDetails();
                }
              }}
              width={480}
            >
              {selectedEntry === undefined ? null : (
                <Layout
                  header={<DialogHeader title={selectedEntry.name} onOpenChange={closeDetails} />}
                  content={<LayoutContent>{details}</LayoutContent>}
                />
              )}
            </Dialog>
          ) : null}
          {nameDialog.element}
          {transferDialog.element}
          {confirm.element}
        </LayoutContent>
      }
      end={
        isNarrow || selectedEntry === undefined ? undefined : (
          <LayoutPanel hasDivider width={360} padding={4} label="Details">
            <VStack gap={4}>
              <HStack gap={2} vAlign="start" hAlign="between">
                <StackItem size="fill">
                  <Heading level={2} maxLines={3} wordBreak="break-word">
                    {selectedEntry.name}
                  </Heading>
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

/** What the details show below the file's name, in the side panel or the dialog. */
const EntryDetails = ({
  path,
  entry,
  backendName,
  onDownload,
  onRename,
  onDelete,
}: {
  path: string;
  entry: Entry;
  backendName?: string;
  onDownload: () => void;
  onRename: () => void;
  onDelete: () => void;
}) => {
  const extension = splitExtension(entry.name)[1].slice(1).toUpperCase();
  return (
    <VStack gap={4}>
      <HStack gap={2} wrap="wrap">
        <Button label="Download" variant="secondary" size="sm" onClick={onDownload} />
        <Button label="Rename" variant="ghost" size="sm" onClick={onRename} />
        <Button label="Delete" variant="ghost" size="sm" onClick={onDelete} />
      </HStack>
      <MetadataList>
        <MetadataListItem label="Location">{path}</MetadataListItem>
        <MetadataListItem label="Size">{formatBytes(entry.sizeBytes)}</MetadataListItem>
        <MetadataListItem label="Modified">{formatDateTime(entry.modifiedAt)}</MetadataListItem>
        <MetadataListItem label="Type">
          {extension === "" ? "File" : `${extension} file`}
        </MetadataListItem>
        <MetadataListItem label="Stored on">{backendName ?? "Unknown"}</MetadataListItem>
        <MetadataListItem label="Lock">Not locked</MetadataListItem>
      </MetadataList>
      <VStack gap={2}>
        <Heading level={3}>Preview</Heading>
        {entry.text === undefined ? (
          <Text type="supporting" color="secondary">
            No preview for this kind of file.
          </Text>
        ) : (
          <CodeBlock
            code={entry.text}
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
