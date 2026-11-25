import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Divider } from "@astryxdesign/core/Divider";
import { Heading } from "@astryxdesign/core/Heading";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Thumbnail } from "@astryxdesign/core/Thumbnail";
import { useToast } from "@astryxdesign/core/Toast";
import * as stylex from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { renderSVG } from "uqr";
import {
  addPasskey,
  canUsePasskeys,
  changePassword,
  disableTwoFactor,
  enableTwoFactor,
  newBackupCodes,
  registrationQuery,
  removePasskey,
  revokeSession,
  setupKeyOf,
  useAccountMutation,
  usePasskeys,
  useSessions,
  verifyTotp,
} from "../api/account";
import { describeError, isApiError } from "../api/client";
import { useMe } from "../api/queries";
import { passwordProblem } from "../auth/forms";
import { NewPasswordField } from "../auth/PasswordField";
import { useSignOut } from "../auth/useSignOut";
import { CopyField } from "../shell/CopyField";
import { buttonLabelled, buttonNamed, refocusIfLost } from "../shell/focus";
import { formatDate, formatRelative } from "../shell/format";
import { LoadingRows, QueryState } from "../shell/QueryState";
import { deviceName } from "./device";

const styles = stylex.create({
  qr: { width: "12rem", height: "12rem" },
});

const Row = ({ label, value, action }: { label: string; value: string; action?: ReactNode }) => (
  <VStack gap={0}>
    <HStack hAlign="between" vAlign="center" gap={4} paddingBlock={4}>
      <VStack gap={0.5}>
        <Text weight="semibold">{label}</Text>
        <Text type="supporting" color="secondary">
          {value}
        </Text>
      </VStack>
      {action === undefined ? null : <StackItem>{action}</StackItem>}
    </HStack>
    <Divider />
  </VStack>
);

/** A form in a dialog: a header, its fields and a failure, Cancel and one action. */
const DialogForm = ({
  title,
  failure,
  actionLabel,
  isBusy,
  onAction,
  onCancel,
  children,
}: {
  title: string;
  failure?: string;
  actionLabel: string;
  isBusy: boolean;
  onAction: () => void;
  onCancel?: () => void;
  children: ReactNode;
}) => (
  <Layout
    header={<DialogHeader title={title} onOpenChange={onCancel ?? onAction} />}
    content={
      <LayoutContent>
        <VStack gap={4}>
          {failure === undefined ? null : (
            <Banner status="error" title={failure} container="card" />
          )}
          {children}
        </VStack>
      </LayoutContent>
    }
    footer={
      <LayoutFooter>
        <HStack gap={2} hAlign="end">
          {onCancel === undefined ? null : (
            <Button label="Cancel" variant="secondary" onClick={onCancel} />
          )}
          <Button label={actionLabel} variant="primary" isLoading={isBusy} onClick={onAction} />
        </HStack>
      </LayoutFooter>
    }
  />
);

const passwordFailure = (error: unknown): string =>
  isApiError(error) && error.code === "invalid_password"
    ? "The password is wrong."
    : describeError(error);

