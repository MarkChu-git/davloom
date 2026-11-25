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
import {
  useApiKeys,
  useCreateKey,
  useMounts,
  useRenameKey,
  useRevokeKey,
  type ApiKey,
} from "../api/queries";
import { NameForm } from "../files/dialogs";
import { useT } from "../i18n/I18nProvider";
import type { Translator } from "../i18n/translate";
import { CopyField } from "../shell/CopyField";
import { ExpandableList } from "../shell/ExpandableList";
import { buttonLabelled, buttonNamed, refocusIfLost } from "../shell/focus";
import { AfterFirstPaint } from "../shell/AfterFirstPaint";
import { PageHeader } from "../shell/PageHeader";
import { usePageGutter } from "../shell/pageWidth";
import { QueryState } from "../shell/QueryState";
import { StatusLabel, type Tone } from "../shell/StatusLabel";
import { TitleAction } from "../shell/TitleRow";
import { nextFormKey, useFormDialog } from "../shell/useFormDialog";
import { useNarrowerThan } from "../shell/useNarrowerThan";
import { ALL_MOUNTS, hasExpired, keyStateOf, reachOf, scopeOf, type KeyState } from "./keyState";

// Rows keep the API's fields; the table wants records.
type KeyRow = ApiKey & Record<string, unknown>;

const expiryOptions = (t: Translator) => [
  { value: "30", label: t("keys.expiry.days", { count: 30 }) },
  { value: "90", label: t("keys.expiry.days", { count: 90 }) },
  { value: "365", label: t("keys.expiry.year") },
  { value: "never", label: t("keys.never") },
];

const keyStates = (t: Translator): Record<KeyState, { tone: Tone; label: string }> => ({
  active: { tone: "success", label: t("keys.state.active") },
  expired: { tone: "warning", label: t("keys.state.expired") },
  disabled: { tone: "error", label: t("keys.state.off") },
});

const accessOf = (t: Translator, key: ApiKey): string =>
  key.access === "read-only" ? t("keys.readOnly") : t("keys.readWrite");

const lastUsedOf = (t: Translator, key: ApiKey): string =>
  key.lastUsedAt === null ? t("keys.never") : t.relative(key.lastUsedAt);

const expiresOf = (t: Translator, key: ApiKey): string =>
  key.expiresAt === null ? t("keys.never") : t.date(key.expiresAt);

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

const KeyStatus = ({ apiKey }: { apiKey: ApiKey }) => {
  const t = useT();
  return <StatusLabel {...keyStates(t)[keyStateOf(apiKey, useNow())]} />;
};

/** The narrowest table, in rem, that has room for a column per detail. */
const WIDE_TABLE = 58;

