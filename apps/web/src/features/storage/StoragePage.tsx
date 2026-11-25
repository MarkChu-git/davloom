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
import { useT } from "../i18n/I18nProvider";
import type { Translator } from "../i18n/translate";
import { ExpandableList } from "../shell/ExpandableList";
import { buttonLabelled, buttonNamed, refocusIfLost } from "../shell/focus";
import { AfterFirstPaint } from "../shell/AfterFirstPaint";
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
const folderOf = (t: Translator, mount: Pick<Mount, "root">): string =>
  mount.root === "" ? t("mount.wholeBackend") : `/${mount.root}`;

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
}) => {
  const t = useT();
  return (
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
            <Button label={t("action.cancel")} variant="secondary" onClick={onCancel} />
            <Button label={submitLabel} variant="primary" isLoading={isSaving} onClick={onSubmit} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
};

const mountFailure = (
  t: Translator,
  error: unknown,
): { name?: string; root?: string; failure?: string } => {
  if (isApiError(error) && error.code === "name_taken") {
    return { name: t("mount.nameTaken") };
  }
  if (isApiError(error) && error.code === "invalid_input") {
    return { failure: t("mount.refused") };
  }
  return { failure: describeError(t, error) };
};

/** The title of the mount form: Add a mount, or Rename /files. */
export const mountFormTitle = (t: Translator, mount?: Mount): string =>
  mount === undefined ? t("mount.addTitle") : t("mount.renameTitle", { path: pathOf(mount) });

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
  const t = useT();
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
    const nameProblem = mountNameProblem(t, name, takenPaths);
    const rootParts = root.split("/").filter((part) => part.trim() !== "");
    const rootProblem = rootParts.some((part) => part === "." || part === "..")
      ? t("mount.rootDots")
      : undefined;
    setProblems({ name: nameProblem, root: mount === undefined ? rootProblem : undefined });
    if (nameProblem !== undefined || (mount === undefined && rootProblem !== undefined)) {
      return;
    }
    if (isSaving) {
      return;
    }
    const onError = (error: Error) => setProblems(mountFailure(t, error));
    if (mount === undefined) {
      create.mutate(
        { name: folder, backendId, root: rootParts.join("/") },
        {
          onSuccess: () => onSaved(`/${folder}`),
          onError: (error) =>
            setProblems(
              isApiError(error) && error.code === "invalid_input" && rootParts.length > 0
                ? { root: t("mount.rootMissing") }
                : mountFailure(t, error),
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
      title={mountFormTitle(t, mount)}
      submitLabel={mount === undefined ? t("mount.add") : t("action.rename")}
      isSaving={isSaving}
      failure={problems.failure}
      onCancel={onCancel}
      onSubmit={submit}
    >
      <TextInput
        label={t("mount.folderName")}
        description={t("mount.folderNameDescription")}
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
            label={t("mount.backend")}
            value={backendId}
            onChange={setBackendId}
            options={backends.map((backend) => ({
              value: backend.id,
              label: backend.name,
              description: kindLabel(t, backend.kind),
            }))}
          />
          <TextInput
            label={t("mount.root")}
            description={t("mount.rootDescription")}
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
          <MetadataListItem label={t("mount.backend")}>
            {backends.find((backend) => backend.id === mount.backendId)?.name ?? t("files.unknown")}
          </MetadataListItem>
          <MetadataListItem label={t("files.folder")}>{folderOf(t, mount)}</MetadataListItem>
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
  const t = useT();
  const move = useMoveMount();
  const others = backends.filter((backend) => backend.id !== mount.backendId);
  const [backendId, setBackendId] = useState(others[0]?.id ?? "");
  const [root, setRoot] = useState("");
  const [problems, setProblems] = useState<{ root?: string; failure?: string }>({});

  const submit = () => {
    const rootParts = root.split("/").filter((part) => part.trim() !== "");
    if (rootParts.some((part) => part === "." || part === "..")) {
      setProblems({ root: t("mount.rootDots") });
      return;
    }
    if (backendId === "" || move.isPending) return;
    move.mutate(
      { id: mount.id, backendId, root: rootParts.join("/") },
      {
        onSuccess: () =>
          onSaved(
            backends.find((backend) => backend.id === backendId)?.name ?? t("mount.theBackend"),
          ),
        onError: (error) =>
          setProblems(
            isApiError(error) && error.code === "invalid_input"
              ? { root: t("mount.rootMissing") }
              : { failure: describeError(t, error) },
          ),
      },
    );
  };

  return (
    <DialogFrame
      title={moveFormTitle(t, mount)}
      submitLabel={t("mount.moveSubmit")}
      isSaving={move.isPending}
      failure={problems.failure ?? (others.length === 0 ? t("mount.noOtherBackend") : undefined)}
      onCancel={onCancel}
      onSubmit={submit}
    >
      <Text>{t("mount.moveHow", { path: pathOf(mount) })}</Text>
      <Selector
        label={t("mount.backend")}
        value={backendId}
        onChange={setBackendId}
        options={others.map((backend) => ({
          value: backend.id,
          label: backend.name,
          description: kindLabel(t, backend.kind),
        }))}
      />
      <TextInput
        label={t("mount.root")}
        description={t("mount.rootDescription")}
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

/** The title of the form that moves a mount. */
const moveFormTitle = (t: Translator, mount: Mount): string =>
  t("mount.moveTitle", { path: pathOf(mount) });

/** The narrowest mount table, in rem, that has room for a column per detail. */
const WIDE_MOUNT_TABLE = 39;

/** Storage & Mounts (PRD §8.4): where bytes live, and how they appear to WebDAV clients. */
export const StoragePage = () => {
  const t = useT();
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
    backends.find((backend) => backend.id === id)?.name ?? t("overview.unknownBackend");

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
          toast({
            body: mount === undefined ? t("mount.added", { path }) : t("mount.renamed", { path }),
          });
        }}
      />,
      mountFormTitle(t, mount),
      // Rename opens from the mount's menu, which is gone once the dialog is open, or on a phone
      // from the mount's details, whose button a tap does not focus in every browser.
      mount === undefined
        ? undefined
        : () =>
            buttonLabelled(t("mount.actionsFor", { path: pathOf(mount) })) ??
            buttonLabelled(t("mount.detailsFor", { path: pathOf(mount) })),
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
          toast({
            body:
              backend === undefined
                ? t("backendForm.added", { name })
                : t("backendForm.saved", { name }),
          });
        }}
      />,
      backend === undefined
        ? t("backendForm.addTitle")
        : t("backendForm.editTitle", { name: backend.name }),
      backend === undefined
        ? undefined
        : () => buttonLabelled(t("backendCard.actionsFor", { name: backend.name })),
    );

  const openRemoveBackend = (backend: Backend) => {
    const used = mounts.filter((mount) => mount.backendId === backend.id);
    confirm.show({
      title: t("backendForm.removeTitle", { name: backend.name }),
      description:
        used.length > 0
          ? t("backendForm.removeUsed", {
              count: used.length,
              paths: used.map(pathOf).join(t("keys.pathSeparator")),
            })
          : backend.kind === "durable-object"
            ? t("backendForm.removeDurable")
            : t("backendForm.removeBucket"),
      actionLabel: t("backendForm.remove"),
      onAction: () => {
        confirm.hide();
        removeBackend.mutate(backend.id, {
          onSuccess: (result) =>
            toast({
              body: result.filesKept
                ? t("backendForm.removedKept", { name: backend.name })
                : t("backendForm.removed", { name: backend.name }),
            }),
          onError: (error) => toast({ type: "error", body: describeError(t, error) }),
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
          toast({ body: t("mount.moved", { path: pathOf(mount), name }) });
        }}
      />,
      moveFormTitle(t, mount),
      () =>
        buttonLabelled(t("mount.actionsFor", { path: pathOf(mount) })) ??
        buttonLabelled(t("mount.detailsFor", { path: pathOf(mount) })),
    );

  const openRemove = (mount: Mount) =>
    confirm.show({
      title: t("mount.removeTitle", { path: pathOf(mount) }),
      description: t("mount.removeDescription"),
      actionLabel: t("mount.remove"),
      onAction: () => {
        const index = mounts.findIndex((item) => item.id === mount.id);
        const rest = mounts.filter((item) => item.id !== mount.id);
        const next = rest[Math.min(index, rest.length - 1)];
        confirm.hide();
        remove.mutate(mount.id, {
          onSuccess: () => {
            toast({ body: t("mount.removed", { path: pathOf(mount) }) });
            // The row goes away with its menu, or on a phone with its details, so focus moves to
            // the next mount's menu or row, or else to Add mount.
            refocusIfLost(() =>
              next === undefined
                ? buttonNamed(t("mount.add"))
                : (buttonLabelled(t("mount.actionsFor", { path: pathOf(next) })) ??
                  buttonLabelled(t("mount.detailsFor", { path: pathOf(next) }))),
            );
          },
          onError: (error) => toast({ type: "error", body: describeError(t, error) }),
        });
      },
    });

  const columns: TableColumn<MountRow>[] = [
    {
      key: "name",
      header: t("keys.mount"),
      width: proportional(1, { minWidth: 120 }),
      renderCell: (mount) => pathOf(mount),
    },
    {
      key: "backendId",
      header: t("mount.backend"),
      width: proportional(1, { minWidth: 140 }),
      renderCell: (mount) => backendName(mount.backendId),
    },
    {
      key: "root",
      header: t("files.folder"),
      width: proportional(2, { minWidth: 160 }),
      renderCell: (mount) =>
        mount.root === "" ? (
          <Text color="secondary">{t("mount.wholeBackend")}</Text>
        ) : (
          <Text type="code">{folderOf(t, mount)}</Text>
        ),
    },
    {
      key: "actions",
      header: <VisuallyHidden>{t("files.actions")}</VisuallyHidden>,
      width: pixel(64),
      align: "end",
      renderCell: (mount) => (
        <MoreMenu
          label={t("mount.actionsFor", { path: pathOf(mount) })}
          size="sm"
          alignment="end"
          items={[
            { label: t("action.rename"), onClick: () => openForm(mount) },
            { label: t("mount.moveToOther"), onClick: () => openMove(mount) },
            { type: "divider" },
            {
              label: t("action.remove"),
              variant: "destructive",
              onClick: () => openRemove(mount),
            },
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
              title={t("nav.storage")}
              actions={
                <TitleAction
                  label={t("mount.add")}
                  variant="primary"
                  icon={<Icon icon={Plus} size="sm" />}
                  isDisabled={backends.length === 0}
                  onClick={() => openForm()}
                />
              }
            />
            {/* Built one section at a time once the page's header is on screen. */}
            <AfterFirstPaint>
              <VStack gap={3}>
                <TitleRow
                  title={<Heading level={2}>{t("storage.backends")}</Heading>}
                  actions={
                    <TitleAction
                      label={t("backendForm.add")}
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
                  title={t("storage.cannotReadBackends")}
                  loading={<LoadingRows rows={2} />}
                >
                  {(data) => (
                    <Grid columns={{ minWidth: 300, max: 3, repeat: "fill" }} gap={4}>
                      {data.map((backend) => (
                        <BackendCard
                          key={backend.id}
                          backend={backend}
                          mountCount={
                            mounts.filter((mount) => mount.backendId === backend.id).length
                          }
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
            </AfterFirstPaint>
            <AfterFirstPaint>
              <VStack gap={3}>
                <Heading level={2}>{t("overview.mounts")}</Heading>
                <VStack ref={tableRef}>
                  <QueryState query={mountsQuery} title={t("storage.cannotReadMounts")}>
                    {(data) =>
                      data.length === 0 ? (
                        <EmptyState
                          title={t("files.noMounts")}
                          description={t("storage.noMountsDescription")}
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
                                  <MetadataListItem label={t("files.folder")}>
                                    {folderOf(t, mount)}
                                  </MetadataListItem>
                                </MetadataList>
                                <HStack gap={2}>
                                  <StackItem size="fill">
                                    <Button
                                      label={t("action.rename")}
                                      variant="secondary"
                                      width="100%"
                                      onClick={() => openForm(mount)}
                                    />
                                  </StackItem>
                                  <StackItem size="fill">
                                    <Button
                                      label={t("files.move")}
                                      variant="secondary"
                                      width="100%"
                                      onClick={() => openMove(mount)}
                                    />
                                  </StackItem>
                                  <StackItem size="fill">
                                    <Button
                                      label={t("action.remove")}
                                      variant="destructive"
                                      width="100%"
                                      onClick={() => openRemove(mount)}
                                    />
                                  </StackItem>
                                </HStack>
                              </>
                            ),
                            toggleLabel: t("mount.detailsFor", { path: pathOf(mount) }),
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
            </AfterFirstPaint>
          </VStack>
          {dialog.element}
          {confirm.element}
        </LayoutContent>
      }
    />
  );
};