const ChangePasswordForm = ({ onDone }: { onDone: (changed: boolean) => void }) => {
  const change = useAccountMutation(changePassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [problems, setProblems] = useState<{ current?: string; next?: string }>({});
  const submit = () => {
    const found = {
      current: current === "" ? "Enter your current password." : undefined,
      next: passwordProblem(next),
    };
    setProblems(found);
    if (found.current !== undefined || found.next !== undefined || change.isPending) {
      return;
    }
    change.mutate(
      { currentPassword: current, newPassword: next },
      { onSuccess: () => onDone(true) },
    );
  };
  return (
    <DialogForm
      title="Change password"
      failure={change.isError ? passwordFailure(change.error) : undefined}
      actionLabel="Change password"
      isBusy={change.isPending}
      onAction={submit}
      onCancel={() => onDone(false)}
    >
      <TextInput
        label="Current password"
        type="password"
        value={current}
        onChange={(value) => {
          setCurrent(value);
          setProblems((found) => ({ ...found, current: undefined }));
        }}
        onEnter={submit}
        autoComplete="current-password"
        hasAutoFocus
        status={
          problems.current === undefined ? undefined : { type: "error", message: problems.current }
        }
      />
      <NewPasswordField
        label="New password"
        value={next}
        onChange={(value) => {
          setNext(value);
          setProblems((found) => ({ ...found, next: undefined }));
        }}
        onEnter={submit}
        problem={problems.next}
      />
    </DialogForm>
  );
};

/** Asks for the password before a change of two-step verification, as Better Auth requires. */
const PasswordStep = ({
  title,
  actionLabel,
  run,
  onCancel,
}: {
  title: string;
  actionLabel: string;
  run: (password: string) => Promise<void>;
  onCancel: () => void;
}) => {
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);
  const submit = async () => {
    if (password === "") {
      setFailure("Enter your password.");
      return;
    }
    setIsBusy(true);
    setFailure(undefined);
    try {
      await run(password);
    } catch (error) {
      setFailure(passwordFailure(error));
      setIsBusy(false);
    }
  };
  return (
    <DialogForm
      title={title}
      failure={failure}
      actionLabel={actionLabel}
      isBusy={isBusy}
      onAction={() => void submit()}
      onCancel={onCancel}
    >
      <TextInput
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        onEnter={() => void submit()}
        autoComplete="current-password"
        hasAutoFocus
      />
    </DialogForm>
  );
};

const BackupCodes = ({ codes, onDone }: { codes: readonly string[]; onDone: () => void }) => (
  <DialogForm title="Backup codes" actionLabel="Done" isBusy={false} onAction={onDone}>
    <Text>Each code signs you in once, without the authenticator app.</Text>
    <CopyField label="Backup codes" value={codes.join(" ")} copyLabel="Copy codes" />
  </DialogForm>
);

