import { useImperativeAlertDialog } from "@astryxdesign/core/AlertDialog";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
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
import { Store, useStore } from "@tanstack/react-store";
import { Plus } from "lucide-react";
import { useState } from "react";
import { credentials, SAMPLE_NOW, type Credential } from "../sample-data/data";
import { formatDate, formatRelative } from "../sample-data/format";
import { sampleId } from "../sample-data/id";
import { CopyField } from "../shell/CopyField";
import { ExpandableList } from "../shell/ExpandableList";
import { buttonLabelled, buttonNamed, refocusIfLost } from "../shell/focus";
import { PageHeader } from "../shell/PageHeader";
import { usePageGutter } from "../shell/pageWidth";
import { StatusLabel, type Tone } from "../shell/StatusLabel";
import { TitleAction } from "../shell/TitleRow";
import { useNarrowerThan } from "../shell/useNarrowerThan";
import { useMounts } from "../storage/mountStore";
import { hasExpired, keyStateOf, type KeyState } from "./keyState";
import { scopeOf, type Scope } from "./scope";

const credentialStore = new Store<Credential[]>(credentials);

const EXPIRY_OPTIONS = [
  { value: "30", label: "In 30 days" },
  { value: "90", label: "In 90 days" },
  { value: "365", label: "In a year" },
  { value: "never", label: "Never" },
] as const;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A sample secret. The real one comes from the server, which keeps only its hash. */
const sampleSecret = (): string =>
  `dvl_${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => BASE32[byte % 32]).join("")}`;

const KEY_STATES: Record<KeyState, { tone: Tone; label: string }> = {
  active: { tone: "success", label: "Active" },
  expired: { tone: "warning", label: "Expired" },
  revoked: { tone: "error", label: "Revoked" },
};

const accessOf = (credential: Credential): string =>
  credential.permission === "read-only" ? "Read only" : "Read and write";

const lastUsedOf = (credential: Credential): string =>
  credential.lastUsedAt === null ? "Never" : formatRelative(credential.lastUsedAt);

const expiresOf = (credential: Credential): string =>
  credential.expiresAt === null ? "Never" : formatDate(credential.expiresAt);

const KeyName = ({ credential }: { credential: Credential }) => (
  <VStack gap={0.5}>
    <Text weight="semibold" maxLines={1}>
      {credential.name}
    </Text>
    <Text type="code" color="secondary">{`${credential.prefix}…`}</Text>
  </VStack>
);

const KeyStatus = ({ credential }: { credential: Credential }) => (
  <StatusLabel {...KEY_STATES[keyStateOf(credential, SAMPLE_NOW)]} />
);

/** The narrowest table, in rem, that has room for a column per detail. */
const WIDE_TABLE = 58;

const WIDE_COLUMNS: TableColumn<Credential>[] = [
  {
    key: "name",
    header: "Name",
    width: proportional(2, { minWidth: 180 }),
    renderCell: (credential) => <KeyName credential={credential} />,
  },
  { key: "permission", header: "Access", width: pixel(136), renderCell: accessOf },
  {
    key: "scope",
    header: "Scope",
    width: proportional(2, { minWidth: 160 }),
    renderCell: (credential) => <Text maxLines={1}>{credential.scope}</Text>,
  },
  {
    key: "lastUsedAt",
    header: "Last used",
    width: pixel(120),
    renderCell: (credential) => <Text color="secondary">{lastUsedOf(credential)}</Text>,
  },
  {
    key: "expiresAt",
    header: "Expires",
    width: pixel(120),
    renderCell: (credential) => <Text color="secondary">{expiresOf(credential)}</Text>,
  },
  {
    key: "state",
    header: "Status",
    width: pixel(120),
    renderCell: (credential) => <KeyStatus credential={credential} />,
  },
];

