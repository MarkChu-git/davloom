import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from "@astryxdesign/core/Layout";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { canUsePasskeys, reverify, signInWithPasskey } from "../api/account";
import { describeError, isApiError } from "../api/client";
import { keys, useMe } from "../api/queries";
import { setStepUpHandler } from "../api/stepUp";

const failureOf = (error: unknown): string => {
  if (!isApiError(error)) {
    return describeError(error);
  }
  switch (error.code) {
    case "wrong_password":
      return "The password is wrong.";
    case "code_required":
      return "Enter the code from your authenticator app.";
    case "wrong_code":
      return "The code is wrong or has expired.";
    case "too_many_attempts_request_new_code":
    case "account_temporarily_locked":
      return "Too many wrong codes. Wait a few minutes and try again.";
    default:
      return describeError(error);
  }
};

const VerifyForm = ({
  hasSecondStep,
  onDone,
  onCancel,
}: {
  hasSecondStep: boolean;
  onDone: () => void;
  onCancel: () => void;
}) => {
  const client = useQueryClient();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);

  const finish = async () => {
    await client.invalidateQueries({ queryKey: keys.me });
    onDone();
  };

  const submit = async () => {
    if (password === "") {
      setFailure("Enter your password.");
      return;
    }
    if (hasSecondStep && code.trim() === "") {
      setFailure("Enter the code from your authenticator app.");
      return;
    }
    setIsBusy(true);
    setFailure(undefined);
    try {
      await reverify(password, code);
      await finish();
    } catch (error) {
      setFailure(failureOf(error));
      setIsBusy(false);
    }
  };

  const withPasskey = async () => {
    setIsBusy(true);
    setFailure(undefined);
    try {
      await signInWithPasskey();
      await finish();
    } catch (error) {
      setFailure(failureOf(error));
      setIsBusy(false);
    }
  };

  return (
    <Layout
      header={<DialogHeader title="Verify it is you" onOpenChange={onCancel} />}
      content={
        <LayoutContent>
          <VStack gap={4}>
            {failure === undefined ? null : (
              <Banner status="error" title={failure} container="card" />
            )}
            <TextInput
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              onEnter={() => void submit()}
              autoComplete="current-password"
              hasAutoFocus
            />
            {hasSecondStep ? (
              <TextInput
                label="Authenticator code"
                value={code}
                onChange={setCode}
                onEnter={() => void submit()}
                inputMode="numeric"
                autoComplete="one-time-code"
                hasAutoCorrect={false}
              />
            ) : null}
            {canUsePasskeys() ? (
              <HStack>
                <Button
                  label="Use a passkey"
                  variant="secondary"
                  icon={<Icon icon={KeyRound} size="sm" />}
                  isDisabled={isBusy}
                  onClick={() => void withPasskey()}
                />
              </HStack>
            ) : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" variant="secondary" onClick={onCancel} />
            <Button
              label="Verify"
              variant="primary"
              isLoading={isBusy}
              onClick={() => void submit()}
            />
          </HStack>
        </LayoutFooter>
      }
    />
  );
};

let verifyCount = 0;

/**
 * The step-up dialog (PRD §6). Mounted once around the Dashboard's pages, it answers every request
 * the server refuses with `verification_required` (api/stepUp.ts): the person verifies with the
 * password, plus the authenticator code when two-step verification is on, or with a passkey, and
 * the refused request then runs again. Cancel lets the refusal stand.
 */
export const StepUpDialog = () => {
  const me = useMe();
  const [isOpen, setIsOpen] = useState(false);
  const [formKey, setFormKey] = useState("verify-0");
  const resolve = useRef<(verified: boolean) => void>(undefined);

  useEffect(
    () =>
      setStepUpHandler(
        () =>
          new Promise<boolean>((done) => {
            resolve.current = done;
            verifyCount += 1;
            setFormKey(`verify-${verifyCount}`);
            setIsOpen(true);
          }),
      ),
    [],
  );

  const close = (verified: boolean) => {
    setIsOpen(false);
    resolve.current?.(verified);
    resolve.current = undefined;
  };

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(isOpenNow) => {
        if (!isOpenNow) {
          close(false);
        }
      }}
      purpose="form"
      width={420}
    >
      <VerifyForm
        key={formKey}
        hasSecondStep={me.data?.twoFactorEnabled === true}
        onDone={() => close(true)}
        onCancel={() => close(false)}
      />
    </Dialog>
  );
};
