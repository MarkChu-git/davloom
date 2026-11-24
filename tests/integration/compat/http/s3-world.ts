import { expect } from "vitest";
import { basic } from "./davloom";
import type { Fault, FaultRule } from "./s3-proxy";
import type { S3Deployment } from "./s3-targets";

// What the fault tables share: a small tree in the S3 bucket, the WebDAV requests they send to it,
// the faults they inject, and the checks of what a request that met a fault left in the store.

/** The tree every case starts from, by key; a key ending at `/` is a collection's marker. */
export const WORLD: Readonly<Record<string, string>> = {
  "w/": "",
  "w/top.txt": "the top file",
  "w/lock.txt": "a file to lock",
  "w/docs/": "",
  "w/docs/a.txt": "alpha",
  "w/docs/b.txt": "bravo bravo",
  "w/docs/c.txt": "charlie charlie charlie",
  "w/docs/d.txt": "delta",
  "w/docs/sub/": "",
  "w/docs/sub/e.txt": "echo",
  "w/docs/sub/f.txt": "foxtrot",
};

export interface DavCase {
  readonly name: string;
  readonly method: string;
  /** The path under the Mount. */
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** The Destination under the Mount, for COPY and MOVE. */
  readonly destination?: string;
  /** For a MOVE: the source's key and the destination's, so a file may be found at either. */
  readonly moves?: readonly [from: string, to: string];
  /** For a DELETE: the request may remove the keys under this one. */
  readonly deletes?: string;
}

const LOCK_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>fault table</D:owner></D:lockinfo>';

/** One request of each WebDAV method on names that exist, and on new names where that matters. */
export const CASES: readonly DavCase[] = [
  { name: "GET a file", method: "GET", path: "/w/docs/a.txt" },
  { name: "GET a range", method: "GET", path: "/w/docs/c.txt", headers: { range: "bytes=2-9" } },
  { name: "HEAD a file", method: "HEAD", path: "/w/docs/b.txt" },
  { name: "PUT over a file", method: "PUT", path: "/w/top.txt", body: "the new top file" },
  { name: "PUT a new file", method: "PUT", path: "/w/new.txt", body: "a new file" },
  { name: "PUT into a collection", method: "PUT", path: "/w/docs/sub/g.txt", body: "golf" },
  {
    name: "PROPFIND depth 0 on a file",
    method: "PROPFIND",
    path: "/w/top.txt",
    headers: { depth: "0" },
  },
  {
    name: "PROPFIND depth 0 on a collection",
    method: "PROPFIND",
    path: "/w/docs/",
    headers: { depth: "0" },
  },
  {
    name: "PROPFIND depth 1 on a collection",
    method: "PROPFIND",
    path: "/w/docs/",
    headers: { depth: "1" },
  },
  { name: "PROPFIND depth 1 on the Mount", method: "PROPFIND", path: "/", headers: { depth: "1" } },
  { name: "MKCOL on a collection", method: "MKCOL", path: "/w/docs/" },
  { name: "MKCOL on a new name", method: "MKCOL", path: "/w/fresh/" },
  { name: "DELETE a file", method: "DELETE", path: "/w/top.txt", deletes: "w/top.txt" },
  { name: "DELETE a collection", method: "DELETE", path: "/w/docs/", deletes: "w/docs/" },
  { name: "COPY a file", method: "COPY", path: "/w/top.txt", destination: "/w/copy.txt" },
  { name: "COPY a collection", method: "COPY", path: "/w/docs/", destination: "/w/docs-copy/" },
  {
    name: "COPY a collection over a file",
    method: "COPY",
    path: "/w/docs/sub/",
    destination: "/w/top.txt",
    headers: { overwrite: "T" },
    deletes: "w/top.txt",
  },
  {
    name: "MOVE a file",
    method: "MOVE",
    path: "/w/top.txt",
    destination: "/w/moved.txt",
    moves: ["w/top.txt", "w/moved.txt"],
  },
  {
    name: "MOVE a collection",
    method: "MOVE",
    path: "/w/docs/",
    destination: "/w/docs-moved/",
    moves: ["w/docs/", "w/docs-moved/"],
  },
  {
    name: "LOCK a file",
    method: "LOCK",
    path: "/w/lock.txt",
    headers: { depth: "0", timeout: "Second-60", "content-type": "application/xml" },
    body: LOCK_BODY,
  },
];

/** The cases that change more than one object in the store. */
export const MULTI_OBJECT = new Set([
  "DELETE a collection",
  "COPY a collection",
  "COPY a collection over a file",
  "MOVE a collection",
  "MOVE a file",
  "COPY a file",
  "PUT over a file",
]);

export interface Answer {
  readonly status: number;
  readonly body: string;
  readonly headers: Headers;
}

/** Sends a case, reads its answer whole, and lifts a lock it took. */
export const send = async (deployment: S3Deployment, kase: DavCase): Promise<Answer> => {
  const { davloom, mount } = deployment;
  const headers: Record<string, string> = { ...kase.headers };
  if (kase.destination) {
    headers.destination = `${davloom.server.url}/dav${mount}${kase.destination}`;
  }
  const response = await davloom.dav(`${mount}${kase.path}`, {
    method: kase.method,
    headers,
    body: kase.body,
  });
  const body = await response.text();
  const token = response.headers.get("lock-token");
  if (token) {
    await davloom.server.fetch(`/dav${mount}${kase.path}`, {
      method: "UNLOCK",
      headers: { authorization: basic(davloom.readWriteKey), "lock-token": token },
    });
  }
  return { status: response.status, body, headers: response.headers };
};

