import { useImperativeAlertDialog } from "@astryxdesign/core/AlertDialog";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { useAnnounce } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Selector } from "@astryxdesign/core/Selector";
import { Table, pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { backends, type Mount, type StorageBackend } from "../sample-data/data";
import { formatBytes, formatCount, formatRelative } from "../sample-data/format";
import { sampleId } from "../sample-data/id";
import { useDefaultBackendId } from "../settings/settingsStore";
import { buttonLabelled, buttonNamed, refocusIfLost } from "../shell/focus";
import { PageHeader } from "../shell/PageHeader";
import { useFormDialog } from "../shell/useFormDialog";
import { StatusLabel } from "../shell/StatusLabel";
import { BACKEND_STATUS } from "./backendStatus";
import { mountFolderOf, mountNameProblem, removeMount, saveMount, useMounts } from "./mountStore";

const backendName = (id: string): string =>
  backends.find((backend) => backend.id === id)?.name ?? id;

type Check = { state: "idle" } | { state: "checking" } | { state: "done"; answered: boolean };

const BackendCard = ({ backend, mountCount }: { backend: StorageBackend; mountCount: number }) => {
  const announce = useAnnounce();
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
    <Card>
      <VStack gap={4}>
        <HStack hAlign="between" vAlign="start" gap={3}>
          <VStack gap={0.5}>
            <Heading level={3}>{backend.name}</Heading>
            <Text type="supporting" color="secondary">
              {backend.kind}
            </Text>
          </VStack>
          <StatusLabel tone={status.tone} label={status.label} />
        </HStack>
        <MetadataList>
          <MetadataListItem label="Endpoint">
            <Text type="code">{backend.endpoint}</Text>
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
      </VStack>
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
          subtitle="A mount publishes a bucket and prefix as a top-level WebDAV folder."
          onOpenChange={onCancel}
        />
      }
      content={
        <LayoutContent>
          <VStack gap={4}>
            <TextInput
              label="Folder name"
              description="Clients see it at the top level, for example /music."
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
              description="Only keys under this prefix appear in the mount."
              value={prefix}
              onChange={setPrefix}
              onEnter={submit}
              placeholder="music/"
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

/** Storage & Mounts (PRD §8.4): where bytes live, and how they appear to WebDAV clients. */
export const StoragePage = () => {
  const mounts = useMounts();
  const defaultBackendId = useDefaultBackendId();
  const toast = useToast();
  const dialog = useFormDialog(520);
  const confirm = useImperativeAlertDialog();

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
      // Edit opens from the mount's menu, which is gone once the dialog is open.
      mount === undefined ? undefined : () => buttonLabelled(`Actions for mount ${mount.path}`),
    );

  const openRemove = (mount: Mount) =>
    confirm.show({
      title: `Remove ${mount.path}?`,
      description:
        "WebDAV clients can no longer reach this folder. The files stay in the bucket, and adding the mount again brings them back.",
      actionLabel: "Remove mount",
      onAction: () => {
        const index = mounts.findIndex((item) => item.id === mount.id);
        const next = mounts.filter((item) => item.id !== mount.id)[index] ?? mounts[index - 1];
        removeMount(mount.id);
        confirm.hide();
        toast({ body: `Removed ${mount.path}.` });
        // The row and its menu go away, so focus moves to the next mount's menu or Add mount.
        refocusIfLost(() =>
          next === undefined || next.id === mount.id
            ? buttonNamed("Add mount")
            : buttonLabelled(`Actions for mount ${next.path}`),
        );
      },
    });

  const columns: TableColumn<Mount>[] = [
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
    {
      key: "actions",
      header: <VisuallyHidden>Actions</VisuallyHidden>,
      width: pixel(64),
      align: "end",
      renderCell: (mount) => (
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
      ),
    },
  ];

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={6}>
          <VStack gap={6}>
            <PageHeader
              title="Storage & Mounts"
              actions={
                <Button
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
              <Card padding={0}>
                <Table<Mount>
                  data={mounts}
                  columns={columns}
                  idKey="id"
                  textOverflow="truncate"
                  hasHover
                />
              </Card>
            </VStack>
          </VStack>
          {dialog.element}
          {confirm.element}
        </LayoutContent>
      }
    />
  );
};
