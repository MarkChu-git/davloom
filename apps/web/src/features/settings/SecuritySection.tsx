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
import { useT } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages/en";
import type { Translator } from "../i18n/translate";
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
}) => {
  const t = useT();
  return (
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
              <Button label={t("action.cancel")} variant="secondary" onClick={onCancel} />
            )}
            <Button label={actionLabel} variant="primary" isLoading={isBusy} onClick={onAction} />
          </HStack>
        </LayoutFooter>
      }
    />
  );
};

const passwordFailure = (t: Translator, error: unknown): string =>
  isApiError(error) && error.code === "invalid_password"
    ? t("verify.wrongPassword")
    : describeError(t, error);

const ChangePasswordForm = ({ onDone }: { onDone: (changed: boolean) => void }) => {
  const t = useT();
  const change = useAccountMutation(changePassword);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [problems, setProblems] = useState<{ current?: string; next?: string }>({});
  const submit = () => {
    const found = {
      current: current === "" ? t("security.currentMissing") : undefined,
      next: passwordProblem(t, next),
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
      title={t("security.changePassword")}
      failure={change.isError ? passwordFailure(t, change.error) : undefined}
      actionLabel={t("security.changePassword")}
      isBusy={change.isPending}
      onAction={submit}
      onCancel={() => onDone(false)}
    >
      <TextInput
        label={t("security.currentPassword")}
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
        label={t("security.newPassword")}
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
  const t = useT();
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);
  const submit = async () => {
    if (password === "") {
      setFailure(t("verify.passwordMissing"));
      return;
    }
    setIsBusy(true);
    setFailure(undefined);
    try {
      await run(password);
    } catch (error) {
      setFailure(passwordFailure(t, error));
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
        label={t("field.password")}
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

const BackupCodes = ({ codes, onDone }: { codes: readonly string[]; onDone: () => void }) => {
  const t = useT();
  return (
    <DialogForm
      title={t("security.backupCodes")}
      actionLabel={t("keys.done")}
      isBusy={false}
      onAction={onDone}
    >
      <Text>{t("security.backupCodesHelp")}</Text>
      <CopyField
        label={t("security.backupCodes")}
        value={codes.join(" ")}
        copyLabel={t("security.copyCodes")}
      />
    </DialogForm>
  );
};

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
  const t = useT();
  const verify = useAccountMutation(verifyTotp);
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string>();
  const submit = () => {
    if (code.trim() === "") {
      setProblem(t("verify.codeMissing"));
      return;
    }
    if (!verify.isPending) {
      verify.mutate(code, { onSuccess: onConfirmed });
    }
  };
  return (
    <DialogForm
      title={t("security.setUpTitle")}
      failure={
        verify.isError
          ? isApiError(verify.error) && verify.error.code === "invalid_code"
            ? t("verify.wrongCode")
            : describeError(t, verify.error)
          : undefined
      }
      actionLabel={t("security.turnOn")}
      isBusy={verify.isPending}
      onAction={submit}
      onCancel={onCancel}
    >
      <Thumbnail src={qrImage(uri)} alt={t("security.qr")} xstyle={styles.qr} />
      <CopyField
        label={t("security.setupKey")}
        value={setupKeyOf(uri)}
        copyLabel={t("keys.copyKey")}
      />
      <TextInput
        label={t("verify.code")}
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
const DIALOG_TITLES: Readonly<Record<SecurityDialog["step"], MessageKey>> = {
  password: "security.changePassword",
  enable: "security.setUpTitle",
  scan: "security.setUpTitle",
  codes: "security.backupCodes",
  "new-codes": "security.newBackupCodes",
  disable: "security.turnOffTitle",
};

const label = (t: Translator, name: string | null) => name ?? t("security.passkey");

/**
 * Passkeys are bound to the instance's configured public URL, so without DAVLOOM_URL the server
 * has them off, and the part says so instead of listing them.
 */
const PasskeysPart = () => {
  const t = useT();
  const registration = useQuery(registrationQuery);
  if (registration.isPending) {
    return <LoadingRows rows={1} />;
  }
  if (registration.data?.passkeys !== true) {
    return (
      <VStack gap={2}>
        <Heading level={3}>{t("security.passkeys")}</Heading>
        <Text color="secondary">{t("security.passkeysOff")}</Text>
      </VStack>
    );
  }
  return <PasskeysList />;
};

const PasskeysList = () => {
  const t = useT();
  const toast = useToast();
  const passkeys = usePasskeys();
  const add = useAccountMutation(addPasskey);
  const remove = useAccountMutation(removePasskey);
  return (
    <VStack gap={2}>
      <HStack hAlign="between" vAlign="center">
        <Heading level={3}>{t("security.passkeys")}</Heading>
        {canUsePasskeys() ? (
          <Button
            label={t("security.addPasskey")}
            variant="secondary"
            size="sm"
            isLoading={add.isPending}
            onClick={() =>
              add.mutate(deviceName(t, navigator.userAgent), {
                onSuccess: () => toast({ body: t("security.passkeyAdded") }),
                onError: (error) => toast({ type: "error", body: describeError(t, error) }),
              })
            }
          />
        ) : null}
      </HStack>
      <QueryState
        query={passkeys}
        title={t("security.cannotReadPasskeys")}
        loading={<LoadingRows rows={1} />}
      >
        {(list) =>
          list.length === 0 ? (
            <Text color="secondary">{t("about.none")}</Text>
          ) : (
            <VStack gap={0}>
              <Divider />
              {list.map((passkey) => (
                <Row
                  key={passkey.id}
                  label={label(t, passkey.name)}
                  value={
                    passkey.createdAt === null
                      ? ""
                      : t("security.passkeyAddedOn", { date: t.date(passkey.createdAt) })
                  }
                  action={
                    <Button
                      label={t("security.removeNamed", { name: label(t, passkey.name) })}
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        remove.mutate(passkey.id, {
                          onSuccess: () => {
                            toast({
                              body: t("security.removed", { name: label(t, passkey.name) }),
                            });
                            refocusIfLost(() => buttonNamed(t("security.addPasskey")));
                          },
                          onError: (error) =>
                            toast({ type: "error", body: describeError(t, error) }),
                        })
                      }
                    >
                      {t("action.remove")}
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
  const t = useT();
  const toast = useToast();
  const sessions = useSessions();
  const revoke = useAccountMutation(revokeSession);
  return (
    <VStack gap={2}>
      <Heading level={3}>{t("security.sessions")}</Heading>
      <QueryState
        query={sessions}
        title={t("security.cannotReadSessions")}
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
                  label={deviceName(t, current.userAgent)}
                  value={t("security.thisBrowser")}
                  action={
                    <Button
                      label={t("nav.signOut")}
                      variant="secondary"
                      size="sm"
                      onClick={onSignOutHere}
                    />
                  }
                />
              )}
              {others.map((session, index) => {
                const device = deviceName(t, session.userAgent);
                return (
                  <Row
                    key={session.id}
                    label={device}
                    value={t("security.lastActive", { when: t.relative(session.updatedAt) })}
                    action={
                      <Button
                        label={t("security.signOutNamed", { device })}
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const next = others[index + 1] ?? others[index - 1];
                          revoke.mutate(session.token, {
                            onSuccess: () => {
                              toast({ body: t("security.signedOutNamed", { device }) });
                              refocusIfLost(() =>
                                next === undefined
                                  ? buttonNamed(t("nav.signOut"))
                                  : buttonLabelled(
                                      t("security.signOutNamed", {
                                        device: deviceName(t, next.userAgent),
                                      }),
                                    ),
                              );
                            },
                            onError: (error) =>
                              toast({ type: "error", body: describeError(t, error) }),
                          });
                        }}
                      >
                        {t("nav.signOut")}
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
  const t = useT();
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
                toast({ body: t("security.passwordChanged") });
              }
            }}
          />
        );
      case "enable":
        return (
          <PasswordStep
            title={t("security.setUpTitle")}
            actionLabel={t("security.continue")}
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
              toast({ body: t("security.isOn") });
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
            title={t("security.newBackupCodes")}
            actionLabel={t("security.createCodes")}
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
            title={t("security.turnOffTitle")}
            actionLabel={t("security.turnOff")}
            onCancel={close}
            run={async (password) => {
              await disableTwoFactor(password);
              await me.refetch();
              close();
              toast({ body: t("security.isOff") });
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
          label={t("field.password")}
          value={t("security.passwordSet")}
          action={
            <Button
              label={t("security.changePassword")}
              variant="secondary"
              size="sm"
              onClick={() => open({ step: "password" })}
            />
          }
        />
        <Row
          label={t("signIn.secondStep")}
          value={isOn ? t("security.on") : t("keys.state.off")}
          action={
            isOn ? (
              <HStack gap={2}>
                <Button
                  label={t("security.newBackupCodes")}
                  variant="secondary"
                  size="sm"
                  onClick={() => open({ step: "new-codes" })}
                />
                <Button
                  label={t("security.turnOff")}
                  variant="secondary"
                  size="sm"
                  onClick={() => open({ step: "disable" })}
                />
              </HStack>
            ) : (
              <Button
                label={t("security.setUp")}
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
        aria-label={dialog === undefined ? undefined : t(DIALOG_TITLES[dialog.step])}
      >
        <VStack key={dialogKey}>{content}</VStack>
      </Dialog>
      {signOut.element}
    </>
  );
};
