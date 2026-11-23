import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { describeError, isApiError } from "../api/client";
import { completeSetup, keys, setupQuery, signIn } from "../api/queries";
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

  return (
    <AuthFrame
      title="Set up Davloom"
      description="Create the administrator. Davloom also creates a Durable Objects backend and the mount /files."
    >
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
