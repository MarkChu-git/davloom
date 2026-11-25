import type { ApiKey } from "../api/queries";
import type { Translator } from "../i18n/translate";

export type KeyState = "active" | "expired" | "disabled";

/** Whether a key's expiry time has come, whether or not it was turned off first. */
export const hasExpired = (key: Pick<ApiKey, "expiresAt">, now: Date): boolean =>
  key.expiresAt !== null && Date.parse(key.expiresAt) <= now.getTime();

/**
 * What a key can do now, as the server's credential check decides it: a key that is turned off
 * stays off, and any other key stops working at its expiry time.
 */
export const keyStateOf = (key: Pick<ApiKey, "enabled" | "expiresAt">, now: Date): KeyState => {
  if (!key.enabled) {
    return "disabled";
  }
  if (hasExpired(key, now)) {
    return "expired";
  }
  return "active";
};

/** The Mount choice that leaves a key unlimited: no Mount name holds a slash. */
export const ALL_MOUNTS = "/";

/**
 * The roots a new key is limited to, from the Mount and the folder inside it chosen in the form:
 * null for every mount, else the Mount or the folder. Slashes are normalized and spaces around a
 * name dropped; a `.` or `..` is refused, so a scope never reaches outside its Mount.
 */
export const scopeOf = (
  t: Translator,
  mount: string,
  folder: string,
): { paths: string[] | null } | { problem: string } => {
  if (mount === ALL_MOUNTS) {
    return { paths: null };
  }
  const names = folder
    .split("/")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  if (names.some((name) => name === "." || name === "..")) {
    return { problem: t("keys.folderDots") };
  }
  return { paths: [`/${[mount, ...names].join("/")}`] };
};

/** How a key's scope reads in the list. */
export const reachOf = (t: Translator, paths: readonly string[] | null): string =>
  paths === null
    ? t("keys.allMounts")
    : paths.length === 0
      ? t("keys.reachNothing")
      : paths.join(t("keys.pathSeparator"));
