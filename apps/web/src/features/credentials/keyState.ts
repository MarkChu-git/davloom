import type { Credential } from "../sample-data/data";

export type KeyState = "active" | "expired" | "revoked";

/** Whether a key's expiry time has come, whether or not it was revoked first. */
export const hasExpired = (credential: Pick<Credential, "expiresAt">, now: Date): boolean =>
  credential.expiresAt !== null && Date.parse(credential.expiresAt) <= now.getTime();

/**
 * Stands in for Better Auth's credential expiry and revocation (PRD §6, design.md Decision 2):
 * a revoked key stays revoked, and any other key expires at its expiry time.
 */
export const keyStateOf = (
  credential: Pick<Credential, "isRevoked" | "expiresAt">,
  now: Date,
): KeyState => {
  if (credential.isRevoked) {
    return "revoked";
  }
  if (hasExpired(credential, now)) {
    return "expired";
  }
  return "active";
};