/** The statuses with which Davloom may report that its store failed. */
export const STORE_FAILED = [502, 503, 504];

export interface FaultMode {
  readonly name: string;
  readonly fault: Fault;
  /** Whether the request still succeeds, as a slow store's do. */
  readonly passes?: boolean;
}

export const FAULT_MODES: readonly FaultMode[] = [
  { name: "400 with an empty body", fault: { kind: "status", status: 400, body: "empty" } },
  {
    name: "400 RequestTimeout",
    fault: { kind: "status", status: 400, body: "xml", code: "RequestTimeout" },
  },
  { name: "400 with an error without a Code", fault: { kind: "status", status: 400, body: "xml" } },
  {
    name: "403 AccessDenied",
    fault: { kind: "status", status: 403, body: "xml", code: "AccessDenied" },
  },
  { name: "403 with an empty body", fault: { kind: "status", status: 403, body: "empty" } },
  {
    name: "500 InternalError",
    fault: { kind: "status", status: 500, body: "xml", code: "InternalError" },
  },
  { name: "503 with an empty body", fault: { kind: "status", status: 503, body: "empty" } },
  { name: "a reset connection", fault: { kind: "reset" } },
  { name: "a slow store", fault: { kind: "slow", ms: 30 }, passes: true },
];

export const modeNamed = (name: string): FaultMode => {
  const mode = FAULT_MODES.find((candidate) => candidate.name === name);
  if (!mode) throw new Error(`no fault mode ${name}`);
  return mode;
};

/**
 * What a request that met a fault may leave in the store, given the tree before it (`before`)
 * and the tree the same request leaves without a fault (`done`):
 *
 * - every key holds what it held before or what it holds when the request succeeds, whole;
 * - a key that the request keeps is still there;
 * - a key that a MOVE takes away is at its source or, whole, at its destination;
 * - only a DELETE, or a COPY that replaces its destination, removes a key for good.
 *
 * Returns what broke these rules; empty when nothing did.
 */
export const lossesOf = (
  kase: DavCase,
  before: Readonly<Record<string, string>>,
  done: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): string[] => {
  const broken: string[] = [];
  for (const [key, content] of Object.entries(after)) {
    if (content !== before[key] && content !== done[key]) {
      broken.push(`${key} holds ${JSON.stringify(content)}, which neither tree has there`);
    }
  }
  for (const [key, content] of Object.entries(before)) {
    if (key in after) continue;
    if (key in done) {
      broken.push(`${key} is gone, though the request keeps it`);
      continue;
    }
    if (kase.deletes !== undefined && key.startsWith(kase.deletes)) continue;
    const [from, to] = kase.moves ?? [];
    if (from !== undefined && to !== undefined && key.startsWith(from)) {
      if (after[`${to}${key.slice(from.length)}`] === content) continue;
      broken.push(`${key} is neither at its source nor at its destination`);
      continue;
    }
    broken.push(`${key} is gone`);
  }
  return broken;
};

export interface Reference {
  readonly answer: Answer;
  readonly done: Record<string, string>;
  /** How many requests the store got. */
  readonly requests: number;
}

/** Checks what a request that met `rules` answered and left in the store. */
export const checkFaulted = async (
  deployment: S3Deployment,
  kase: DavCase,
  reference: Reference,
  rules: readonly FaultRule[],
): Promise<{ readonly answer: Answer; readonly faulted: number }> => {
  await deployment.store.reset(WORLD);
  deployment.proxy.setRules(rules);
  const answer = await send(deployment, kase);
  const faulted = deployment.proxy.seen.filter((request) => request.fault !== null).length;
  deployment.proxy.setRules([]);
  const after = await deployment.store.snapshot();
  const context = `${kase.method} answered ${answer.status} (${reference.answer.status} without a fault) after ${faulted} faults`;
  expect([...STORE_FAILED, reference.answer.status], context).toContain(answer.status);
  if (!STORE_FAILED.includes(answer.status)) {
    // An answer of success is the whole success.
    if (kase.method === "GET") expect(answer.body, context).toBe(reference.answer.body);
    expect(after, context).toEqual(reference.done);
  } else {
    expect(lossesOf(kase, WORLD, reference.done, after), context).toEqual([]);
  }
  return { answer, faulted };
};

/** Runs each case once on a store without faults, for what it answers and leaves behind. */
export const referencesOf = async (deployment: S3Deployment, cases: readonly DavCase[]) => {
  const references = new Map<string, Reference>();
  for (const kase of cases) {
    await deployment.store.reset(WORLD);
    deployment.proxy.setRules([]);
    const answer = await send(deployment, kase);
    const requests = deployment.proxy.seen.length;
    references.set(kase.name, { answer, done: await deployment.store.snapshot(), requests });
  }
  return references;
};