/** A key's first characters, with its status at the end of the line. */
const KeySummary = ({ credential }: { credential: Credential }) => (
  <HStack gap={3} vAlign="center">
    <StackItem size="fill">
      <Text type="code" color="secondary" maxLines={1}>
        {`${credential.prefix}…`}
      </Text>
    </StackItem>
    <KeyStatus credential={credential} />
  </HStack>
);

/** What a key's row shows once opened: the details the table has columns for. */
const KeyFacts = ({ credential }: { credential: Credential }) => (
  <MetadataList>
    <MetadataListItem label="Access">{accessOf(credential)}</MetadataListItem>
    <MetadataListItem label="Scope">{credential.scope}</MetadataListItem>
    <MetadataListItem label="Last used">{lastUsedOf(credential)}</MetadataListItem>
    {/* Past its expiry time a key says it expired, whether or not it was revoked. */}
    <MetadataListItem label={hasExpired(credential, SAMPLE_NOW) ? "Expired" : "Expires"}>
      {expiresOf(credential)}
    </MetadataListItem>
  </MetadataList>
);

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
          <CopyField label="API key" value={secret} copyLabel="Copy key" />
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
  onCreate: (credential: Credential, secret: string) => void;
}) => {
  const mounts = useMounts();
  const [name, setName] = useState("");
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [mount, setMount] = useState("all");
  const [folder, setFolder] = useState("");
  const [expiry, setExpiry] = useState<string>("90");
  const [problem, setProblem] = useState<string>();
  const [folderProblem, setFolderProblem] = useState<string>();

  const submit = () => {
    const scope: Scope = mount === "all" ? { scope: "All mounts" } : scopeOf(`/${mount}`, folder);
    setProblem(
      name.trim() === "" ? "Name the key after the device or person that will use it." : undefined,
    );
    setFolderProblem(scope.problem);
    if (name.trim() === "" || scope.problem !== undefined) {
      return;
    }
    const secret = sampleSecret();
    const days = expiry === "never" ? undefined : Number(expiry);
    onCreate(
      {
        id: sampleId(),
        name: name.trim(),
        prefix: secret.slice(0, 8),
        permission: isReadOnly ? "read-only" : "read-write",
        scope: scope.scope,
        createdAt: SAMPLE_NOW.toISOString(),
        expiresAt:
          days === undefined
            ? null
            : new Date(SAMPLE_NOW.getTime() + days * 86_400_000).toISOString(),
        lastUsedAt: null,
        isRevoked: false,
      },
      secret,
    );
  };

  return (
    <Layout
      header={<DialogHeader title="Create a key" onOpenChange={onCancel} />}
      content={
        <LayoutContent>
          <VStack gap={4}>
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
            <Selector
              label="Mount"
              value={mount}
              onChange={setMount}
              options={[
                { value: "all", label: "All mounts" },
                ...mounts.map((item) => ({ value: item.id, label: item.path })),
              ]}
            />
            <TextInput
              label="Folder inside the mount"
              value={folder}
              onChange={(value) => {
                setFolder(value);
                setFolderProblem(undefined);
              }}
              onEnter={submit}
              isOptional
              isDisabled={mount === "all"}
              // The field is off while the key covers every mount, and then shows no error.
              status={
                folderProblem === undefined || mount === "all"
                  ? undefined
                  : { type: "error", message: folderProblem }
              }
              autoCapitalize="none"
              hasAutoCorrect={false}
              hasSpellCheck={false}
            />
            <Switch label="Read only" value={isReadOnly} onChange={setIsReadOnly} />
            <Selector
              label="Expires"
              value={expiry}
              onChange={setExpiry}
              options={EXPIRY_OPTIONS.map((option) => ({ ...option }))}
            />
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" variant="secondary" onClick={onCancel} />
            <Button label="Create key" variant="primary" onClick={submit} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
};

/** What the key dialog shows: the form, then the new key in its place. */
type KeyDialog = { step: "form" } | { step: "secret"; credential: Credential; secret: string };

/** Credentials (PRD §8.3): the API keys WebDAV clients sign in with. */
export const CredentialsPage = () => {
  const rows = useStore(credentialStore, (items) => items);
  const toast = useToast();
  const confirm = useImperativeAlertDialog();
  // Held in state rather than in an imperative dialog, so the key leaves the page with Done.
  const [keyDialog, setKeyDialog] = useState<KeyDialog>();
  const gutter = usePageGutter();
  const [tableRef, isNarrowTable] = useNarrowerThan(WIDE_TABLE);

  const showSecret = (credential: Credential, secret: string) => {
    credentialStore.setState((items) => [credential, ...items]);
    setKeyDialog({ step: "secret", credential, secret });
  };

  const finish = () => {
    if (keyDialog?.step === "secret") {
      toast({ body: `Created key “${keyDialog.credential.name}”.` });
    }
    setKeyDialog(undefined);
    // The form's Name field focuses itself as the dialog opens, which Astryx Dialog then takes for
    // the opener, so focus is sent back to Create key here (shell/useFormDialog.tsx says more).
    refocusIfLost(() => buttonNamed("Create key"));
  };

  const openRevoke = (credential: Credential) =>
    confirm.show({
      title: `Revoke “${credential.name}”?`,
      description: "Clients signed in with it lose access, and this cannot be undone.",
      actionLabel: "Revoke",
      onAction: () => {
        credentialStore.setState((items) =>
          items.map((item) => (item.id === credential.id ? { ...item, isRevoked: true } : item)),
        );
        confirm.hide();
        toast({ body: `Revoked “${credential.name}”.` });
        // On a phone, Revoke leaves the key's details with the key, so focus moves to its row.
        refocusIfLost(
          () =>
            buttonLabelled(`Actions for key ${credential.name}`) ??
            buttonLabelled(`Details for key ${credential.name}`),
        );
      },
    });

  const keyMenu = (credential: Credential) => (
    <MoreMenu
      label={`Actions for key ${credential.name}`}
      size="sm"
      alignment="end"
      items={[
        {
          label: "Revoke",
          variant: "destructive",
          isDisabled: credential.isRevoked,
          onClick: () => openRevoke(credential),
        },
      ]}
    />
  );
  const columns: TableColumn<Credential>[] = [
    ...WIDE_COLUMNS,
    {
      key: "actions",
      header: <VisuallyHidden>Actions</VisuallyHidden>,
      width: pixel(64),
      align: "end",
      renderCell: keyMenu,
    },
  ];

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
            {isNarrowTable ? (
              // Where a column per detail has no room, as on a phone, each key is a row with its
              // name, first characters and status. Opening the row shows the rest and Revoke.
              <ExpandableList
                ref={tableRef}
                records={rows.map((credential) => ({
                  id: credential.id,
                  title: credential.name,
                  summary: <KeySummary credential={credential} />,
                  // A revoked key has no action left, so its details end with its expiry.
                  details: (
                    <>
                      <KeyFacts credential={credential} />
                      {credential.isRevoked ? null : (
                        <Button
                          label="Revoke"
                          variant="destructive"
                          width="100%"
                          onClick={() => openRevoke(credential)}
                        />
                      )}
                    </>
                  ),
                  toggleLabel: `Details for key ${credential.name}`,
                }))}
              />
            ) : (
              <Card ref={tableRef} padding={0} elevation="low">
                <Table<Credential>
                  data={rows}
                  columns={columns}
                  idKey="id"
                  textOverflow="truncate"
                  hasHover
                />
              </Card>
            )}
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
            width={520}
          >
            {keyDialog?.step === "form" ? (
              <CreateKeyForm onCancel={finish} onCreate={showSecret} />
            ) : keyDialog?.step === "secret" ? (
              <ShowOnce
                name={keyDialog.credential.name}
                secret={keyDialog.secret}
                onDone={finish}
              />
            ) : null}
          </Dialog>
          {confirm.element}
        </LayoutContent>
      }
    />
  );
};
