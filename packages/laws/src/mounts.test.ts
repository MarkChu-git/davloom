import { describe, expect, it } from "vitest";
import {
  mountRoute,
  mountTransfer,
  type MountOp,
  type MountRoute,
  type MountWhere,
} from "./mounts";

const WHERE: readonly MountWhere[] = [
  "root",
  "unknown-top",
  "unknown-deep",
  "mount-root",
  "inside",
];
const OPS: readonly MountOp[] = [
  "stat",
  "list",
  "read",
  "write",
  "mkcol",
  "remove",
  "patch",
  "quota",
];

// core/src/mounts.ts as it decided before the decision moved to Bend.
const outside = (w: MountWhere): MountRoute =>
  w === "root" || w === "unknown-top" ? "root" : "no-parent";
const mounted = (w: MountWhere) => w === "mount-root" || w === "inside";
const oracle = (op: MountOp, w: MountWhere): MountRoute => {
  switch (op) {
    case "stat":
    case "list":
      return w === "root" ? "virtual" : mounted(w) ? "delegate" : "not-found";
    case "read":
      return w === "root" ? "is-collection" : mounted(w) ? "delegate" : "not-found";
    case "write":
      return !mounted(w) ? outside(w) : w === "mount-root" ? "is-collection" : "delegate";
    case "mkcol":
      return w === "root" || w === "mount-root" ? "exists" : !mounted(w) ? outside(w) : "delegate";
    case "remove":
      return !mounted(w)
        ? w === "unknown-deep"
          ? "not-found"
          : "root"
        : w === "mount-root"
          ? "root"
          : "delegate";
    case "patch":
      return w === "root" ? "root" : mounted(w) ? "delegate" : "not-found";
    default:
      return w === "root" ? "not-collection" : mounted(w) ? "delegate" : "not-found";
  }
};
const transferOracle = (
  from: MountWhere,
  to: MountWhere,
  move: boolean,
  same: boolean,
): MountRoute => {
  if (!mounted(from)) return from === "root" ? (move ? "root" : "into-itself") : "not-found";
  if (!mounted(to)) return "root";
  if ((move && from === "mount-root") || to === "mount-root") return "root";
  return same ? "delegate" : "cross-backend";
};

describe("routes in the namespace of Mounts", () => {
  for (const op of OPS)
    for (const where of WHERE)
      it(`${op} at ${where}: ${oracle(op, where)}`, () => {
        expect(mountRoute(op, where)).toBe(oracle(op, where));
      });
});

describe("copies and moves between Mounts", () => {
  for (const from of WHERE)
    for (const to of WHERE)
      for (const move of [false, true])
        for (const same of [false, true])
          it(`${move ? "move" : "copy"} ${from} to ${to}, same backend ${same}`, () => {
            expect(mountTransfer(from, to, move, same)).toBe(transferOracle(from, to, move, same));
          });
});
