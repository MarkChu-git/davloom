import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { HStack } from "@astryxdesign/core/Layout";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { changeEmail, updateProfile } from "../api/account";
import { describeError } from "../api/client";
import { keys, useMe, type User } from "../api/queries";
import { LoadingRows, QueryState } from "../shell/QueryState";

const EMAIL = /^[^\s@]+@[^\s@]+$/;
const USERNAME = /^[a-zA-Z0-9_.]{3,30}$/;

interface Problems {
  name?: string;
  username?: string;
  email?: string;
}

/** The empty profile the prerendered frame shows its fields with. */
const FRAME_USER: User = {
  id: "",
  name: "",
  username: null,
  email: null,
  twoFactorEnabled: false,
  verifiedAt: 0,
};

/**
 * The profile's fields. In the prerendered frame (`isFrame`) they start empty and carry slots the
 * script in the page's head (features/frame/fill.ts) writes the profile into as soon as the API
 * answers, before the page's code has loaded.
 */
const ProfileForm = ({ user, isFrame = false }: { user: User; isFrame?: boolean }) => {
  const slot = (name: string) => (isFrame ? { "data-frame-slot": `profile-${name}` } : {});
  const toast = useToast();
  const client = useQueryClient();
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [problems, setProblems] = useState<Problems>({});
  const [failure, setFailure] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    const next: Problems = {
      name:
        name.trim() === ""
          ? "Enter the name Davloom should call you."
          : name.trim().length > 100
            ? "Use at most 100 characters."
            : undefined,
      username:
        username.trim() === "" && user.username === null
          ? undefined
          : USERNAME.test(username.trim())
            ? undefined
            : "Use 3 to 30 letters, digits, dots or underscores.",
      email:
        email.trim() === "" && user.email === null
          ? undefined
          : EMAIL.test(email.trim())
            ? undefined
            : "Enter an email address, such as you@example.com.",
    };
    setProblems(next);
    setFailure(undefined);
    if (Object.values(next).some((problem) => problem !== undefined)) {
      return;
    }
    setIsSaving(true);
    try {
      const nameChanged = name.trim() !== user.name;
      const usernameChanged = username.trim() !== "" && username.trim() !== user.username;
      // A new username or email changes how the owner signs in: the server asks for step-up.
      if (nameChanged || usernameChanged) {
        await updateProfile({
          name: name.trim(),
          ...(usernameChanged ? { username: username.trim() } : {}),
        });
      }
      if (email.trim() !== "" && email.trim() !== user.email) {
        await changeEmail(email.trim());
      }
      await client.invalidateQueries({ queryKey: keys.me });
      toast({ body: "Profile saved." });
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {failure === undefined ? null : <Banner status="error" title={failure} container="card" />}
      <FormLayout>
        <TextInput
          label="Display name"
          value={name}
          onChange={(value) => {
            setName(value);
            setProblems((current) => ({ ...current, name: undefined }));
          }}
          onEnter={() => void save()}
          autoComplete="name"
          {...slot("name")}
          // Spell check would mark most names as mistakes.
          hasSpellCheck={false}
          status={
            problems.name === undefined ? undefined : { type: "error", message: problems.name }
          }
        />
        <TextInput
          label="Username"
          value={username}
          onChange={(value) => {
            setUsername(value);
            setProblems((current) => ({ ...current, username: undefined }));
          }}
          onEnter={() => void save()}
          autoComplete="username"
          {...slot("username")}
          autoCapitalize="none"
          hasAutoCorrect={false}
          hasSpellCheck={false}
          status={
            problems.username === undefined
              ? undefined
              : { type: "error", message: problems.username }
          }
        />
        <TextInput
          label="Email"
          type="email"
          isOptional
          value={email}
          onChange={(value) => {
            setEmail(value);
            setProblems((current) => ({ ...current, email: undefined }));
          }}
          onEnter={() => void save()}
          autoComplete="email"
          {...slot("email")}
          autoCapitalize="none"
          hasSpellCheck={false}
          status={
            problems.email === undefined ? undefined : { type: "error", message: problems.email }
          }
        />
      </FormLayout>
      <HStack>
        <Button
          label="Save profile"
          variant="primary"
          isLoading={isSaving}
          onClick={() => void save()}
        />
      </HStack>
    </>
  );
};

/** Settings > Profile: the display name, the username and the email, saved through Better Auth. */
export const ProfileContent = () => {
  const me = useMe();
  if (import.meta.env.SSR) return <ProfileForm user={FRAME_USER} isFrame />;
  return (
    <QueryState query={me} title="Cannot read the profile" loading={<LoadingRows rows={3} />}>
      {(user) => <ProfileForm key={user.id} user={user} />}
    </QueryState>
  );
};