const wideColumns = (t: Translator): TableColumn<KeyRow>[] => [
  {
    key: "name",
    header: t("field.name"),
    width: proportional(2, { minWidth: 180 }),
    renderCell: (key) => <KeyName apiKey={key} />,
  },
  {
    key: "access",
    header: t("keys.access"),
    width: pixel(136),
    renderCell: (key) => accessOf(t, key),
  },
  {
    key: "paths",
    header: t("keys.scope"),
    width: proportional(2, { minWidth: 160 }),
    renderCell: (key) => <Text maxLines={1}>{reachOf(t, key.paths)}</Text>,
  },
  {
    key: "lastUsedAt",
    header: t("keys.lastUsed"),
    width: pixel(120),
    renderCell: (key) => <Text color="secondary">{lastUsedOf(t, key)}</Text>,
  },
  {
    key: "expiresAt",
    header: t("keys.expires"),
    width: pixel(120),
    renderCell: (key) => <Text color="secondary">{expiresOf(t, key)}</Text>,
  },
  {
    key: "state",
    header: t("keys.status"),
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
  const t = useT();
  const now = useNow();
  return (
    <MetadataList>
      <MetadataListItem label={t("keys.access")}>{accessOf(t, apiKey)}</MetadataListItem>
      <MetadataListItem label={t("keys.scope")}>{reachOf(t, apiKey.paths)}</MetadataListItem>
      <MetadataListItem label={t("keys.lastUsed")}>{lastUsedOf(t, apiKey)}</MetadataListItem>
      <MetadataListItem label={t("keys.created")}>{t.date(apiKey.createdAt)}</MetadataListItem>
      <MetadataListItem
        label={hasExpired(apiKey, now) ? t("keys.state.expired") : t("keys.expires")}
      >
        {expiresOf(t, apiKey)}
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
}) => {
  const t = useT();
  return (
    <Layout
      header={<DialogHeader title={t("keys.ready", { name })} onOpenChange={onDone} />}
      content={
        <LayoutContent>
          <VStack gap={4}>
            <Text color="secondary">{t("keys.copyNow")}</Text>
            <CopyField label={t("keys.apiKey")} value={secret} copyLabel={t("keys.copyKey")} />
            <MetadataList label={{ position: "top" }}>
              <MetadataListItem label={t("overview.webdavAddress")}>
                <Text type="code">{webdavAddress()}</Text>
              </MetadataListItem>
              <MetadataListItem label={t("field.username")}>{t("keys.anyName")}</MetadataListItem>
              <MetadataListItem label={t("field.password")}>{t("keys.thisKey")}</MetadataListItem>
            </MetadataList>
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack hAlign="end">
            <Button label={t("keys.done")} variant="primary" onClick={onDone} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
};

const CreateKeyForm = ({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (name: string, secret: string) => void;
}) => {
  const t = useT();
  const create = useCreateKey();
  const mounts = useMounts();
  const [name, setName] = useState("");
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [expiry, setExpiry] = useState<string>("90");
  const [mount, setMount] = useState(ALL_MOUNTS);
  const [folder, setFolder] = useState("");
  const [problem, setProblem] = useState<string>();
  const [folderProblem, setFolderProblem] = useState<string>();

  const submit = () => {
    const trimmed = name.trim();
    const nameIssue = keyNameProblem(t, name);
    if (nameIssue !== undefined) {
      setProblem(nameIssue);
      return;
    }
    const scope = scopeOf(t, mount, folder);
    if ("problem" in scope) {
      setFolderProblem(scope.problem);
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
        ...(scope.paths === null ? {} : { paths: scope.paths }),
      },
      { onSuccess: ({ key }) => onCreate(trimmed, key) },
    );
  };

  return (
    <Layout
      header={<DialogHeader title={t("keys.createTitle")} onOpenChange={onCancel} />}
      content={
        <LayoutContent>
          <VStack gap={4}>
            {create.isError ? (
              <Banner status="error" title={describeError(t, create.error)} container="card" />
            ) : null}
            <TextInput
              label={t("field.name")}
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
              label={t("keys.mount")}
              value={mount}
              onChange={(value) => {
                setMount(value);
                setFolderProblem(undefined);
              }}
              options={[
                { value: ALL_MOUNTS, label: t("keys.allMounts") },
                ...(mounts.data ?? []).map((item) => ({
                  value: item.name,
                  label: `/${item.name}`,
                })),
              ]}
            />
            <TextInput
              label={t("keys.folder")}
              value={folder}
              onChange={(value) => {
                setFolder(value);
                setFolderProblem(undefined);
              }}
              onEnter={submit}
              isOptional
              isDisabled={mount === ALL_MOUNTS}
              placeholder="photos/2026"
              autoCapitalize="none"
              hasAutoCorrect={false}
              hasSpellCheck={false}
              // The field is off while the key covers every mount, and then shows no error.
              status={
                folderProblem === undefined || mount === ALL_MOUNTS
                  ? undefined
                  : { type: "error", message: folderProblem }
              }
            />
            <Switch label={t("keys.readOnly")} value={isReadOnly} onChange={setIsReadOnly} />
            <Selector
              label={t("keys.expires")}
              value={expiry}
              onChange={setExpiry}
              options={expiryOptions(t)}
            />
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={2} hAlign="end">
            <Button label={t("action.cancel")} variant="secondary" onClick={onCancel} />
            <Button
              label={t("keys.create")}
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

/** Why a name cannot name a key, as the server checks it; undefined when it can. */
const keyNameProblem = (t: Translator, name: string): string | undefined =>
  name.trim() === ""
    ? t("keys.nameMissing")
    : name.trim().length > 64
      ? t("form.atMost", { count: 64 })
      : undefined;

/** What the key dialog shows: the form, then the new key in its place. */
type KeyDialog = { step: "form" } | { step: "secret"; name: string; secret: string };

/** Credentials (PRD §8.3): the API keys WebDAV clients sign in with. */
export const CredentialsPage = () => {
  const t = useT();
  const apiKeys = useApiKeys();
  const revoke = useRevokeKey();
  const rename = useRenameKey();
  const nameDialog = useFormDialog(440);
  const toast = useToast();
  const confirm = useImperativeAlertDialog();
  // Held in state rather than in an imperative dialog, so the key leaves the page with Done.
  const [keyDialog, setKeyDialog] = useState<KeyDialog>();
  const gutter = usePageGutter();
  const [tableRef, isNarrowTable] = useNarrowerThan(WIDE_TABLE);

  const finish = () => {
    if (keyDialog?.step === "secret") {
      toast({ body: t("keys.created.toast", { name: keyDialog.name }) });
    }
    setKeyDialog(undefined);
    // The form's Name field focuses itself as the dialog opens, which Astryx Dialog then takes for
    // the opener, so focus is sent back to Create key here (shell/useFormDialog.tsx says more).
    refocusIfLost(() => buttonNamed(t("keys.create")));
  };

  const openRevoke = (key: ApiKey, rows: readonly ApiKey[]) =>
    confirm.show({
      title: t("keys.revokeTitle", { name: key.name }),
      description: t("keys.revokeDescription"),
      actionLabel: t("keys.revoke"),
      onAction: () => {
        confirm.hide();
        const index = rows.findIndex((row) => row.id === key.id);
        const rest = rows.filter((row) => row.id !== key.id);
        const next = rest[Math.min(index, rest.length - 1)];
        revoke.mutate(key.id, {
          onSuccess: () => {
            toast({ body: t("keys.revoked", { name: key.name }) });
            // The key leaves the list with its menu, so focus moves to the key that took its
            // place, or to Create key.
            refocusIfLost(() =>
              next === undefined
                ? buttonNamed(t("keys.create"))
                : (buttonLabelled(t("keys.actionsFor", { name: next.name })) ??
                  buttonLabelled(t("keys.detailsFor", { name: next.name }))),
            );
          },
          onError: (error) => toast({ type: "error", body: describeError(t, error) }),
        });
      },
    });

  const openRename = (key: ApiKey) =>
    nameDialog.show(
      <NameForm
        key={nextFormKey()}
        title={t("files.renameTitle", { name: key.name })}
        submitLabel={t("action.rename")}
        initialName={key.name}
        onCancel={() => nameDialog.hide()}
        onSubmit={async (name) => {
          const problem = keyNameProblem(t, name);
          if (problem !== undefined) {
            return problem;
          }
          const to = name.trim();
          if (to !== key.name) {
            try {
              await rename.mutateAsync({ id: key.id, name: to });
            } catch (error) {
              return describeError(t, error);
            }
            toast({ body: t("files.renamed", { name: to }) });
          }
          // The menu or the details that opened the dialog now carry the new name.
          nameDialog.hide(
            () =>
              buttonLabelled(t("keys.actionsFor", { name: to })) ??
              buttonLabelled(t("keys.detailsFor", { name: to })),
          );
          return undefined;
        }}
      />,
      t("files.renameTitle", { name: key.name }),
    );

  const keyMenu = (key: ApiKey, rows: readonly ApiKey[]) => (
    <MoreMenu
      label={t("keys.actionsFor", { name: key.name })}
      size="sm"
      alignment="end"
      items={[
        { label: t("action.rename"), onClick: () => openRename(key) },
        { type: "divider" },
        {
          label: t("keys.revoke"),
          variant: "destructive",
          onClick: () => openRevoke(key, rows),
        },
      ]}
    />
  );

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={gutter}>
          <VStack gap={6}>
            <PageHeader
              title={t("nav.credentials")}
              actions={
                <TitleAction
                  label={t("keys.create")}
                  variant="primary"
                  icon={<Icon icon={Plus} size="sm" />}
                  onClick={() => setKeyDialog({ step: "form" })}
                />
              }
            />
            {/* Built once the page's header is on screen, in a render of its own. */}
            <AfterFirstPaint>
              <VStack ref={tableRef}>
                <QueryState query={apiKeys} title={t("keys.cannotRead")}>
                  {(data) => {
                    const rows = data.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
                    if (rows.length === 0) {
                      return (
                        <EmptyState
                          title={t("keys.none")}
                          headingLevel={2}
                          actions={
                            <Button
                              label={t("keys.createTitle")}
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
                                label={t("action.rename")}
                                variant="secondary"
                                width="100%"
                                onClick={() => openRename(key)}
                              />
                              <Button
                                label={t("keys.revoke")}
                                variant="destructive"
                                width="100%"
                                onClick={() => openRevoke(key, rows)}
                              />
                            </>
                          ),
                          toggleLabel: t("keys.detailsFor", { name: key.name }),
                        }))}
                      />
                    ) : (
                      <Card padding={0} elevation="low">
                        <Table<KeyRow>
                          data={rows.map((key) => ({ ...key }))}
                          columns={[
                            ...wideColumns(t),
                            {
                              key: "actions",
                              header: <VisuallyHidden>{t("files.actions")}</VisuallyHidden>,
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
            </AfterFirstPaint>
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
              keyDialog?.step === "secret"
                ? t("keys.ready", { name: keyDialog.name })
                : t("keys.createTitle")
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
          {nameDialog.element}
          {confirm.element}
        </LayoutContent>
      }
    />
  );
};
