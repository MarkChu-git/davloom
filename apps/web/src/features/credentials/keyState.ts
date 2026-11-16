import type { Credential } from "../sample-data/data";

export type KeyState = "active" | "expired" | "revoked";

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
  if (credential.expiresAt !== null && Date.parse(credential.expiresAt) <= now.getTime()) {
    return "expired";
  }
  return "active";
};
