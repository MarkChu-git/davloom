import { afterAll, beforeAll, describe, it } from "vitest";
import type { FaultRule } from "./s3-proxy";
import { S3_TARGETS, type S3Deployment } from "./s3-targets";
import {
  CASES,
  checkFaulted,
  modeNamed,
  referencesOf,
  type FaultMode,
  type Reference,
} from "./s3-world";

// A store that fails only some kinds of request, against one WebDAV request of each method: only
// listings, only later listing pages, only heads, only reads of objects, only writes, only copies
// or only deletes. Davloom answers as it does without a fault when the request needs none of the
// failing kind, and otherwise answers that its store failed (503, or 502 or 504). Either way the
// store holds every file whole: what it held before, or, where the request changes it, what the
// request leaves without a fault; a MOVE leaves each file at its source or its destination.

const PAGE_SIZE = 3;

const SCOPES: readonly (readonly [name: string, rules: (mode: FaultMode) => FaultRule[]])[] = [
  ["listings", ({ fault }) => [{ query: ["list-type"], fault }]],
  ["later listing pages", ({ fault }) => [{ query: ["continuation-token"], fault }]],
  ["heads", ({ fault }) => [{ method: "HEAD", fault }]],
  ["reads of objects", ({ fault }) => [{ method: "GET", key: /./, fault }]],
  ["writes and copies", ({ fault }) => [{ method: "PUT", fault }]],
  ["copies", ({ fault }) => [{ header: "x-amz-copy-source", fault }]],
  [
    "deletes",
    ({ fault }) => [
      { method: "POST", query: ["delete"], fault },
      { method: "DELETE", fault },
    ],
  ],
];

// A 400 without a code fails a request as surely as a 403 does: Davloom must not take it for a
// key the store refuses, except in answer to HEAD, where a listing confirms the refusal.
const MODES = [
  "400 with an empty body",
  "400 with an error without a Code",
  "403 AccessDenied",
  "503 with an empty body",
  "a reset connection",
].map(modeNamed);

describe.each(S3_TARGETS)("faults of some requests on $name", (target) => {
  let deployment: S3Deployment;
  let references = new Map<string, Reference>();

  beforeAll(async () => {
    if (target.skip) return;
    deployment = await target.start({ pageSize: PAGE_SIZE });
    references = await referencesOf(deployment, CASES);
  }, 180_000);
  afterAll(async () => {
    await deployment?.stop();
  });

  const rows = SCOPES.flatMap(([scope, rules]) =>
    MODES.flatMap((mode) =>
      CASES.map((kase) => [scope, mode.name, kase.name, rules(mode), kase] as const),
    ),
  );
  it.skipIf(target.skip).each(rows)(
    "%s fail with %s: %s",
    { timeout: 60_000 },
    async (_scope, _mode, _case, rules, kase) => {
      const reference = references.get(kase.name);
      if (!reference) throw new Error(`no reference for ${kase.name}`);
      await checkFaulted(deployment, kase, reference, rules);
    },
  );
});
