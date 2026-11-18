import { Button } from "@astryxdesign/core/Button";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { HStack, Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { Selector } from "@astryxdesign/core/Selector";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useState, type ReactNode } from "react";
import type { Transfer } from "./tree";

const DialogFrame = ({
  title,
  submitLabel,
  onCancel,
  onSubmit,
  children,
}: {
  title: string;
  submitLabel: string;
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
          <Button label={submitLabel} variant="primary" onClick={onSubmit} />
        </HStack>
      </LayoutFooter>
    }
  />
);

/**
 * Names a new folder or renames an item. `onSubmit` makes the change against the folder as it is
 * then and returns why it refused, if it did; that reason appears only after a submit.
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
  onSubmit: (name: string) => string | undefined;
}) => {
  const [name, setName] = useState(initialName);
  const [problem, setProblem] = useState<string>();
  const submit = () => setProblem(onSubmit(name));

  return (
    <DialogFrame title={title} submitLabel={submitLabel} onCancel={onCancel} onSubmit={submit}>
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
        autoCapitalize="none"
        hasAutoCorrect={false}
        hasSpellCheck={false}
        status={problem === undefined ? undefined : { type: "error", message: problem }}
      />
    </DialogFrame>
  );
};

/** Moves or copies items to another folder. `onSubmit` returns why it refused, if it did. */
export const TransferForm = ({
  transfer,
  names,
  destinations,
  onCancel,
  onSubmit,
}: {
  transfer: Transfer;
  names: readonly string[];
  destinations: readonly string[];
  onCancel: () => void;
  onSubmit: (destination: string) => string | undefined;
}) => {
  const [destination, setDestination] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const what = names.length === 1 ? `“${names[0]}”` : `${names.length} items`;
  const verb = transfer === "move" ? "Move" : "Copy";

  const submit = () =>
    setProblem(destination === undefined ? "Choose a folder." : onSubmit(destination));

  return (
    <DialogFrame title={`${verb} ${what}`} submitLabel={verb} onCancel={onCancel} onSubmit={submit}>
      <Selector
        label="Destination"
        options={destinations.map((path) => ({ value: path, label: path }))}
        value={destination}
        onChange={(value) => {
          setDestination(value);
          setProblem(undefined);
        }}
        hasSearch
        placeholder="Choose a folder"
        emptyText="No other folders"
        status={problem === undefined ? undefined : { type: "error", message: problem }}
      />
    </DialogFrame>
  );
};
