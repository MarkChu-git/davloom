import type { ApiKey } from "../api/queries";

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

/**
 * Reads the folders a new key is limited to, one per comma or line, such as "/files/photos";
 * an empty field limits nothing. Returns why the text cannot be used, or the folders.
 */
export const parseFolders = (text: string): { folders: string[] } | { problem: string } => {
  const folders = text
    .split(/[,\n]/)
    .map((folder) => folder.trim())
    .filter((folder) => folder !== "")
    .map(
      (folder) =>
        `/${folder
          .split("/")
          .filter((name) => name !== "")
          .join("/")}`,
    );
  if (folders.some((folder) => folder === "/")) {
    return { problem: "Name a mount or a folder inside one, such as /files/photos." };
  }
  if (folders.some((folder) => folder.split("/").some((name) => name === "." || name === ".."))) {
    return { problem: "Name the folders without . or .. in their paths." };
  }
  if (folders.length > 16) {
    return { problem: "Limit a key to at most 16 folders." };
  }
  return { folders: [...new Set(folders)] };
};

/** How a key's reach reads in the list. */
export const reachOf = (paths: readonly string[] | null): string =>
  paths === null ? "Every mount" : paths.join(", ");
