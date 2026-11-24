import { useImperativeAlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
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
import { Switch } from "@astryxdesign/core/Switch";
import { Table, pixel, proportional, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { Plus } from "lucide-react";
import { useState } from "react";
import { describeError } from "../api/client";
import { webdavAddress } from "../api/dav";
import { useApiKeys, useCreateKey, useRevokeKey, type ApiKey } from "../api/queries";
import { CopyField } from "../shell/CopyField";
import { ExpandableList } from "../shell/ExpandableList";
import { buttonLabelled, buttonNamed, refocusIfLost } from "../shell/focus";
import { formatDate } from "../shell/format";
import { PageHeader } from "../shell/PageHeader";
import { usePageGutter } from "../shell/pageWidth";
import { QueryState } from "../shell/QueryState";
import { StatusLabel, type Tone } from "../shell/StatusLabel";
import { TitleAction } from "../shell/TitleRow";
import { useNarrowerThan } from "../shell/useNarrowerThan";
import { hasExpired, keyStateOf, parseFolders, reachOf, type KeyState } from "./keyState";

// Rows keep the API's fields; the table wants records.
type KeyRow = ApiKey & Record<string, unknown>;

const EXPIRY_OPTIONS = [
  { value: "30", label: "In 30 days" },
  { value: "90", label: "In 90 days" },
  { value: "365", label: "In a year" },
  { value: "never", label: "Never" },
] as const;

const KEY_STATES: Record<KeyState, { tone: Tone; label: string }> = {
  active: { tone: "success", label: "Active" },
  expired: { tone: "warning", label: "Expired" },
  disabled: { tone: "error", label: "Off" },
};

const accessOf = (key: ApiKey): string =>
  key.access === "read-only" ? "Read only" : "Read and write";

/** The access level, with the folders under it when the key is limited to some. */
const KeyAccess = ({ apiKey }: { apiKey: ApiKey }) => (
  <VStack gap={0.5}>
    <Text>{accessOf(apiKey)}</Text>
    {apiKey.paths === null ? null : (
      <Text type="code" color="secondary" maxLines={2}>
        {reachOf(apiKey.paths)}
      </Text>
    )}
  </VStack>
);

const expiresOf = (key: ApiKey): string =>
  key.expiresAt === null ? "Never" : formatDate(key.expiresAt);

const startOf = (key: ApiKey): string => (key.start === null ? "—" : `${key.start}…`);

const KeyName = ({ apiKey }: { apiKey: ApiKey }) => (
  <VStack gap={0.5}>
    <Text weight="semibold" maxLines={1}>
      {apiKey.name}
    </Text>
    <Text type="code" color="secondary">
      {startOf(apiKey)}
    </Text>
  </VStack>
);

/** The time the page opened, which a key's status and expiry are measured against. */
const useNow = (): Date => useState(() => new Date())[0];

const KeyStatus = ({ apiKey }: { apiKey: ApiKey }) => (
  <StatusLabel {...KEY_STATES[keyStateOf(apiKey, useNow())]} />
);

/** The narrowest table, in rem, that has room for a column per detail. */
const WIDE_TABLE = 46;

const WIDE_COLUMNS: TableColumn<KeyRow>[] = [
  {
    key: "name",
    header: "Name",
    width: proportional(2, { minWidth: 180 }),
    renderCell: (key) => <KeyName apiKey={key} />,
  },
  {
    key: "access",
    header: "Access",
    width: pixel(168),
    renderCell: (key) => <KeyAccess apiKey={key} />,
  },
  {
    key: "createdAt",
    header: "Created",
    width: pixel(120),
    renderCell: (key) => <Text color="secondary">{formatDate(key.createdAt)}</Text>,
  },
  {
    key: "expiresAt",
    header: "Expires",
    width: pixel(120),
    renderCell: (key) => <Text color="secondary">{expiresOf(key)}</Text>,
  },
  {
    key: "state",
    header: "Status",
    width: pixel(120),
    renderCell: (key) => <KeyStatus apiKey={key} />,
  },
];

/** A key's first characters, with its status at the end of the line. */
const KeySummary = ({ apiKey }: { apiKey: ApiKey }) => (
  <HStack gap={3} vAlign="center">
    <StackItem size="fill">
      <Text type="code" color="secondary" maxLines={1}>
        {startOf(apiKey)}
      </Text>
    </StackItem>
    <KeyStatus apiKey={apiKey} />
  </HStack>
);

/** What a key's row shows once opened: the details the table has columns for. */
const KeyFacts = ({ apiKey }: { apiKey: ApiKey }) => {
  const now = useNow();
  return (
    <MetadataList>
      <MetadataListItem label="Access">{accessOf(apiKey)}</MetadataListItem>
      <MetadataListItem label="Reaches">{reachOf(apiKey.paths)}</MetadataListItem>
      <MetadataListItem label="Created">{formatDate(apiKey.createdAt)}</MetadataListItem>
      <MetadataListItem label={hasExpired(apiKey, now) ? "Expired" : "Expires"}>
        {expiresOf(apiKey)}
      </MetadataListItem>
    </MetadataList>
  );
};

/** The new key, shown this once, and how a WebDAV client signs in with it. */
const ShowOnce = ({
  name,
  secret,
  onDone,
}: {
  name: string;
  secret: string;
  onDone: () => void;
}) => (
  <Layout
    header={<DialogHeader title={`Key “${name}” is ready`} onOpenChange={onDone} />}
    content={
      <LayoutContent>
        <VStack gap={4}>
          <Text color="secondary">
            Copy the key now: Davloom keeps only its hash and cannot show it again.
          </Text>
          <CopyField label="API key" value={secret} copyLabel="Copy key" />
          <MetadataList label={{ position: "top" }}>
            <MetadataListItem label="WebDAV address">
              <Text type="code">{webdavAddress()}</Text>
            </MetadataListItem>
            <MetadataListItem label="Username">Any name</MetadataListItem>
            <MetadataListItem label="Password">This key</MetadataListItem>
          </MetadataList>
        </VStack>
      </LayoutContent>
    }
    footer={
      <LayoutFooter>
        <HStack hAlign="end">
          <Button label="Done" variant="primary" onClick={onDone} />
        </HStack>
      </LayoutFooter>
    }
  />
);

const CreateKeyForm = ({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (name: string, secret: string) => void;
}) => {
  const create = useCreateKey();
  const [name, setName] = useState("");
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [expiry, setExpiry] = useState<string>("90");
  const [folders, setFolders] = useState("");
  const [problem, setProblem] = useState<string>();
  const [foldersProblem, setFoldersProblem] = useState<string>();

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setProblem("Name the key after the device or person that will use it.");
      return;
    }
    if (trimmed.length > 64) {
      setProblem("Use at most 64 characters.");
      return;
    }
    const reach = parseFolders(folders);
    if ("problem" in reach) {
      setFoldersProblem(reach.problem);
      return;
    }
    if (create.isPending) {
      return;
    }
    create.mutate(
      {
        name: trimmed,
        access: isReadOnly ? "read-only" : "read-write",
        expiresInDays: expiry === "never" ? null : Number(expiry),
        ...(reach.folders.length > 0 ? { paths: reach.folders } : {}),
      },
      { onSuccess: ({ key }) => onCreate(trimmed, key) },
    );
  };

  return (
    <Layout
      header={<DialogHeader title="Create a key" onOpenChange={onCancel} />}
      content={
        <LayoutContent>
          <VStack gap={4}>
            {create.isError ? (
              <Banner status="error" title={describeError(create.error)} container="card" />
            ) : null}
            <TextInput
              label="Name"
              value={name}
              onChange={(value) => {
                setName(value);
                setProblem(undefined);
              }}
              onEnter={submit}
              hasAutoFocus
              isRequired
              // Keys are named after devices and people, which spell check would mark as mistakes.
              hasSpellCheck={false}
              status={problem === undefined ? undefined : { type: "error", message: problem }}
            />
            <Switch label="Read only" value={isReadOnly} onChange={setIsReadOnly} />
            <Selector
              label="Expires"
              value={expiry}
              onChange={setExpiry}
              options={EXPIRY_OPTIONS.map((option) => ({ ...option }))}
            />
            <TextInput
              label="Folders"
              value={folders}
              onChange={(value) => {
                setFolders(value);
                setFoldersProblem(undefined);
              }}
              onEnter={submit}
              placeholder="/files/photos"
              hasSpellCheck={false}
              description="Optional. Limit the key to these folders, separated by commas; empty reaches every mount."
              status={
                foldersProblem === undefined
                  ? undefined
                  : { type: "error", message: foldersProblem }
              }
            />
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" variant="secondary" onClick={onCancel} />
            <Button
              label="Create key"
              variant="primary"
              isLoading={create.isPending}
              onClick={submit}
            />
          </HStack>
        </LayoutFooter>
      }
    />
  );
};

