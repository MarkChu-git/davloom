import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { describeError, isApiError } from "../api/client";
import { keys, meQuery, setupQuery, signIn } from "../api/queries";
import { AuthFrame, Waiting } from "./AuthFrame";
import { safeRedirect } from "./forms";
import { GoTo } from "./GoTo";

const signInProblem = (error: unknown): string =>
  isApiError(error) && (error.status === 401 || error.code === "invalid_email_or_password")
    ? "The email or the password is wrong."
    : describeError(error);

/** Sign-in (PRD §6): the administrator's email and password, which Better Auth checks. */
export const SignInPage = ({ redirect }: { redirect?: string }) => {
  const client = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery({ ...meQuery, retry: false });
  const setup = useQuery(setupQuery);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problems, setProblems] = useState<{ email?: string; password?: string }>({});
  const [failure, setFailure] = useState<string>();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const target = safeRedirect(redirect);

  if (me.isSuccess) {
    return <GoTo href={target} />;
  }
  if (setup.data?.needed === true) {
    return <GoTo href="/setup" />;
  }
  if (me.isPending || setup.isPending) {
    return <Waiting label="Checking the session" />;
  }

  const submit = async () => {
    const next = {
      email: email.trim() === "" ? "Enter the email you set up Davloom with." : undefined,
      password: password === "" ? "Enter your password." : undefined,
    };
    setProblems(next);
    setFailure(undefined);
    if (next.email !== undefined || next.password !== undefined) {
      return;
    }
    setIsSigningIn(true);
    try {
      await signIn(email.trim(), password);
      await client.invalidateQueries({ queryKey: keys.me });
      await navigate({ href: target, replace: true });
    } catch (error) {
      setFailure(signInProblem(error));
      setIsSigningIn(false);
    }
  };

  return (
    <AuthFrame title="Sign in" description="Sign in to manage your files, keys and storage.">
      {failure === undefined ? null : <Banner status="error" title={failure} container="card" />}
      {setup.isError ? (
        <Banner status="warning" title={describeError(setup.error)} container="card" />
      ) : null}
      <VStack gap={4}>
        <TextInput
          label="Email"
          type="email"
          value={email}
          onChange={(value) => {
            setEmail(value);
            setProblems((current) => ({ ...current, email: undefined }));
          }}
          onEnter={() => void submit()}
          autoComplete="username"
          autoCapitalize="none"
          hasSpellCheck={false}
          hasAutoFocus
          status={
            problems.email === undefined ? undefined : { type: "error", message: problems.email }
          }
        />
        <TextInput
          label="Password"
          type="password"
          value={password}
          onChange={(value) => {
            setPassword(value);
            setProblems((current) => ({ ...current, password: undefined }));
          }}
          onEnter={() => void submit()}
          autoComplete="current-password"
          status={
            problems.password === undefined
              ? undefined
              : { type: "error", message: problems.password }
          }
        />
      </VStack>
      <Button
        label="Sign in"
        variant="primary"
        isLoading={isSigningIn}
        onClick={() => void submit()}
      />
    </AuthFrame>
  );
};
