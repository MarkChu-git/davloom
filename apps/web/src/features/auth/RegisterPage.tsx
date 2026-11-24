import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { FileInput } from "@astryxdesign/core/FileInput";
import { VStack } from "@astryxdesign/core/Layout";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { importInstance, register, registrationQuery, signInWithPassword } from "../api/account";
import { describeError, isApiError } from "../api/client";
import { keys } from "../api/queries";
import { AuthFrame, Waiting } from "./AuthFrame";
import { registrationProblems, type RegistrationFields } from "./forms";
import { GoTo } from "./GoTo";
import { NewPasswordField } from "./PasswordField";

/** The field a refusal of the server names, so its reason shows under that field. */
const FIELD_OF_CODE: Readonly<Record<string, keyof RegistrationFields>> = {
  username_refused: "username",
  password_refused: "password",
  email_refused: "email",
};

/** The largest export file the Dashboard reads. */
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;

const SETUP_TOKEN_MISSING = "Enter the setup token.";
const SETUP_TOKEN_CODE = "setup_token_invalid";

/** The deployment's setup token (DAVLOOM_SETUP_TOKEN), when registering needs it. */
interface SetupToken {
  readonly required: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

const SetupTokenField = ({
  token,
  problem,
  onChange,
  onEnter,
}: {
  token: SetupToken;
  problem: string | undefined;
  onChange: () => void;
  onEnter: () => void;
}) =>
  token.required ? (
    <TextInput
      label="Setup token"
      type="password"
      value={token.value}
      onChange={(value) => {
        token.onChange(value);
        onChange();
      }}
      onEnter={onEnter}
      autoComplete="off"
      status={problem === undefined ? undefined : { type: "error", message: problem }}
    />
  ) : null;

/** An instance from an export of another: its owner, keys, backends and mounts. */
const ImportForm = ({ token }: { token: SetupToken }) => {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState("");
  const [problems, setProblems] = useState<{ file?: string; key?: string; token?: string }>({});
  const [failure, setFailure] = useState<string>();
  const [isImporting, setIsImporting] = useState(false);

  const submit = async () => {
    const next = {
      file: file === null ? "Choose the export file." : undefined,
      key: key.trim() === "" ? "Enter the export key." : undefined,
      token: token.required && token.value.trim() === "" ? SETUP_TOKEN_MISSING : undefined,
    };
    setProblems(next);
    setFailure(undefined);
    if (file === null || next.key !== undefined || next.token !== undefined) {
      return;
    }
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
      await importInstance({
        key: key.trim(),
        file: parsed,
        ...(token.required ? { setupToken: token.value.trim() } : {}),
      });
      await client.invalidateQueries({ queryKey: registrationQuery.queryKey });
      await navigate({ to: "/sign-in", replace: true });
    } catch (error) {
      if (isApiError(error) && error.code === SETUP_TOKEN_CODE) {
        setProblems({ token: describeError(error) });
      } else {
        setFailure(describeError(error));
      }
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
          value={key}
          onChange={(value) => {
            setKey(value);
            setProblems((current) => ({ ...current, key: undefined }));
          }}
          onEnter={() => void submit()}
          autoComplete="off"
          status={problems.key === undefined ? undefined : { type: "error", message: problems.key }}
        />
        <SetupTokenField
          token={token}
          problem={problems.token}
          onChange={() => setProblems((current) => ({ ...current, token: undefined }))}
          onEnter={() => void submit()}
        />
      </VStack>
      <Button
        label="Import"
        variant="primary"
        isLoading={isImporting}
        onClick={() => void submit()}
      />
    </>
  );
};

/**
 * Registration (PRD §6): while this Davloom has no account, its first visitor creates the owner's,
 * which also gets a backend and the mount /files, and is signed in. Once an owner exists, this page
 * sends every visitor to sign in.
 */
export const RegisterPage = () => {
  const client = useQueryClient();
  const navigate = useNavigate();
  const registration = useQuery(registrationQuery);
  const [fields, setFields] = useState<RegistrationFields>({
    username: "",
    name: "",
    email: "",
    password: "",
  });
  const [problems, setProblems] = useState<Partial<Record<keyof RegistrationFields, string>>>({});
  const [failure, setFailure] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const [mode, setMode] = useState<"new" | "import">("new");
  const [setupToken, setSetupToken] = useState("");
  const [tokenProblem, setTokenProblem] = useState<string>();
  const token: SetupToken = {
    required: registration.data?.tokenRequired === true,
    value: setupToken,
    onChange: setSetupToken,
  };

  if (registration.isPending) {
    return <Waiting label="Checking this instance" />;
  }
  if (registration.data?.open === false) {
    return <GoTo href="/sign-in" />;
  }
  if (registration.isError) {
    return (
      <AuthFrame title="Create account">
        <Banner status="error" title={describeError(registration.error)} container="card" />
        <Button label="Try again" variant="secondary" onClick={() => void registration.refetch()} />
      </AuthFrame>
    );
  }

  const submit = async () => {
    const next = registrationProblems(fields);
    const missingToken = token.required && setupToken.trim() === "";
    setProblems(next);
    setTokenProblem(missingToken ? SETUP_TOKEN_MISSING : undefined);
    setFailure(undefined);
    if (Object.keys(next).length > 0 || missingToken) {
      return;
    }
    setIsSaving(true);
    try {
      await register({
        username: fields.username.trim(),
        name: fields.name.trim(),
        email: fields.email.trim(),
        password: fields.password,
        ...(token.required ? { setupToken: setupToken.trim() } : {}),
      });
      await signInWithPassword(fields.username.trim(), fields.password);
      await client.invalidateQueries({ queryKey: registrationQuery.queryKey });
      await client.invalidateQueries({ queryKey: keys.me });
      await navigate({ to: "/", replace: true });
    } catch (error) {
      const field = isApiError(error) ? FIELD_OF_CODE[error.code] : undefined;
      if (field !== undefined) {
        setProblems({ [field]: describeError(error) });
      } else if (isApiError(error) && error.code === SETUP_TOKEN_CODE) {
        setTokenProblem(describeError(error));
      } else if (isApiError(error) && error.code === "registration_closed") {
        await client.invalidateQueries({ queryKey: registrationQuery.queryKey });
      } else {
        setFailure(describeError(error));
      }
      setIsSaving(false);
    }
  };

  const field = (name: keyof RegistrationFields) => ({
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
      label="Start from"
      value={mode}
      onChange={(next) => setMode(next === "import" ? "import" : "new")}
      layout="fill"
    >
      <SegmentedControlItem value="new" label="New account" />
      <SegmentedControlItem value="import" label="From an export" />
    </SegmentedControl>
  );

  if (mode === "import") {
    return (
      <AuthFrame title="Create account">
        {modes}
        <ImportForm token={token} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Create account">
      {modes}
      {failure === undefined ? null : <Banner status="error" title={failure} container="card" />}
      <VStack gap={4}>
        <TextInput
          label="Username"
          {...field("username")}
          autoComplete="username"
          autoCapitalize="none"
          hasAutoCorrect={false}
          hasSpellCheck={false}
          hasAutoFocus
        />
        <TextInput
          label="Display name"
          isOptional
          {...field("name")}
          autoComplete="name"
          hasSpellCheck={false}
        />
        <TextInput
          label="Email"
          type="email"
          isOptional
          {...field("email")}
          autoComplete="email"
          autoCapitalize="none"
          hasSpellCheck={false}
        />
        <NewPasswordField
          label="Password"
          value={fields.password}
          onChange={field("password").onChange}
          onEnter={() => void submit()}
          problem={problems.password}
        />
        <SetupTokenField
          token={token}
          problem={tokenProblem}
          onChange={() => setTokenProblem(undefined)}
          onEnter={() => void submit()}
        />
      </VStack>
      <Button
        label="Create account"
        variant="primary"
        isLoading={isSaving}
        onClick={() => void submit()}
      />
    </AuthFrame>
  );
};