/** The QR code an authenticator app scans, as an image. */
const qrImage = (uri: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(uri, { border: 2 }))}`;

const ConfirmAuthenticator = ({
  uri,
  onConfirmed,
  onCancel,
}: {
  uri: string;
  onConfirmed: () => void;
  onCancel: () => void;
}) => {
  const verify = useAccountMutation(verifyTotp);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string>();
  const submit = () => {
    if (code.trim() === "") {
      setProblem("Enter the code from your authenticator app.");
      return;
    }
    if (!verify.isPending) {
      verify.mutate(code, { onSuccess: onConfirmed });
    }
  };
  return (
    <DialogForm
      title="Set up two-step verification"
      failure={
        verify.isError
          ? isApiError(verify.error) && verify.error.code === "invalid_code"
            ? "The code is wrong or has expired."
            : describeError(verify.error)
          : undefined
      }
      actionLabel="Turn on"
      isBusy={verify.isPending}
      onAction={submit}
      onCancel={onCancel}
    >
      <Thumbnail src={qrImage(uri)} alt="QR code for the authenticator app" xstyle={styles.qr} />
      <CopyField label="Setup key" value={setupKeyOf(uri)} copyLabel="Copy key" />
      <TextInput
        label="Authenticator code"
        value={code}
        onChange={(value) => {
          setCode(value);
          setProblem(undefined);
        }}
        onEnter={submit}
        inputMode="numeric"
        autoComplete="one-time-code"
        hasAutoCorrect={false}
        status={problem === undefined ? undefined : { type: "error", message: problem }}
      />
    </DialogForm>
  );
};

/** What the security dialog shows. */
type SecurityDialog =
  | { step: "password" }
  | { step: "enable" }
  | { step: "scan"; uri: string; codes: string[] }
  | { step: "codes"; codes: string[] }
  | { step: "new-codes" }
  | { step: "disable" };

/** The title of each step, which names the dialog for assistive technology. */
const DIALOG_TITLES: Readonly<Record<SecurityDialog["step"], string>> = {
  password: "Change password",
  enable: "Set up two-step verification",
  scan: "Set up two-step verification",
  codes: "Backup codes",
  "new-codes": "New backup codes",
  disable: "Turn off two-step verification",
};

const label = (name: string | null) => name ?? "Passkey";

/** The status of passkeys on an instance that has no configured public URL. */
export const PASSKEYS_OFF = "Off: DAVLOOM_URL is not set";

/**
 * Passkeys are bound to the instance's configured public URL, so without DAVLOOM_URL the server
 * has them off, and the part says so instead of listing them.
 */
const PasskeysPart = () => {
  const registration = useQuery(registrationQuery);
  if (registration.isPending) {
    return <LoadingRows rows={1} />;
  }
  if (registration.data?.passkeys !== true) {
    return (
      <VStack gap={2}>
        <Heading level={3}>Passkeys</Heading>
        <Text color="secondary">{PASSKEYS_OFF}</Text>
      </VStack>
    );
  }
  return <PasskeysList />;
};

const PasskeysList = () => {
  const toast = useToast();
  const passkeys = usePasskeys();
  const add = useAccountMutation(addPasskey);
  const remove = useAccountMutation(removePasskey);
  return (
    <VStack gap={2}>
      <HStack hAlign="between" vAlign="center">
        <Heading level={3}>Passkeys</Heading>
        {canUsePasskeys() ? (
          <Button
            label="Add passkey"
            variant="secondary"
            size="sm"
            isLoading={add.isPending}
            onClick={() =>
              add.mutate(deviceName(navigator.userAgent), {
                onSuccess: () => toast({ body: "Passkey added." }),
                onError: (error) => toast({ type: "error", body: describeError(error) }),
              })
            }
          />
        ) : null}
      </HStack>
      <QueryState
        query={passkeys}
        title="Cannot read the passkeys"
        loading={<LoadingRows rows={1} />}
      >
        {(list) =>
          list.length === 0 ? (
            <Text color="secondary">None</Text>
          ) : (
            <VStack gap={0}>
              <Divider />
              {list.map((passkey) => (
                <Row
                  key={passkey.id}
                  label={label(passkey.name)}
                  value={passkey.createdAt === null ? "" : `Added ${formatDate(passkey.createdAt)}`}
                  action={
                    <Button
                      label={`Remove ${label(passkey.name)}`}
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        remove.mutate(passkey.id, {
                          onSuccess: () => {
                            toast({ body: `Removed ${label(passkey.name)}.` });
                            refocusIfLost(() => buttonNamed("Add passkey"));
                          },
                          onError: (error) => toast({ type: "error", body: describeError(error) }),
                        })
                      }
                    >
                      Remove
                    </Button>
                  }
                />
              ))}
            </VStack>
          )
        }
      </QueryState>
    </VStack>
  );
};

const SessionsPart = ({ onSignOutHere }: { onSignOutHere: () => void }) => {
  const toast = useToast();
  const sessions = useSessions();
  const revoke = useAccountMutation(revokeSession);
  return (
    <VStack gap={2}>
      <Heading level={3}>Sessions</Heading>
      <QueryState
        query={sessions}
        title="Cannot read the sessions"
        loading={<LoadingRows rows={2} />}
      >
        {({ sessions: list, currentToken }) => {
          const others = list.filter((session) => session.token !== currentToken);
          const current = list.find((session) => session.token === currentToken);
          return (
            <VStack gap={0}>
              <Divider />
              {current === undefined ? null : (
                <Row
                  label={deviceName(current.userAgent)}
                  value="Active now, this browser"
                  action={
                    <Button
                      label="Sign out"
                      variant="secondary"
                      size="sm"
                      onClick={onSignOutHere}
                    />
                  }
                />
              )}
              {others.map((session, index) => {
                const device = deviceName(session.userAgent);
                return (
                  <Row
                    key={session.id}
                    label={device}
                    value={`Last active ${formatRelative(session.updatedAt)}`}
                    action={
                      <Button
                        label={`Sign out ${device}`}
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const next = others[index + 1] ?? others[index - 1];
                          revoke.mutate(session.token, {
                            onSuccess: () => {
                              toast({ body: `Signed out ${device}.` });
                              refocusIfLost(() =>
                                next === undefined
                                  ? buttonNamed("Sign out")
                                  : buttonLabelled(`Sign out ${deviceName(next.userAgent)}`),
                              );
                            },
                            onError: (error) =>
                              toast({ type: "error", body: describeError(error) }),
                          });
                        }}
                      >
                        Sign out
                      </Button>
                    }
                  />
                );
              })}
            </VStack>
          );
        }}
      </QueryState>
    </VStack>
  );
};

/**
 * Settings > Sign-in and security: the password, two-step verification, passkeys and sessions.
 * Each change is a step-up action, which the server asks to verify (api/stepUp.ts).
 */
export const SecurityContent = () => {
  const toast = useToast();
  const me = useMe();
  const signOut = useSignOut();
  const [dialog, setDialog] = useState<SecurityDialog>();
  const [dialogKey, setDialogKey] = useState(0);
  const isOn = me.data?.twoFactorEnabled === true;

  const open = (next: SecurityDialog) => {
    setDialogKey((key) => key + 1);
    setDialog(next);
  };
  const close = () => setDialog(undefined);

  const content = (() => {
    switch (dialog?.step) {
      case "password":
        return (
          <ChangePasswordForm
            onDone={(changed) => {
              close();
              if (changed) {
                toast({ body: "Password changed." });
              }
            }}
          />
        );
      case "enable":
        return (
          <PasswordStep
            title="Set up two-step verification"
            actionLabel="Continue"
            onCancel={close}
            run={async (password) => {
              const { totpURI, backupCodes } = await enableTwoFactor(password);
              open({ step: "scan", uri: totpURI, codes: backupCodes });
            }}
          />
        );
      case "scan": {
        const { codes } = dialog;
        return (
          <ConfirmAuthenticator
            uri={dialog.uri}
            onCancel={close}
            onConfirmed={() => {
              toast({ body: "Two-step verification is on." });
              open({ step: "codes", codes });
            }}
          />
        );
      }
      case "codes":
        return <BackupCodes codes={dialog.codes} onDone={close} />;
      case "new-codes":
        return (
          <PasswordStep
            title="New backup codes"
            actionLabel="Create codes"
            onCancel={close}
            run={async (password) => {
              const { backupCodes } = await newBackupCodes(password);
              open({ step: "codes", codes: backupCodes });
            }}
          />
        );
      case "disable":
        return (
          <PasswordStep
            title="Turn off two-step verification"
            actionLabel="Turn off"
            onCancel={close}
            run={async (password) => {
              await disableTwoFactor(password);
              await me.refetch();
              close();
              toast({ body: "Two-step verification is off." });
            }}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <>
      <VStack gap={0}>
        <Divider />
        <Row
          label="Password"
          value="Set"
          action={
            <Button
              label="Change password"
              variant="secondary"
              size="sm"
              onClick={() => open({ step: "password" })}
            />
          }
        />
        <Row
          label="Two-step verification"
          value={isOn ? "On" : "Off"}
          action={
            isOn ? (
              <HStack gap={2}>
                <Button
                  label="New backup codes"
                  variant="secondary"
                  size="sm"
                  onClick={() => open({ step: "new-codes" })}
                />
                <Button
                  label="Turn off"
                  variant="secondary"
                  size="sm"
                  onClick={() => open({ step: "disable" })}
                />
              </HStack>
            ) : (
              <Button
                label="Set up"
                variant="secondary"
                size="sm"
                onClick={() => open({ step: "enable" })}
              />
            )
          }
        />
      </VStack>
      <PasskeysPart />
      <SessionsPart onSignOutHere={signOut.signOut} />
      <Dialog
        isOpen={dialog !== undefined}
        onOpenChange={(isOpenNow) => {
          if (!isOpenNow) {
            close();
          }
        }}
        purpose={dialog?.step === "codes" ? "required" : "form"}
        width={440}
        aria-label={dialog === undefined ? undefined : DIALOG_TITLES[dialog.step]}
      >
        <VStack key={dialogKey}>{content}</VStack>
      </Dialog>
      {signOut.element}
    </>
  );
};
