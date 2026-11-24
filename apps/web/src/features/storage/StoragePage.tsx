import { useImperativeAlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { Selector } from "@astryxdesign/core/Selector";
import { Table, pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { describeError, isApiError } from "../api/client";
import {
  kindLabel,
  useBackends,
  useCreateMount,
  useInstanceInfo,
  useRemoveBackend,
  useStorageSettings,
  useMounts,
  useRemoveMount,
  useMoveMount,
  useRenameMount,
  type Backend,
  type Mount,
} from "../api/queries";
import { ExpandableList } from "../shell/ExpandableList";
import { buttonLabelled, buttonNamed, refocusIfLost } from "../shell/focus";
import { PageHeader } from "../shell/PageHeader";
import { usePageGutter } from "../shell/pageWidth";
import { LoadingRows, QueryState } from "../shell/QueryState";
import { TitleAction, TitleRow } from "../shell/TitleRow";
import { nextFormKey, useFormDialog } from "../shell/useFormDialog";
import { useNarrowerThan } from "../shell/useNarrowerThan";
import { BackendCard } from "./BackendCard";
import { BackendForm } from "./BackendForm";
import { mountFolderOf, mountNameProblem } from "./mountName";

type MountRow = Mount & Record<string, unknown>;

const pathOf = (mount: Pick<Mount, "name">): string => `/${mount.name}`;
const folderOf = (mount: Pick<Mount, "root">): string =>
  mount.root === "" ? "Whole backend" : `/${mount.root}`;

const identifier = {
  autoCapitalize: "none",
  hasAutoCorrect: false,
  hasSpellCheck: false,
} as const;

const DialogFrame = ({
  title,
  submitLabel,
  isSaving,
  failure,
  onCancel,
  onSubmit,
  children,
}: {
  title: string;
  submitLabel: string;
  isSaving: boolean;
  failure?: string;
  onCancel: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) => (
  <Layout
    header={<DialogHeader title={title} onOpenChange={onCancel} />}
    content={
      <LayoutContent>
        <VStack gap={4}>
          {failure === undefined ? null : (
            <Banner status="error" title={failure} container="card" />
          )}
          {children}
        </VStack>
      </LayoutContent>
    }
    footer={
      <LayoutFooter>
        <HStack gap={2} hAlign="end">
          <Button label="Cancel" variant="secondary" onClick={onCancel} />
          <Button label={submitLabel} variant="primary" isLoading={isSaving} onClick={onSubmit} />
        </HStack>
      </LayoutFooter>
    }
  />
);

const mountFailure = (error: unknown): { name?: string; root?: string; failure?: string } => {
  if (isApiError(error) && error.code === "name_taken") {
    return { name: "Another mount already uses this folder." };
  }
  if (isApiError(error) && error.code === "invalid_input") {
    return { failure: "The server refused the mount. Check the folder name and the folder." };
  }
  return { failure: describeError(error) };
};

/** Adds a mount, or renames one: a mount keeps its backend and folder. */
const MountForm = ({
  mount,
  backends,
  defaultBackendId,
  takenPaths,
  onCancel,
  onSaved,
}: {
  mount?: Mount;
  backends: readonly Backend[];
  /** The backend a new mount starts with. */
  defaultBackendId?: string | null;
  takenPaths: readonly string[];
  onCancel: () => void;
  onSaved: (path: string) => void;
}) => {
  const create = useCreateMount();
  const rename = useRenameMount();
  const [name, setName] = useState(mount?.name ?? "");
  const [backendId, setBackendId] = useState(
    mount?.backendId ??
      backends.find((backend) => backend.id === defaultBackendId)?.id ??
      backends[0]?.id ??
      "",
  );
  const [root, setRoot] = useState("");
  const [problems, setProblems] = useState<{ name?: string; root?: string; failure?: string }>({});
  const isSaving = create.isPending || rename.isPending;

  const submit = () => {
    const folder = mountFolderOf(name);
    const nameProblem = mountNameProblem(name, takenPaths);
    const rootParts = root.split("/").filter((part) => part.trim() !== "");
    const rootProblem = rootParts.some((part) => part === "." || part === "..")
      ? "Name a folder of the backend, without . or .. in its path."
      : undefined;
    setProblems({ name: nameProblem, root: mount === undefined ? rootProblem : undefined });
    if (nameProblem !== undefined || (mount === undefined && rootProblem !== undefined)) {
      return;
    }
    if (isSaving) {
      return;
    }
    const onError = (error: Error) => setProblems(mountFailure(error));
    if (mount === undefined) {
      create.mutate(
        { name: folder, backendId, root: rootParts.join("/") },
        {
          onSuccess: () => onSaved(`/${folder}`),
          onError: (error) =>
            setProblems(
              isApiError(error) && error.code === "invalid_input" && rootParts.length > 0
                ? { root: "No folder of this name is in the backend." }
                : mountFailure(error),
            ),
        },
      );
    } else if (folder === mount.name) {
      onSaved(pathOf(mount));
    } else {
      rename.mutate(
        { id: mount.id, name: folder },
        { onSuccess: () => onSaved(`/${folder}`), onError },
      );
    }
  };

  return (
    <DialogFrame
      title={mount === undefined ? "Add a mount" : `Rename ${pathOf(mount)}`}
      submitLabel={mount === undefined ? "Add mount" : "Rename"}
      isSaving={isSaving}
      failure={problems.failure}
      onCancel={onCancel}
      onSubmit={submit}
    >
      <TextInput
        label="Folder name"
        description="WebDAV clients see the mount as this folder."
        value={name}
        onChange={(value) => {
          setName(value);
          setProblems((current) => ({ ...current, name: undefined, failure: undefined }));
        }}
        onEnter={submit}
        isRequired
        hasAutoFocus
        status={problems.name === undefined ? undefined : { type: "error", message: problems.name }}
        {...identifier}
      />
      {mount === undefined ? (
        <>
          <Selector
            label="Backend"
            value={backendId}
            onChange={setBackendId}
            options={backends.map((backend) => ({
              value: backend.id,
              label: backend.name,
              description: kindLabel(backend.kind),
            }))}
          />
          <TextInput
            label="Folder in the backend"
            description="Leave it empty to show the whole backend."
            value={root}
            onChange={(value) => {
              setRoot(value);
              setProblems((current) => ({ ...current, root: undefined, failure: undefined }));
            }}
            onEnter={submit}
            isOptional
            status={
              problems.root === undefined ? undefined : { type: "error", message: problems.root }
            }
            {...identifier}
          />
        </>
      ) : (
        <MetadataList>
          <MetadataListItem label="Backend">
            {backends.find((backend) => backend.id === mount.backendId)?.name ?? "Unknown"}
          </MetadataListItem>
          <MetadataListItem label="Folder">{folderOf(mount)}</MetadataListItem>
        </MetadataList>
      )}
    </DialogFrame>
  );
};

/**
 * Points a mount at a folder of another backend, as the last step of moving its files: the mount
 * keeps its name, so clients and keys limited to it keep their address.
 */
const MoveForm = ({
  mount,
  backends,
  onCancel,
  onSaved,
}: {
  mount: Mount;
  backends: readonly Backend[];
  onCancel: () => void;
  onSaved: (backend: string) => void;
}) => {
  const move = useMoveMount();
  const others = backends.filter((backend) => backend.id !== mount.backendId);
  const [backendId, setBackendId] = useState(others[0]?.id ?? "");
  const [root, setRoot] = useState("");
  const [problems, setProblems] = useState<{ root?: string; failure?: string }>({});

  const submit = () => {
    const rootParts = root.split("/").filter((part) => part.trim() !== "");
    if (rootParts.some((part) => part === "." || part === "..")) {
      setProblems({ root: "Name a folder of the backend, without . or .. in its path." });
      return;
    }
    if (backendId === "" || move.isPending) return;
    move.mutate(
      { id: mount.id, backendId, root: rootParts.join("/") },
      {
        onSuccess: () =>
          onSaved(backends.find((backend) => backend.id === backendId)?.name ?? "the backend"),
        onError: (error) =>
          setProblems(
            isApiError(error) && error.code === "invalid_input"
              ? { root: "No folder of this name is in the backend." }
              : { failure: describeError(error) },
          ),
      },
    );
  };

  return (
    <DialogFrame
      title={`Move ${pathOf(mount)}`}
      submitLabel="Move mount"
      isSaving={move.isPending}
      failure={
        problems.failure ??
        (others.length === 0 ? "Add another backend first, then copy the files to it." : undefined)
      }
      onCancel={onCancel}
      onSubmit={submit}
    >
      <Text>
        Copy the files first, with bun run migrate from a mount of this backend to a mount of the
        new one. Moving the mount then shows the new backend&apos;s files under {pathOf(mount)}.
      </Text>
      <Selector
        label="Backend"
        value={backendId}
        onChange={setBackendId}
        options={others.map((backend) => ({
          value: backend.id,
          label: backend.name,
          description: kindLabel(backend.kind),
        }))}
      />
      <TextInput
        label="Folder in the backend"
        description="Leave it empty to show the whole backend."
        value={root}
        onChange={(value) => {
          setRoot(value);
          setProblems({});
        }}
        onEnter={submit}
        isOptional
        status={problems.root === undefined ? undefined : { type: "error", message: problems.root }}
        {...identifier}
      />
    </DialogFrame>
  );
};

/** The narrowest mount table, in rem, that has room for a column per detail. */
const WIDE_MOUNT_TABLE = 39;

/** Storage & Mounts (PRD §8.4): where bytes live, and how they appear to WebDAV clients. */
export const StoragePage = () => {
  const backendsQuery = useBackends();
  const mountsQuery = useMounts();
  const settings = useStorageSettings();
  const instance = useInstanceInfo();
  const remove = useRemoveMount();
  const removeBackend = useRemoveBackend();
  const toast = useToast();
  const dialog = useFormDialog(520);
  const confirm = useImperativeAlertDialog();
  const gutter = usePageGutter();
  const [tableRef, isNarrowTable] = useNarrowerThan(WIDE_MOUNT_TABLE);
  const backends = backendsQuery.data ?? [];
  const mounts = mountsQuery.data ?? [];

  const backendName = (id: string): string =>
    backends.find((backend) => backend.id === id)?.name ?? "Unknown backend";

  // Each form gets a new key, so that it starts from its mount or the default (useFormDialog).
  const openForm = (mount?: Mount) =>
    dialog.show(
      <MountForm
        key={nextFormKey()}
        mount={mount}
        backends={backends}
        defaultBackendId={settings.data?.defaultBackendId}
        takenPaths={mounts.filter((item) => item.id !== mount?.id).map(pathOf)}
        onCancel={() => dialog.hide()}
        onSaved={(path) => {
          dialog.hide();
          toast({ body: mount === undefined ? `Added ${path}.` : `Renamed to ${path}.` });
        }}
      />,
      // Rename opens from the mount's menu, which is gone once the dialog is open, or on a phone
      // from the mount's details, whose button a tap does not focus in every browser.
      mount === undefined
        ? undefined
        : () =>
            buttonLabelled(`Actions for mount ${pathOf(mount)}`) ??
            buttonLabelled(`Details for mount ${pathOf(mount)}`),
    );

  // Without the instance's answer, the form offers the kinds every deployment of Davloom can
  // name, and the server refuses one it cannot open.
  const kinds = instance.data?.storageKinds ?? ["durable-object", "s3"];

  const openBackendForm = (backend?: Backend) =>
    dialog.show(
      <BackendForm
        key={nextFormKey()}
        backend={backend}
        kinds={kinds}
        takenNames={backends.filter((item) => item.id !== backend?.id).map((item) => item.name)}
        onCancel={() => dialog.hide()}
        onSaved={(name) => {
          dialog.hide();
          toast({ body: backend === undefined ? `Added backend “${name}”.` : `Saved “${name}”.` });
        }}
      />,
      backend === undefined
        ? undefined
        : () => buttonLabelled(`Actions for backend ${backend.name}`),
    );

  const openRemoveBackend = (backend: Backend) => {
    const used = mounts.filter((mount) => mount.backendId === backend.id);
    confirm.show({
      title: `Remove ${backend.name}?`,
      description:
        used.length > 0
          ? `${used.map(pathOf).join(", ")} ${used.length === 1 ? "uses" : "use"} this backend. Move or remove ${used.length === 1 ? "it" : "them"} first.`
          : backend.kind === "durable-object"
            ? "Its storage is deleted with it. A backend that still holds files cannot be removed."
            : "Its objects stay in the bucket. Davloom forgets the backend and its WebDAV properties.",
      actionLabel: "Remove backend",
      onAction: () => {
        confirm.hide();
        removeBackend.mutate(backend.id, {
          onSuccess: (result) =>
            toast({
              body: result.filesKept
                ? `Removed “${backend.name}”. Its objects stay in the bucket.`
                : `Removed “${backend.name}” and its storage.`,
            }),
          onError: (error) => toast({ type: "error", body: describeError(error) }),
        });
      },
    });
  };

  const openMove = (mount: Mount) =>
    dialog.show(
      <MoveForm
        key={nextFormKey()}
        mount={mount}
        backends={backends}
        onCancel={() => dialog.hide()}
        onSaved={(name) => {
          dialog.hide();
          toast({ body: `${pathOf(mount)} now shows ${name}.` });
        }}
      />,
      () =>
        buttonLabelled(`Actions for mount ${pathOf(mount)}`) ??
        buttonLabelled(`Details for mount ${pathOf(mount)}`),
    );

  const openRemove = (mount: Mount) =>
    confirm.show({
      title: `Remove ${pathOf(mount)}?`,
      description: "Its files stay in the backend, and a new mount of its folder shows them again.",
      actionLabel: "Remove mount",
      onAction: () => {
        const index = mounts.findIndex((item) => item.id === mount.id);
        const rest = mounts.filter((item) => item.id !== mount.id);
        const next = rest[Math.min(index, rest.length - 1)];
        confirm.hide();
        remove.mutate(mount.id, {
          onSuccess: () => {
            toast({ body: `Removed ${pathOf(mount)}.` });
            // The row goes away with its menu, or on a phone with its details, so focus moves to
            // the next mount's menu or row, or else to Add mount.
            refocusIfLost(() =>
              next === undefined
                ? buttonNamed("Add mount")
                : (buttonLabelled(`Actions for mount ${pathOf(next)}`) ??
                  buttonLabelled(`Details for mount ${pathOf(next)}`)),
            );
          },
          onError: (error) => toast({ type: "error", body: describeError(error) }),
        });
      },
    });

  const columns: TableColumn<MountRow>[] = [
    {
      key: "name",
      header: "Mount",
      width: proportional(1, { minWidth: 120 }),
      renderCell: (mount) => pathOf(mount),
    },
    {
      key: "backendId",
      header: "Backend",
      width: proportional(1, { minWidth: 140 }),
      renderCell: (mount) => backendName(mount.backendId),
    },
    {
      key: "root",
      header: "Folder",
      width: proportional(2, { minWidth: 160 }),
      renderCell: (mount) =>
        mount.root === "" ? (
          <Text color="secondary">Whole backend</Text>
        ) : (
          <Text type="code">{folderOf(mount)}</Text>
        ),
    },
    {
      key: "actions",
      header: <VisuallyHidden>Actions</VisuallyHidden>,
      width: pixel(64),
      align: "end",
      renderCell: (mount) => (
        <MoreMenu
          label={`Actions for mount ${pathOf(mount)}`}
          size="sm"
          alignment="end"
          items={[
            { label: "Rename", onClick: () => openForm(mount) },
            { label: "Move to another backend", onClick: () => openMove(mount) },
            { type: "divider" },
            { label: "Remove", variant: "destructive", onClick: () => openRemove(mount) },
          ]}
        />
      ),
    },
  ];

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={gutter}>
          <VStack gap={6}>
            <PageHeader
              title="Storage & Mounts"
              actions={
                <TitleAction
                  label="Add mount"
                  variant="primary"
                  icon={<Icon icon={Plus} size="sm" />}
                  isDisabled={backends.length === 0}
                  onClick={() => openForm()}
                />
              }
            />
            <VStack gap={3}>
              <TitleRow
                title={<Heading level={2}>Backends</Heading>}
                actions={
                  <TitleAction
                    label="Add backend"
                    variant="secondary"
                    size="sm"
                    icon={<Icon icon={Plus} size="sm" />}
                    isDisabled={backendsQuery.data === undefined}
                    onClick={() => openBackendForm()}
                  />
                }
                gap={3}
              />
              <QueryState
                query={backendsQuery}
                title="Cannot read the backends"
                loading={<LoadingRows rows={2} />}
              >
                {(data) => (
                  <Grid columns={{ minWidth: 300, max: 3, repeat: "fill" }} gap={4}>
                    {data.map((backend) => (
                      <BackendCard
                        key={backend.id}
                        backend={backend}
                        mountCount={mounts.filter((mount) => mount.backendId === backend.id).length}
                        isDefault={backend.id === settings.data?.defaultBackendId}
                        checkedAt={backendsQuery.dataUpdatedAt}
                        onEdit={() => openBackendForm(backend)}
                        onRemove={() => openRemoveBackend(backend)}
                      />
                    ))}
                  </Grid>
                )}
              </QueryState>
            </VStack>
            <VStack gap={3}>
              <Heading level={2}>Mounts</Heading>
              <VStack ref={tableRef}>
                <QueryState query={mountsQuery} title="Cannot read the mounts">
                  {(data) =>
                    data.length === 0 ? (
                      <EmptyState
                        title="No mounts yet"
                        description="A mount shows a backend, or a folder of one, to WebDAV clients."
                      />
                    ) : isNarrowTable ? (
                      // Where a column per detail has no room, as on a phone, each mount is a row
                      // with its path and backend, the same shape as a key's on Credentials.
                      // Opening the row shows its folder, and Rename and Remove.
                      <ExpandableList
                        records={data.map((mount) => ({
                          id: mount.id,
                          title: pathOf(mount),
                          summary: backendName(mount.backendId),
                          details: (
                            <>
                              <MetadataList>
                                <MetadataListItem label="Folder">
                                  {folderOf(mount)}
                                </MetadataListItem>
                              </MetadataList>
                              <HStack gap={2}>
                                <StackItem size="fill">
                                  <Button
                                    label="Rename"
                                    variant="secondary"
                                    width="100%"
                                    onClick={() => openForm(mount)}
                                  />
                                </StackItem>
                                <StackItem size="fill">
                                  <Button
                                    label="Move"
                                    variant="secondary"
                                    width="100%"
                                    onClick={() => openMove(mount)}
                                  />
                                </StackItem>
                                <StackItem size="fill">
                                  <Button
                                    label="Remove"
                                    variant="destructive"
                                    width="100%"
                                    onClick={() => openRemove(mount)}
                                  />
                                </StackItem>
                              </HStack>
                            </>
                          ),
                          toggleLabel: `Details for mount ${pathOf(mount)}`,
                        }))}
                      />
                    ) : (
                      <Card padding={0} elevation="low">
                        <Table<MountRow>
                          data={data.map((mount) => ({ ...mount }))}
                          columns={columns}
                          idKey="id"
                          textOverflow="truncate"
                          hasHover
                        />
                      </Card>
                    )
                  }
                </QueryState>
              </VStack>
            </VStack>
          </VStack>
          {dialog.element}
          {confirm.element}
        </LayoutContent>
      }
    />
  );
};
