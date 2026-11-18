import { useImperativeAlertDialog } from "@astryxdesign/core/AlertDialog";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { useAnnounce } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  Stack,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Selector } from "@astryxdesign/core/Selector";
import { Table, pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import * as stylex from "@stylexjs/stylex";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { backends, type Mount, type StorageBackend } from "../sample-data/data";
import { formatBytes, formatCount, formatRelative } from "../sample-data/format";
import { sampleId } from "../sample-data/id";
import { useDefaultBackendId } from "../settings/settingsStore";
import { ExpandableList } from "../shell/ExpandableList";
import { buttonLabelled, buttonNamed, refocusIfLost } from "../shell/focus";
import { PageHeader } from "../shell/PageHeader";
import { usePageGutter } from "../shell/pageWidth";
import { StatusLabel } from "../shell/StatusLabel";
import { TitleAction } from "../shell/TitleRow";
import { useFormDialog } from "../shell/useFormDialog";
import { useNarrowerThan } from "../shell/useNarrowerThan";
import { BACKEND_STATUS } from "./backendStatus";
import { mountFolderOf, mountNameProblem, removeMount, saveMount, useMounts } from "./mountStore";

const backendName = (id: string): string =>
  backends.find((backend) => backend.id === id)?.name ?? id;

type Check = { state: "idle" } | { state: "checking" } | { state: "done"; answered: boolean };

/** The narrowest backend card, in rem, with room for the status beside the name and each value
 * beside its label: the RustFS endpoint is the longest value. */
const WIDE_BACKEND_CARD = 21;

const styles = stylex.create({
  // A backend card spans three rows of the backend grid, one for each part: the name and status,
  // the details, and Verify connection. The card takes the grid's rows as its own (subgrid), so
  // each part starts on the same line as the parts of the cards beside it, and the actions line up
  // along the bottom of a row of cards where one card has no capacity bar. Each part keeps its own
  // height at the top of its row: stretched to the row, a line of actions whose words fit beside
  // Verify connection would center the button below the button of a card whose words wrap.
  card: {
    display: "grid",
    gridRow: "span 3",
    gridTemplateRows: "subgrid",
    alignItems: "start",
  },
  // The status's words sit on the line of the name's. Stack's vAlign offers no baseline, so a wide
  // card's header takes this in its place.
  onBaseline: {
    alignItems: "baseline",
  },
});

const BackendCard = ({ backend, mountCount }: { backend: StorageBackend; mountCount: number }) => {
  const announce = useAnnounce();
  // A narrower card, as on the narrowest phones, puts the status under the backend's kind and
  // each label above its value, so neither the name nor the endpoint breaks across lines.
  const [cardRef, isNarrow] = useNarrowerThan(WIDE_BACKEND_CARD);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const status = BACKEND_STATUS[backend.status];
  const answered = backend.status !== "unreachable";

  // Leaving the page ends the check, so its answer is never announced on another page.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const verify = () => {
    setCheck({ state: "checking" });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCheck({ state: "done", answered });
      announce(
        answered
          ? `${backend.name} answered.`
          : `${backend.name} is still unreachable: ${backend.statusDetail}.`,
        answered ? "polite" : "assertive",
      );
    }, 900);
  };

  return (
    <Card ref={cardRef} elevation="low" xstyle={styles.card}>
      <Stack
        direction={isNarrow ? "vertical" : "horizontal"}
        hAlign={isNarrow ? "start" : "between"}
        vAlign={isNarrow ? "start" : undefined}
        gap={isNarrow ? 2 : 3}
        xstyle={isNarrow ? undefined : styles.onBaseline}
      >
        <VStack gap={0.5}>
          <Heading level={3}>{backend.name}</Heading>
          <Text type="supporting" color="secondary">
            {backend.kind}
          </Text>
        </VStack>
        <StatusLabel tone={status.tone} label={status.label} />
      </Stack>
      <VStack gap={4}>
        <MetadataList label={isNarrow ? { position: "top" } : undefined}>
          <MetadataListItem label="Endpoint">
            {backend.endpoint === undefined ? (
              "Built in"
            ) : (
              <Text type="code">{backend.endpoint}</Text>
            )}
          </MetadataListItem>
          <MetadataListItem label="Objects">{formatCount(backend.objectCount)}</MetadataListItem>
          <MetadataListItem label="Stored">
            {backend.capacityBytes === undefined
              ? `${formatBytes(backend.usedBytes)}, no fixed limit`
              : `${formatBytes(backend.usedBytes)} of ${formatBytes(backend.capacityBytes)}`}
          </MetadataListItem>
          <MetadataListItem label="Mounts">{formatCount(mountCount)}</MetadataListItem>
        </MetadataList>
        {backend.capacityBytes === undefined ? null : (
          <ProgressBar
            label={`${backend.name} capacity used`}
            isLabelHidden
            value={backend.usedBytes}
            max={backend.capacityBytes}
          />
        )}
      </VStack>
      <HStack gap={3} vAlign="center" wrap="wrap">
        <Button
          label="Verify connection"
          variant="secondary"
          size="sm"
          isLoading={check.state === "checking"}
          onClick={verify}
        />
        {check.state === "done" ? (
          <StatusLabel
            tone={check.answered ? "success" : "error"}
            label={
              check.answered
                ? `Answered just now, ${backend.statusDetail.replace("answered ", "")}`
                : `Still unreachable, ${backend.statusDetail}`
            }
          />
        ) : (
          <Text type="supporting" color="secondary">
            {`Last checked ${formatRelative(backend.checkedAt)}`}
          </Text>
        )}
      </HStack>
    </Card>
  );
};

