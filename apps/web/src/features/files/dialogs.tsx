import { Button } from "@astryxdesign/core/Button";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { HStack, Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useState, type ReactNode } from "react";
import type { Transfer } from "../api/dav";

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
}) => (
  <Layout
    header={<DialogHeader title={title} onOpenChange={onCancel} />}
    content={<LayoutContent>{children}</LayoutContent>}
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
        label="Name"
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

/** Moves or copies items to another folder, named by its path. */
export const TransferForm = ({
  transfer,
  names,
  initialDestination,
  onCancel,
  onSubmit,
}: {
  transfer: Transfer;
  names: readonly string[];
  initialDestination: string;
  onCancel: () => void;
  onSubmit: Submit<string>;
}) => {
  const [destination, setDestination] = useState(initialDestination);
  const { problem, setProblem, isSaving, submit } = useSubmit(onSubmit);
  const what = names.length === 1 ? `“${names[0]}”` : `${names.length} items`;
  const verb = transfer === "move" ? "Move" : "Copy";

  return (
    <DialogFrame
      title={`${verb} ${what}`}
      submitLabel={verb}
      isSaving={isSaving}
      onCancel={onCancel}
      onSubmit={() => submit(destination)}
    >
      <TextInput
        label="Destination folder"
        description="A folder's path, starting with its mount, such as /files/Archive."
        value={destination}
        onChange={(value) => {
          setDestination(value);
          setProblem(undefined);
        }}
        onEnter={() => submit(destination)}
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
