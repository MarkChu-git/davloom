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
import { keys, sessionQuery } from "../api/queries";
import { useT } from "../i18n/I18nProvider";
import type { Translator } from "../i18n/translate";
import { AuthFrame } from "./AuthFrame";
import { safeRedirect } from "./forms";
import { GoTo } from "./GoTo";

const signInProblem = (t: Translator, error: unknown): string =>
  isApiError(error) &&
  (error.status === 401 ||
    error.code === "invalid_email_or_password" ||
    error.code === "invalid_username_or_password")
    ? t("signIn.wrongCredentials")
    : describeError(t, error);

const codeProblem = (t: Translator, error: unknown): string => {
  if (!isApiError(error)) {
    return describeError(t, error);
  }
  switch (error.code) {
    case "invalid_code":
    case "invalid_backup_code":
      return t("verify.wrongCode");
    case "invalid_two_factor_cookie":
      return t("signIn.expired");
    case "too_many_attempts_request_new_code":
    case "account_temporarily_locked":
      return t("verify.tooManyCodes");
    default:
      return describeError(t, error);
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
  const t = useT();
  const [isBackup, setIsBackup] = useState(false);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [isVerifying, setIsVerifying] = useState(false);

  const submit = async () => {
    if (code.trim() === "") {
      setProblem(isBackup ? t("signIn.backupCodeMissing") : t("verify.codeMissing"));
      return;
    }
    setIsVerifying(true);
    setFailure(undefined);
    try {
      await (isBackup ? verifyBackupCode(code) : verifyTotp(code));
      onSignedIn();
    } catch (error) {
      setFailure(codeProblem(t, error));
      setIsVerifying(false);
    }
  };

  return (
    <AuthFrame title={t("signIn.secondStep")}>
      {failure === undefined ? null : <Banner status="error" title={failure} container="card" />}
      <TextInput
        key={isBackup ? "backup" : "totp"}
        label={isBackup ? t("signIn.backupCode") : t("verify.code")}
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
        label={t("verify.submit")}
        variant="primary"
        isLoading={isVerifying}
        onClick={() => void submit()}
      />
      <Button
        label={isBackup ? t("signIn.useAuthenticator") : t("signIn.useBackupCode")}
        variant="ghost"
        onClick={() => {
          setIsBackup(!isBackup);
          setCode("");
          setProblem(undefined);
          setFailure(undefined);
        }}
      />
      <Button label={t("signIn.startAgain")} variant="ghost" onClick={onRestart} />
    </AuthFrame>
  );
};

/**
 * Sign-in (PRD §6): the owner's username or email and password, then the second step when two-step
 * verification is on; or a passkey. While the instance has no owner, it sends the visitor to
 * create the account instead.
 */
export const SignInPage = ({ redirect }: { redirect?: string }) => {
  const t = useT();
  const client = useQueryClient();
  const navigate = useNavigate();
  // Better Auth's session answers 200 with null for a visitor who is not signed in, where /api/me
  // answers 401, which the browser reports as an error.
  const session = useQuery(sessionQuery);
  const registration = useQuery(registrationQuery);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [problems, setProblems] = useState<{ identifier?: string; password?: string }>({});
  const [failure, setFailure] = useState<string>();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSecondStep, setIsSecondStep] = useState(false);
  const target = safeRedirect(redirect);

  if (session.data != null) {
    return <GoTo href={target} />;
  }
  if (registration.data?.open === true) {
    return <GoTo href="/register" />;
  }
  // While the session and the instance are being read, the form shows already: the prerendered
  // page paints it before any script runs, and a visitor who is signed in moves on once the
  // answer comes.

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
      identifier: identifier.trim() === "" ? t("signIn.identifierMissing") : undefined,
      password: password === "" ? t("verify.passwordMissing") : undefined,
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
      setFailure(signInProblem(t, error));
      setIsSigningIn(false);
    }
  };

  const withPasskey = async () => {
    setFailure(undefined);
    try {
      await signInWithPasskey();
      await signedIn();
    } catch (error) {
      setFailure(describeError(t, error));
    }
  };

  return (
    <AuthFrame title={t("signIn.title")}>
      {failure === undefined ? null : <Banner status="error" title={failure} container="card" />}
      {registration.isError ? (
        <Banner status="warning" title={describeError(t, registration.error)} container="card" />
      ) : null}
      <VStack gap={4}>
        <TextInput
          label={t("signIn.identifier")}
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
          label={t("field.password")}
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
        label={t("signIn.submit")}
        variant="primary"
        isLoading={isSigningIn}
        onClick={() => void submit()}
      />
      {registration.data?.passkeys === true && canUsePasskeys() ? (
        <>
          <Divider />
          <Button
            label={t("signIn.withPasskey")}
            variant="secondary"
            icon={<Icon icon={KeyRound} size="sm" />}
            onClick={() => void withPasskey()}
          />
        </>
      ) : null}
    </AuthFrame>
  );
};
