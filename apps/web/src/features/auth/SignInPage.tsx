import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { Icon } from "@astryxdesign/core/Icon";
import { VStack } from "@astryxdesign/core/Layout";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import {
  canUsePasskeys,
  registrationQuery,
  signInWithPasskey,
  signInWithPassword,
  verifyBackupCode,
  verifyTotp,
} from "../api/account";
import { describeError, isApiError } from "../api/client";
import { keys, meQuery } from "../api/queries";
import { AuthFrame, Waiting } from "./AuthFrame";
import { safeRedirect } from "./forms";
import { GoTo } from "./GoTo";

const signInProblem = (error: unknown): string =>
  isApiError(error) &&
  (error.status === 401 ||
    error.code === "invalid_email_or_password" ||
    error.code === "invalid_username_or_password")
    ? "The username or the password is wrong."
    : describeError(error);

const codeProblem = (error: unknown): string => {
  if (!isApiError(error)) {
    return describeError(error);
  }
  switch (error.code) {
    case "invalid_code":
    case "invalid_backup_code":
      return "The code is wrong or has expired.";
    case "invalid_two_factor_cookie":
      return "The sign-in has expired. Start again.";
    case "too_many_attempts_request_new_code":
    case "account_temporarily_locked":
      return "Too many wrong codes. Wait a few minutes and try again.";
    default:
      return describeError(error);
  }
};

/** The second step of a sign-in: a code of the authenticator app, or a backup code. */
const SecondStep = ({
  onSignedIn,
  onRestart,
}: {
  onSignedIn: () => void;
  onRestart: () => void;
}) => {
  const [isBackup, setIsBackup] = useState(false);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [isVerifying, setIsVerifying] = useState(false);

  const submit = async () => {
    if (code.trim() === "") {
      setProblem(isBackup ? "Enter a backup code." : "Enter the code from your authenticator app.");
      return;
    }
    setIsVerifying(true);
    setFailure(undefined);
    try {
      await (isBackup ? verifyBackupCode(code) : verifyTotp(code));
      onSignedIn();
    } catch (error) {
      setFailure(codeProblem(error));
      setIsVerifying(false);
    }
  };

  return (
    <AuthFrame title="Two-step verification">
      {failure === undefined ? null : <Banner status="error" title={failure} container="card" />}
      <TextInput
        key={isBackup ? "backup" : "totp"}
        label={isBackup ? "Backup code" : "Authenticator code"}
        value={code}
        onChange={(value) => {
          setCode(value);
          setProblem(undefined);
        }}
        onEnter={() => void submit()}
        inputMode={isBackup ? "text" : "numeric"}
        autoComplete="one-time-code"
        autoCapitalize="none"
        hasAutoCorrect={false}
        hasSpellCheck={false}
        hasAutoFocus
        status={problem === undefined ? undefined : { type: "error", message: problem }}
      />
      <Button
        label="Verify"
        variant="primary"
        isLoading={isVerifying}
        onClick={() => void submit()}
      />
      <Button
        label={isBackup ? "Use the authenticator app" : "Use a backup code"}
        variant="ghost"
        onClick={() => {
          setIsBackup(!isBackup);
          setCode("");
          setProblem(undefined);
          setFailure(undefined);
        }}
      />
      <Button label="Start again" variant="ghost" onClick={onRestart} />
    </AuthFrame>
  );
};

/**
 * Sign-in (PRD §6): the owner's username or email and password, then the second step when two-step
 * verification is on; or a passkey. While the instance has no owner, it sends the visitor to
 * create the account instead.
 */
export const SignInPage = ({ redirect }: { redirect?: string }) => {
  const client = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery({ ...meQuery, retry: false });
  const registration = useQuery(registrationQuery);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [problems, setProblems] = useState<{ identifier?: string; password?: string }>({});
  const [failure, setFailure] = useState<string>();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSecondStep, setIsSecondStep] = useState(false);
  const target = safeRedirect(redirect);

  if (me.isSuccess) {
    return <GoTo href={target} />;
  }
  if (registration.data?.open === true) {
    return <GoTo href="/register" />;
  }
  if (me.isPending || registration.isPending) {
    return <Waiting label="Checking the session" />;
  }

  const signedIn = async () => {
    await client.invalidateQueries({ queryKey: keys.me });
    await navigate({ href: target, replace: true });
  };

  if (isSecondStep) {
    return (
      <SecondStep
        onSignedIn={() => void signedIn()}
        onRestart={() => {
          setIsSecondStep(false);
          setIsSigningIn(false);
          setPassword("");
        }}
      />
    );
  }

  const submit = async () => {
    const next = {
      identifier: identifier.trim() === "" ? "Enter your username or email." : undefined,
      password: password === "" ? "Enter your password." : undefined,
    };
    setProblems(next);
    setFailure(undefined);
    if (next.identifier !== undefined || next.password !== undefined) {
      return;
    }
    setIsSigningIn(true);
    try {
      const step = await signInWithPassword(identifier.trim(), password);
      if (step === "second-step") {
        setIsSecondStep(true);
        return;
      }
      await signedIn();
    } catch (error) {
      setFailure(signInProblem(error));
      setIsSigningIn(false);
    }
  };

  const withPasskey = async () => {
    setFailure(undefined);
    try {
      await signInWithPasskey();
      await signedIn();
    } catch (error) {
      setFailure(describeError(error));
    }
  };

  return (
    <AuthFrame title="Sign in">
      {failure === undefined ? null : <Banner status="error" title={failure} container="card" />}
      {registration.isError ? (
        <Banner status="warning" title={describeError(registration.error)} container="card" />
      ) : null}
      <VStack gap={4}>
        <TextInput
          label="Username or email"
          value={identifier}
          onChange={(value) => {
            setIdentifier(value);
            setProblems((current) => ({ ...current, identifier: undefined }));
          }}
          onEnter={() => void submit()}
          autoComplete="username webauthn"
          autoCapitalize="none"
          hasAutoCorrect={false}
          hasSpellCheck={false}
          hasAutoFocus
          status={
            problems.identifier === undefined
              ? undefined
              : { type: "error", message: problems.identifier }
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
      {canUsePasskeys() ? (
        <>
          <Divider />
          <Button
            label="Sign in with a passkey"
            variant="secondary"
            icon={<Icon icon={KeyRound} size="sm" />}
            onClick={() => void withPasskey()}
          />
        </>
      ) : null}
    </AuthFrame>
  );
};
