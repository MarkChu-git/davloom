import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { FileInput } from "@astryxdesign/core/FileInput";
import { VStack } from "@astryxdesign/core/Layout";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { describeError, isApiError } from "../api/client";
import { completeSetup, importInstance, keys, setupQuery, signIn } from "../api/queries";
import { AuthFrame, Waiting } from "./AuthFrame";
import { GoTo } from "./GoTo";
import { MIN_PASSWORD, setupProblems, type SetupFields } from "./forms";

const setupFailure = (error: unknown): string => {
  if (!isApiError(error)) {
    return describeError(error);
  }
  switch (error.code) {
    case "setup_token_invalid":
      return "The setup token is wrong. It is the DAVLOOM_SETUP_TOKEN of this deployment.";
    case "setup_closed":
      return "Setup is already complete. Sign in instead.";
    case "invalid_input":
      return "The server refused one of the values. Check them and try again.";
    default:
      return describeError(error);
  }
};

/** The largest export file the Dashboard reads. */
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;

/**
 * Setup from an export of another instance: its administrator, keys, backends and mounts. The
 * administrator then signs in with the password they had there.
 */
const ImportForm = () => {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState("");
  const [token, setToken] = useState("");
  const [problems, setProblems] = useState<{ file?: string; key?: string; token?: string }>({});
  const [failure, setFailure] = useState<string>();
  const [isImporting, setIsImporting] = useState(false);

  const submit = async () => {
    const next = {
      file: file === null ? "Choose the export file." : undefined,
      key: key.trim() === "" ? "Enter the key shown with the export." : undefined,
      token: token.trim() === "" ? "Enter the setup token." : undefined,
    };
    setProblems(next);
    setFailure(undefined);
    if (file === null || Object.values(next).some((problem) => problem !== undefined)) return;
    setIsImporting(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        setFailure("That file is not a Davloom export.");
        setIsImporting(false);
        return;
      }
      await importInstance({ token: token.trim(), key: key.trim(), file: parsed });
      await client.invalidateQueries({ queryKey: keys.setup });
      await navigate({ to: "/sign-in", replace: true });
    } catch (error) {
      setFailure(setupFailure(error));
      setIsImporting(false);
    }
  };

  return (
    <>
      {failure === undefined ? null : <Banner status="error" title={failure} container="card" />}
      <VStack gap={4}>
        <FileInput
          label="Export file"
          value={file}
          onChange={(next) => {
            setFile(Array.isArray(next) ? (next[0] ?? null) : next);
            setProblems((current) => ({ ...current, file: undefined }));
          }}
          accept=".json,application/json"
          maxSize={MAX_EXPORT_BYTES}
          status={
            problems.file === undefined ? undefined : { type: "error", message: problems.file }
          }
        />
        <TextInput
          label="Export key"
          type="password"
          description="The key Davloom showed when it made the export."
          value={key}
          onChange={(value) => {
            setKey(value);
            setProblems((current) => ({ ...current, key: undefined }));
          }}
          onEnter={() => void submit()}
          autoComplete="off"
          status={problems.key === undefined ? undefined : { type: "error", message: problems.key }}
        />
        <TextInput
          label="Setup token"
          type="password"
          description="The DAVLOOM_SETUP_TOKEN this instance was deployed with."
          value={token}
          onChange={(value) => {
            setToken(value);
            setProblems((current) => ({ ...current, token: undefined }));
          }}
          onEnter={() => void submit()}
          autoComplete="off"
          status={
            problems.token === undefined ? undefined : { type: "error", message: problems.token }
          }
        />
      </VStack>
      <Button
        label="Import"
        variant="primary"
        isLoading={isImporting}
        onClick={() => void submit()}
      />
      <Text type="supporting" color="secondary">
        The import adds everything or nothing. Then sign in with the password from the old instance.
      </Text>
    </>
  );
};

/**
 * First-run setup: creates the administrator, the default Durable Objects backend and the
 * Mount "files", then signs in. It takes the setup token, so that only whoever deployed the
 * instance can claim it.
 */