/** What the key dialog shows: the form, then the new key in its place. */
type KeyDialog = { step: "form" } | { step: "secret"; name: string; secret: string };

/** Credentials (PRD §8.3): the API keys WebDAV clients sign in with. */
export const CredentialsPage = () => {
  const apiKeys = useApiKeys();
  const revoke = useRevokeKey();
  const toast = useToast();
  const confirm = useImperativeAlertDialog();
  // Held in state rather than in an imperative dialog, so the key leaves the page with Done.
  const [keyDialog, setKeyDialog] = useState<KeyDialog>();
  const gutter = usePageGutter();
  const [tableRef, isNarrowTable] = useNarrowerThan(WIDE_TABLE);

  const finish = () => {
    if (keyDialog?.step === "secret") {
      toast({ body: `Created key “${keyDialog.name}”.` });
    }
    setKeyDialog(undefined);
    // The form's Name field focuses itself as the dialog opens, which Astryx Dialog then takes for
    // the opener, so focus is sent back to Create key here (shell/useFormDialog.tsx says more).
    refocusIfLost(() => buttonNamed("Create key"));
  };

  const openRevoke = (key: ApiKey, rows: readonly ApiKey[]) =>
    confirm.show({
      title: `Revoke “${key.name}”?`,
      description: "Clients signed in with it lose access, and this cannot be undone.",
      actionLabel: "Revoke",
      onAction: () => {
        confirm.hide();
        const index = rows.findIndex((row) => row.id === key.id);
        const rest = rows.filter((row) => row.id !== key.id);
        const next = rest[Math.min(index, rest.length - 1)];
        revoke.mutate(key.id, {
          onSuccess: () => {
            toast({ body: `Revoked “${key.name}”.` });
            // The key leaves the list with its menu, so focus moves to the key that took its
            // place, or to Create key.
            refocusIfLost(() =>
              next === undefined
                ? buttonNamed("Create key")
                : (buttonLabelled(`Actions for key ${next.name}`) ??
                  buttonLabelled(`Details for key ${next.name}`)),
            );
          },
          onError: (error) => toast({ type: "error", body: describeError(error) }),
        });
      },
    });

  const keyMenu = (key: ApiKey, rows: readonly ApiKey[]) => (
    <MoreMenu
      label={`Actions for key ${key.name}`}
      size="sm"
      alignment="end"
      items={[{ label: "Revoke", variant: "destructive", onClick: () => openRevoke(key, rows) }]}
    />
  );

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={gutter}>
          <VStack gap={6}>
            <PageHeader
              title="Credentials"
              actions={
                <TitleAction
                  label="Create key"
                  variant="primary"
                  icon={<Icon icon={Plus} size="sm" />}
                  onClick={() => setKeyDialog({ step: "form" })}
                />
              }
            />
            <VStack ref={tableRef}>
              <QueryState query={apiKeys} title="Cannot read the keys">
                {(data) => {
                  const rows = data.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
                  if (rows.length === 0) {
                    return (
                      <EmptyState
                        title="No keys yet"
                        description="A WebDAV client signs in with a key as its password."
                        actions={
                          <Button
                            label="Create a key"
                            variant="primary"
                            onClick={() => setKeyDialog({ step: "form" })}
                          />
                        }
                      />
                    );
                  }
                  return isNarrowTable ? (
                    // Where a column per detail has no room, as on a phone, each key is a row with
                    // its name, first characters and status. Opening the row shows the rest and
                    // Revoke.
                    <ExpandableList
                      records={rows.map((key) => ({
                        id: key.id,
                        title: key.name,
                        summary: <KeySummary apiKey={key} />,
                        details: (
                          <>
                            <KeyFacts apiKey={key} />
                            <Button
                              label="Revoke"
                              variant="destructive"
                              width="100%"
                              onClick={() => openRevoke(key, rows)}
                            />
                          </>
                        ),
                        toggleLabel: `Details for key ${key.name}`,
                      }))}
                    />
                  ) : (
                    <Card padding={0} elevation="low">
                      <Table<KeyRow>
                        data={rows.map((key) => ({ ...key }))}
                        columns={[
                          ...WIDE_COLUMNS,
                          {
                            key: "actions",
                            header: <VisuallyHidden>Actions</VisuallyHidden>,
                            width: pixel(64),
                            align: "end",
                            renderCell: (key) => keyMenu(key, rows),
                          },
                        ]}
                        idKey="id"
                        textOverflow="truncate"
                        hasHover
                      />
                    </Card>
                  );
                }}
              </QueryState>
            </VStack>
          </VStack>
          <Dialog
            isOpen={keyDialog !== undefined}
            onOpenChange={(isOpen) => {
              if (!isOpen) {
                finish();
              }
            }}
            // The new key must be read and copied, so Escape and a click outside leave the dialog
            // open then. Done and the header's close button both close it.
            purpose={keyDialog?.step === "secret" ? "required" : "form"}
            // Astryx names a dialog after its DialogHeader only when the dialog opens, so the
            // second step's dialog would keep no name: it is named here for both steps.
            aria-label={
              keyDialog?.step === "secret" ? `Key “${keyDialog.name}” is ready` : "Create a key"
            }
            width={520}
          >
            {keyDialog?.step === "form" ? (
              <CreateKeyForm
                onCancel={finish}
                onCreate={(name, secret) => setKeyDialog({ step: "secret", name, secret })}
              />
            ) : keyDialog?.step === "secret" ? (
              <ShowOnce name={keyDialog.name} secret={keyDialog.secret} onDone={finish} />
            ) : null}
          </Dialog>
          {confirm.element}
        </LayoutContent>
      }
    />
  );
};
