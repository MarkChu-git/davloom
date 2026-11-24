import bend from "./compiled/copying.mjs";

/** What the source holds at a path. */
export type CopySource = "file" | "folder";
/** What the target holds at the same path; a file is the same when its size and SHA-256 match. */
export type CopyTarget = "absent" | "same" | "differs" | "folder";
export type CopyAction = "create" | "write" | "skip" | "conflict";

const SOURCES = { file: { $: "SFile" }, folder: { $: "SFolder" } } as const;
const TARGETS = {
  absent: { $: "TAbsent" },
  same: { $: "TSame" },
  differs: { $: "TDiffers" },
  folder: { $: "TFolder" },
} as const;
const ACTIONS = { Create: "create", Write: "write", Skip: "skip", Conflict: "conflict" } as const;

/**
 * The action a migration takes for one entry (the laws copy_writes_safely, copy_skips_what_is_there
 * and copy_action_exact): it never writes over a collection, or over a different file unless asked
 * to overwrite, and changes nothing where the target holds the entry already.
 */
export const decideMigration = (
  source: CopySource,
  target: CopyTarget,
  overwrite: boolean,
): CopyAction => ACTIONS[bend.decide(SOURCES[source], TARGETS[target], overwrite).$];