export const SetupPage = () => {
  const client = useQueryClient();
  const navigate = useNavigate();
  const setup = useQuery(setupQuery);
  const [fields, setFields] = useState<SetupFields>({
    name: "",
    email: "",
    password: "",
    token: "",
  });
  const [problems, setProblems] = useState<Partial<Record<keyof SetupFields, string>>>({});
  const [failure, setFailure] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const [mode, setMode] = useState<"new" | "import">("new");

  if (setup.isPending) {
    return <Waiting label="Checking this instance" />;
  }
  if (setup.data?.needed === false) {
    return <GoTo href="/sign-in" />;
  }
  if (setup.isError || !(setup.data?.open ?? false)) {
    return (
      <AuthFrame title="Set up Davloom">
        <Banner
          status="warning"
          title={setup.isError ? describeError(setup.error) : "Setup is closed"}
          description={
            setup.isError
              ? undefined
              : "Set DAVLOOM_SETUP_TOKEN on this deployment, then reload this page."
          }
          container="card"
        />
        <Button label="Try again" variant="secondary" onClick={() => void setup.refetch()} />
      </AuthFrame>
    );
  }

  const submit = async () => {
    const next = setupProblems(fields);
    setProblems(next);
    setFailure(undefined);
    if (Object.keys(next).length > 0) {
      return;
    }
    setIsSaving(true);
    try {
      await completeSetup({
        name: fields.name.trim(),
        email: fields.email.trim(),
        password: fields.password,
        token: fields.token.trim(),
      });
      await signIn(fields.email.trim(), fields.password);
      await client.invalidateQueries({ queryKey: keys.setup });
      await client.invalidateQueries({ queryKey: keys.me });
      await navigate({ to: "/", replace: true });
    } catch (error) {
      setFailure(setupFailure(error));
      setIsSaving(false);
    }
  };

  const field = (name: keyof SetupFields) => ({
    value: fields[name],
    onChange: (value: string) => {
      setFields((current) => ({ ...current, [name]: value }));
      setProblems((current) => ({ ...current, [name]: undefined }));
    },
    onEnter: () => void submit(),
    status:
      problems[name] === undefined
        ? undefined
        : ({ type: "error", message: problems[name] } as const),
  });

  const modes = (
    <SegmentedControl
      label="How to set up"
      value={mode}
      onChange={(next) => setMode(next === "import" ? "import" : "new")}
      layout="fill"
    >
      <SegmentedControlItem value="new" label="New instance" />
      <SegmentedControlItem value="import" label="From an export" />
    </SegmentedControl>
  );

  if (mode === "import") {
    return (
      <AuthFrame
        title="Set up Davloom"
        description="Bring the administrator, keys, backends and mounts from an export of another instance."
      >
        {modes}
        <ImportForm />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Set up Davloom"
      description="Create the administrator. Davloom also creates a Durable Objects backend and the mount /files."
    >
      {modes}
      {failure === undefined ? null : <Banner status="error" title={failure} container="card" />}
      <VStack gap={4}>
        <TextInput
          label="Name"
          {...field("name")}
          autoComplete="name"
          hasSpellCheck={false}
          hasAutoFocus
        />
        <TextInput
          label="Email"
          type="email"
          {...field("email")}
          autoComplete="username"
          autoCapitalize="none"
          hasSpellCheck={false}
        />
        <TextInput
          label="Password"
          type="password"
          description={`At least ${MIN_PASSWORD} characters.`}
          {...field("password")}
          autoComplete="new-password"
        />
        <TextInput
          label="Setup token"
          type="password"
          description="The DAVLOOM_SETUP_TOKEN this instance was deployed with."
          {...field("token")}
          autoComplete="off"
        />
      </VStack>
      <Button
        label="Create administrator"
        variant="primary"
        isLoading={isSaving}
        onClick={() => void submit()}
      />
      <Text type="supporting" color="secondary">
        Setup runs once. After it, this page sends you to sign in.
      </Text>
    </AuthFrame>
  );
};