const MountForm = ({
  mount,
  defaultBackendId,
  takenPaths,
  onCancel,
  onSave,
}: {
  mount?: Mount;
  defaultBackendId: string;
  takenPaths: readonly string[];
  onCancel: () => void;
  onSave: (mount: Mount) => void;
}) => {
  const [name, setName] = useState(mount?.id ?? "");
  const [backendId, setBackendId] = useState(mount?.backendId ?? defaultBackendId);
  const [bucket, setBucket] = useState(mount?.bucket ?? "default");
  const [prefix, setPrefix] = useState(mount?.prefix ?? "");
  const [problems, setProblems] = useState<{ name?: string; bucket?: string }>({});

  const submit = () => {
    const folder = mountFolderOf(name);
    const next = {
      // A mount keeps its folder name, so only a new one is checked.
      name: mount === undefined ? mountNameProblem(name, takenPaths) : undefined,
      bucket: bucket.trim() === "" ? "Enter the bucket to publish." : undefined,
    };
    setProblems(next);
    if (next.name === undefined && next.bucket === undefined) {
      onSave({
        id: mount?.id ?? folder,
        path: mount?.path ?? `/${folder}`,
        backendId,
        bucket: bucket.trim(),
        prefix: prefix.trim(),
      });
    }
  };

  const identifier = {
    autoCapitalize: "none",
    hasAutoCorrect: false,
    hasSpellCheck: false,
  } as const;

  return (
    <Layout
      header={
        <DialogHeader
          title={mount === undefined ? "Add a mount" : `Edit ${mount.path}`}
          onOpenChange={onCancel}
        />
      }
      content={
        <LayoutContent>
          <VStack gap={4}>
            <TextInput
              label="Folder name"
              value={name}
              onChange={(value) => {
                setName(value);
                setProblems((current) => ({ ...current, name: undefined }));
              }}
              onEnter={submit}
              isRequired
              isDisabled={mount !== undefined}
              hasAutoFocus={mount === undefined}
              status={
                problems.name === undefined ? undefined : { type: "error", message: problems.name }
              }
              {...identifier}
            />
            <Selector
              label="Backend"
              value={backendId}
              onChange={setBackendId}
              options={backends.map((backend) => ({
                value: backend.id,
                label: backend.name,
                description: backend.kind,
              }))}
            />
            <TextInput
              label="Bucket"
              value={bucket}
              onChange={(value) => {
                setBucket(value);
                setProblems((current) => ({ ...current, bucket: undefined }));
              }}
              onEnter={submit}
              isRequired
              status={
                problems.bucket === undefined
                  ? undefined
                  : { type: "error", message: problems.bucket }
              }
              {...identifier}
            />
            <TextInput
              label="Prefix"
              value={prefix}
              onChange={setPrefix}
              onEnter={submit}
              isOptional
              {...identifier}
            />
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" variant="secondary" onClick={onCancel} />
            <Button
              label={mount === undefined ? "Add mount" : "Save"}
              variant="primary"
              onClick={submit}
            />
          </HStack>
        </LayoutFooter>
      }
    />
  );
};

/** The narrowest mount table, in rem, that has room for a column per detail. */
const WIDE_MOUNT_TABLE = 39;

const WIDE_MOUNT_COLUMNS: TableColumn<Mount>[] = [
  { key: "path", header: "Mount", width: proportional(1, { minWidth: 120 }) },
  {
    key: "backendId",
    header: "Backend",
    width: proportional(1, { minWidth: 140 }),
    renderCell: (mount) => backendName(mount.backendId),
  },
  {
    key: "bucket",
    header: "Bucket and prefix",
    width: proportional(2, { minWidth: 180 }),
    renderCell: (mount) => <Text type="code">{`${mount.bucket}/${mount.prefix}`}</Text>,
  },
];

