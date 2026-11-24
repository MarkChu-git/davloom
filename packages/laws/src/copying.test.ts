import { describe, expect, it } from "vitest";
import { decideMigration, type CopyAction, type CopySource, type CopyTarget } from "./copying";

// Every combination, against the rule written out once more here.
const oracle = (source: CopySource, target: CopyTarget, overwrite: boolean): CopyAction => {
  if (source === "folder")
    return target === "absent" ? "create" : target === "folder" ? "skip" : "conflict";
  if (target === "absent") return "write";
  if (target === "same") return "skip";
  if (target === "differs") return overwrite ? "write" : "conflict";
  return "conflict";
};

const ROWS = (["file", "folder"] as const).flatMap((source) =>
  (["absent", "same", "differs", "folder"] as const).flatMap((target) =>
    [false, true].map((overwrite) => [source, target, overwrite] as const),
  ),
);

describe("decideMigration", () => {
  it.each(ROWS)("a %s over %s, overwrite %s", (source, target, overwrite) => {
    expect(decideMigration(source, target, overwrite)).toBe(oracle(source, target, overwrite));
  });
});
