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
