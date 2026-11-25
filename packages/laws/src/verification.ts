import bend, { type BendEffect, type BendLevel } from "./compiled/verification.mjs";

/**
 * What a management action does:
 * - `read`: reads, and changes nothing.
 * - `change`: changes records in a way that is easy to undo, such as a display name or a new Mount.
 * - `end-self`: ends this browser's own session.
 * - `destroy`: deletes or overwrites data: files, folders, Mounts, backends, another client's lock.
 * - `credential`: creates, changes or removes a credential: the password, the username, two-step
 *   verification, passkeys, API Keys, other devices' sessions, a backend's secrets.
 * - `disclose`: takes the instance's data out, as an export does, or puts another instance's in.
 */
export type ActionEffect = "read" | "change" | "end-self" | "destroy" | "credential" | "disclose";

export const ACTION_EFFECTS: readonly ActionEffect[] = [
  "read",
  "change",
  "end-self",
  "destroy",
  "credential",
  "disclose",
];

/**
 * What the person must do first: nothing, confirm in a dialog (the server does not check), or
 * prove presence again within the last few minutes (step-up).
 */
export type VerificationLevel = "none" | "confirm" | "step-up";

const EFFECTS: Record<ActionEffect, BendEffect> = {
  read: { $: "EffRead" },
  change: { $: "EffChange" },
  "end-self": { $: "EffEndSelf" },
  destroy: { $: "EffDestroy" },
  credential: { $: "EffCredential" },
  disclose: { $: "EffDisclose" },
};

const LEVELS: Record<BendLevel["$"], VerificationLevel> = {
  LNone: "none",
  LConfirm: "confirm",
  LStepUp: "step-up",
};

/** The level an action of this effect asks for. */
export const verificationLevel = (effect: ActionEffect): VerificationLevel =>
  LEVELS[bend.level(EFFECTS[effect]).$];

/** Whether an action may run, given whether the session proved presence within the window. */
export const verificationPermits = (effect: ActionEffect, fresh: boolean): boolean =>
  bend.permits(EFFECTS[effect], fresh);