/** Storage & Mounts (PRD §8.4): where bytes live, and how they appear to WebDAV clients. */
export const StoragePage = () => {
  const mounts = useMounts();
  const defaultBackendId = useDefaultBackendId();
  const toast = useToast();
  const dialog = useFormDialog(520);
  const confirm = useImperativeAlertDialog();
  const gutter = usePageGutter();
  const [tableRef, isNarrowTable] = useNarrowerThan(WIDE_MOUNT_TABLE);

  // Each form gets a new key, so that it starts from its mount or the default (useFormDialog).
  const openForm = (mount?: Mount) =>
    dialog.show(
      <MountForm
        key={sampleId()}
        mount={mount}
        defaultBackendId={defaultBackendId}
        takenPaths={mounts.filter((item) => item.id !== mount?.id).map((item) => item.path)}
        onCancel={() => dialog.hide()}
        onSave={(saved) => {
          saveMount(saved);
          dialog.hide();
          toast({ body: mount === undefined ? `Added ${saved.path}.` : `Saved ${saved.path}.` });
        }}
      />,
      // Edit opens from the mount's menu, which is gone once the dialog is open, or on a phone from
      // the mount's details, whose button a tap does not focus in every browser.
      mount === undefined
        ? undefined
        : () =>
            buttonLabelled(`Actions for mount ${mount.path}`) ??
            buttonLabelled(`Details for mount ${mount.path}`),
    );

  const openRemove = (mount: Mount) =>
    confirm.show({
      title: `Remove ${mount.path}?`,
      description: "Its files stay in the bucket.",
      actionLabel: "Remove mount",
      onAction: () => {
        const index = mounts.findIndex((item) => item.id === mount.id);
        const next = mounts.filter((item) => item.id !== mount.id)[index] ?? mounts[index - 1];
        removeMount(mount.id);
        confirm.hide();
        toast({ body: `Removed ${mount.path}.` });
        // The row goes away with its menu, or on a phone with its details, so focus moves to the
        // next mount's menu or row, or else to Add mount.
        refocusIfLost(() =>
          next === undefined || next.id === mount.id
            ? buttonNamed("Add mount")
            : (buttonLabelled(`Actions for mount ${next.path}`) ??
              buttonLabelled(`Details for mount ${next.path}`)),
        );
      },
    });

  const mountMenu = (mount: Mount) => (
    <MoreMenu
      label={`Actions for mount ${mount.path}`}
      size="sm"
      alignment="end"
      items={[
        { label: "Edit", onClick: () => openForm(mount) },
        { type: "divider" },
        { label: "Remove", variant: "destructive", onClick: () => openRemove(mount) },
      ]}
    />
  );
  const columns: TableColumn<Mount>[] = [
    ...WIDE_MOUNT_COLUMNS,
    {
      key: "actions",
      header: <VisuallyHidden>Actions</VisuallyHidden>,
      width: pixel(64),
      align: "end",
      renderCell: mountMenu,
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
                  onClick={() => openForm()}
                />
              }
            />
            <VStack gap={3}>
              <Heading level={2}>Backends</Heading>
              <Grid columns={{ minWidth: 300, max: 3, repeat: "fit" }} gap={4}>
                {backends.map((backend) => (
                  <BackendCard
                    key={backend.id}
                    backend={backend}
                    mountCount={mounts.filter((mount) => mount.backendId === backend.id).length}
                  />
                ))}
              </Grid>
            </VStack>
            <VStack gap={3}>
              <Heading level={2}>Mounts</Heading>
              {isNarrowTable ? (
                // Where a column per detail has no room, as on a phone, each mount is a row with its
                // path and backend, the same shape as a key's on Credentials. Opening the row shows
                // its bucket and prefix, and Edit and Remove.
                <ExpandableList
                  ref={tableRef}
                  records={mounts.map((mount) => ({
                    id: mount.id,
                    title: mount.path,
                    summary: backendName(mount.backendId),
                    details: (
                      <>
                        {/* The bucket and the prefix each have a line, as in the form, so the
                            narrowest phone breaks neither name. */}
                        <MetadataList>
                          <MetadataListItem label="Bucket">
                            <Text type="code">{mount.bucket}</Text>
                          </MetadataListItem>
                          <MetadataListItem label="Prefix">
                            {mount.prefix === "" ? "None" : <Text type="code">{mount.prefix}</Text>}
                          </MetadataListItem>
                        </MetadataList>
                        <HStack gap={2}>
                          <StackItem size="fill">
                            <Button
                              label="Edit"
                              variant="secondary"
                              width="100%"
                              onClick={() => openForm(mount)}
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
                    toggleLabel: `Details for mount ${mount.path}`,
                  }))}
                />
              ) : (
                <Card ref={tableRef} padding={0} elevation="low">
                  <Table<Mount>
                    data={mounts}
                    columns={columns}
                    idKey="id"
                    textOverflow="truncate"
                    hasHover
                  />
                </Card>
              )}
            </VStack>
          </VStack>
          {dialog.element}
          {confirm.element}
        </LayoutContent>
      }
    />
  );
};
