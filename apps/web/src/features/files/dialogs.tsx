import { Button } from "@astryxdesign/core/Button";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { Banner } from "@astryxdesign/core/Banner";
import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ChevronRight, Folder } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { davProblem, type Transfer } from "../api/dav";
import { keys } from "../api/queries";
import { useT } from "../i18n/I18nProvider";
import type { Translator } from "../i18n/translate";
import { isWithin, joinPath, splitPath } from "./paths";

const DialogFrame = ({
  title,
  submitLabel,
  isSaving,
  onCancel,
  onSubmit,
  children,
}: {
  title: string;
  submitLabel: string;
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) => {
  const t = useT();
  return (
    <Layout
      header={<DialogHeader title={title} onOpenChange={onCancel} />}
      content={<LayoutContent>{children}</LayoutContent>}
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

/** Makes a change and answers why it refused, if it did. */
type Submit<T> = (value: T) => Promise<string | undefined>;

/** Runs a submit once at a time, and keeps the reason it refused. */
const useSubmit = <T,>(onSubmit: Submit<T>) => {
  const [problem, setProblem] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const submit = (value: T) => {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    void onSubmit(value).then((next) => {
      setProblem(next);
      setIsSaving(false);
    });
  };
  return { problem, setProblem, isSaving, submit };
};

/**
 * Names a new folder or renames an item. `onSubmit` makes the change and answers why it refused,
 * if it did; that reason appears only after a submit.
 */
export const NameForm = ({
  title,
  submitLabel,
  initialName = "",
  onCancel,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initialName?: string;
  onCancel: () => void;
  onSubmit: Submit<string>;
}) => {
  const t = useT();
  const [name, setName] = useState(initialName);
  const { problem, setProblem, isSaving, submit } = useSubmit(onSubmit);

  return (
    <DialogFrame
      title={title}
      submitLabel={submitLabel}
      isSaving={isSaving}
      onCancel={onCancel}
      onSubmit={() => submit(name)}
    >
      <TextInput
        label={t("field.name")}
        value={name}
        onChange={(value) => {
          setName(value);
          setProblem(undefined);
        }}
        onEnter={() => submit(name)}
        hasAutoFocus
        isRequired
        autoCapitalize="none"
        hasAutoCorrect={false}
        hasSpellCheck={false}
        status={problem === undefined ? undefined : { type: "error", message: problem }}
      />
    </DialogFrame>
  );
};

/** The title of the form that moves or copies `names`, such as Move “report.pdf”. */
export const transferTitle = (
  t: Translator,
  transfer: Transfer,
  names: readonly string[],
): string => {
  const what =
    names.length === 1
      ? t("files.quoted", { name: names[0] ?? "" })
      : t("count.items", { count: names.length });
  return t(transfer === "move" ? "transfer.moveTitle" : "transfer.copyTitle", { what });
};

/** The folders inside a folder of the namespace, by name. */
export type ListFolders = (parts: readonly string[]) => Promise<string[]>;

/**
 * Moves or copies items to another folder, picked by browsing from the folder they are in: the
 * path to the folder shown leads back up, and each folder inside it leads down. A folder being
 * moved or copied, and everything inside it, cannot be opened as a destination.
 */
export const TransferForm = ({
  transfer,
  names,
  from,
  mounts,
  listFolders,
  onCancel,
  onSubmit,
}: {
  transfer: Transfer;
  names: readonly string[];
  /** The folder the items are in, such as /files/Drafts. */
  from: string;
  /** The mounts that can take them. */
  mounts: readonly string[];
  listFolders: ListFolders;
  onCancel: () => void;
  onSubmit: Submit<string>;
}) => {
  const t = useT();
  const collator = new Intl.Collator(t.locale, { numeric: true, sensitivity: "base" });
  const [at, setAt] = useState<readonly string[]>(() => splitPath(from));
  const { problem, setProblem, isSaving, submit } = useSubmit(onSubmit);
  const here = joinPath(at);
  const sources = names.map((name) => joinPath([...splitPath(from), name]));

  const listed = useQuery({
    queryKey: [...keys.dav, "folders", here],
    queryFn: () => listFolders(at),
    enabled: at.length > 0,
    retry: false,
  });
  // The top lists the mounts that can take the items; below it, the folders the server lists.
  const shown =
    at.length === 0
      ? { state: "ready" as const, names: mounts }
      : listed.data !== undefined
        ? { state: "ready" as const, names: listed.data }
        : listed.isError
          ? { state: "error" as const, problem: davProblem(t, listed.error, here) }
          : { state: "loading" as const };

  const go = (parts: readonly string[]) => {
    setAt(parts);
    setProblem(undefined);
  };

  return (
    <DialogFrame
      title={transferTitle(t, transfer, names)}
      submitLabel={t(transfer === "move" ? "transfer.moveHere" : "transfer.copyHere")}
      isSaving={isSaving}
      onCancel={onCancel}
      onSubmit={() => submit(here)}
    >
      <VStack gap={3}>
        <Breadcrumbs label={t("transfer.destination")}>
          <BreadcrumbItem onClick={() => go([])} isCurrent={at.length === 0}>
            {t("nav.files")}
          </BreadcrumbItem>
          {at.map((part, index) => (
            <BreadcrumbItem
              key={joinPath(at.slice(0, index + 1))}
              onClick={() => go(at.slice(0, index + 1))}
              isCurrent={index === at.length - 1}
            >
              {part}
            </BreadcrumbItem>
          ))}
        </Breadcrumbs>
        {problem === undefined ? null : <Banner status="error" title={problem} container="card" />}
        {shown.state === "loading" ? (
          <Skeleton width="100%" height={88} />
        ) : shown.state === "error" ? (
          <Banner status="error" title={shown.problem} container="card" />
        ) : shown.names.length === 0 ? (
          <Text color="secondary">{t("transfer.noFolders")}</Text>
        ) : (
          <List density="compact">
            {shown.names
              .toSorted((a, b) => collator.compare(a, b))
              .map((name) => {
                const path = joinPath([...at, name]);
                return (
                  <ListItem
                    key={name}
                    label={name}
                    startContent={<Icon icon={Folder} size="sm" />}
                    endContent={<Icon icon={ChevronRight} size="sm" color="secondary" />}
                    isDisabled={sources.some((source) => isWithin(path, source))}
                    onClick={() => go([...at, name])}
                  />
                );
              })}
          </List>
        )}
      </VStack>
    </DialogFrame>
  );
};
