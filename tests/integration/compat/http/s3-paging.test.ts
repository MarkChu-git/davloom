import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FaultRule } from "./s3-proxy";
import { S3_TARGETS, type S3Deployment, type S3Target } from "./s3-targets";
import { modeNamed, STORE_FAILED, type FaultMode } from "./s3-world";

// A collection with more keys than one listing page holds. PROPFIND with Depth 1 lists every
// member, DELETE removes every key, and COPY and MOVE carry every key, or refuse with 403 and
// change nothing when the collection has more objects than one request may touch (PRD §5). When a
// later page of a listing fails, each of them fails with 503 and changes nothing: a listing that
// ends early must never pass for the whole collection.
//
// On the in-memory S3 the pages are small, and also as large as S3's, 1,000 keys, with 1,100 files;
// RustFS keeps S3's page of 1,000 keys, so it gets the 1,100 files.

interface Variant {
  readonly name: string;
  readonly files: number;
  /** The in-memory store's page size; RustFS's own when absent. */
  readonly pageSize?: number;
}

const variantsOf = (target: S3Target): Variant[] => {
  if (!target.memory) return [{ name: "1,100 files in pages of 1,000", files: 1100 }];
  // Workers lets one COPY or MOVE touch 30 objects, which the 27 of this collection fit.
  if (target.name.startsWith("Workers"))
    return [{ name: "22 files in pages of 4", files: 22, pageSize: 4 }];
  return [
    { name: "60 files in pages of 7", files: 60, pageSize: 7 },
    { name: "1,100 files in pages of 1,000", files: 1100, pageSize: 1000 },
  ];
};

const SUB_FILES = ["sub/x.txt", "sub/y.txt", "sub/z.txt"];

/** The keys of the collection `big/`: its marker, its files, and a collection of three files. */
const treeOf = (files: number, base = "big/"): [string, string][] => [
  [base, ""],
  ...Array.from({ length: files }, (_, index): [string, string] => {
    const name = `f${String(index).padStart(4, "0")}.txt`;
    return [`${base}${name}`, `file ${index}`];
  }),
  [`${base}sub/`, ""],
  ...SUB_FILES.map((name): [string, string] => [`${base}${name}`, `${name} content`]),
];

const sortKeys = (keys: readonly string[]) =>
  keys.toSorted((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));

const hrefsOf = (xml: string) =>
  [...xml.matchAll(/<(?:[\w-]+:)?href>([^<]*)<\/(?:[\w-]+:)?href>/g)].map((match) =>
    decodeURIComponent(match[1] ?? ""),
  );

const OPERATIONS = ["PROPFIND depth 1", "DELETE", "COPY", "MOVE"] as const;
type Operation = (typeof OPERATIONS)[number];

/** Sends one of the operations to the collection `big/`. */
const sendTo = async (deployment: S3Deployment, operation: Operation) => {
  const { davloom, mount } = deployment;
  const destination = (name: string) => ({
    destination: `${davloom.server.url}/dav${mount}/${name}/`,
  });
  const init: Record<Operation, RequestInit> = {
    "PROPFIND depth 1": { method: "PROPFIND", headers: { depth: "1" } },
    DELETE: { method: "DELETE" },
    COPY: { method: "COPY", headers: destination("big-copy") },
    MOVE: { method: "MOVE", headers: destination("big-moved") },
  };
  const response = await davloom.dav(`${mount}/big/`, init[operation]);
  return { status: response.status, body: await response.text() };
};

type Shape = [name: string, rules: (mode: FaultMode) => FaultRule[]];

/** Faults the later pages of listings from the nth such request on. */
const laterPages =
  (from: number) =>
  ({ fault }: FaultMode): FaultRule[] => [{ query: ["continuation-token"], from, fault }];

// A later page that fails with a 400 without a code must fail the request too, not end the
// listing as if it were the last.
const FAULTS = [
  "400 with an empty body",
  "400 with an error without a Code",
  "403 AccessDenied",
  "503 with an empty body",
  "a reset connection",
].map(modeNamed);

describe.each(S3_TARGETS)("listings of many pages on $name", (target) => {
  let deployment: S3Deployment;
  beforeAll(async () => {
    if (target.skip) return;
    deployment = await target.start();
  }, 180_000);
  afterAll(async () => {
    await deployment?.stop();
  });

  describe.each(variantsOf(target))("with $name", (variant) => {
    const tree = treeOf(variant.files);
    const treeKeys = sortKeys(tree.map(([key]) => key));
    // Its objects, all of which a COPY or MOVE touches.
    const fits = () => tree.length <= deployment.maxEntries;

    /** Puts the collection back as it was, only where it is not. */
    const restore = async () => {
      deployment.proxy.setRules([]);
      if (deployment.proxy.memory && variant.pageSize !== undefined) {
        deployment.proxy.memory.pageSize = variant.pageSize;
      }
      const all = await deployment.store.keys("");
      if (JSON.stringify(all) === JSON.stringify(treeKeys)) return;
      await deployment.store.reset({});
      await deployment.store.putMany(tree);
    };

    /** Whether the store holds the collection, every key whole, and nothing else. */
    const expectUnchanged = async () => {
      expect(await deployment.store.keys("")).toEqual(treeKeys);
      if (target.memory) {
        expect(await deployment.store.snapshot()).toEqual(Object.fromEntries(tree));
      }
    };

    it.skipIf(target.skip).each(OPERATIONS)(
      "%s handles every key",
      { timeout: 120_000 },
      async (operation) => {
        await restore();
        const { status, body } = await sendTo(deployment, operation);
        if (operation === "PROPFIND depth 1") {
          expect(status).toBe(207);
          const names = hrefsOf(body).map((href) => href.replace(/^.*\/big\//, ""));
          const expected = [
            "",
            ...tree.map(([key]) => key.slice(4)).filter((n) => /^[^/]+\/?$/.test(n) && n !== ""),
          ];
          expect(names.toSorted()).toEqual(expected.toSorted());
          await expectUnchanged();
          return;
        }
        if (operation === "DELETE") {
          expect(status).toBe(204);
          expect(await deployment.store.keys("")).toEqual([]);
          return;
        }
        if (!fits()) {
          // More objects than one request may touch: refused before anything changes.
          expect(status).toBe(403);
          await expectUnchanged();
          return;
        }
        expect(status).toBe(201);
        const base = operation === "COPY" ? "big-copy/" : "big-moved/";
        const copied = sortKeys(treeKeys.map((key) => `${base}${key.slice(4)}`));
        const expected = operation === "COPY" ? sortKeys([...copied, ...treeKeys]) : copied;
        expect(await deployment.store.keys("")).toEqual(expected);
        if (target.memory) {
          const snapshot = await deployment.store.snapshot();
          for (const [key, content] of tree) {
            expect(snapshot[`${base}${key.slice(4)}`], key).toBe(content);
          }
        }
      },
    );

    // Which later pages fail: each from the second page of a listing on, or from the third or the
    // fifth page that the request asks for on. A failing page fails each time the S3 client asks.
    const pages = Math.ceil(variant.files / (variant.pageSize ?? 1000));
    const shapes: Shape[] = [
      ["every later page", laterPages(1)],
      ...(pages > 2 ? [["the third page on", laterPages(2)] satisfies Shape] : []),
      ...(pages > 4 ? [["the fifth page on", laterPages(4)] satisfies Shape] : []),
    ];
    const run = async (operation: Operation, rules: FaultRule[]) => {
      await restore();
      deployment.proxy.setRules(rules);
      const { status } = await sendTo(deployment, operation);
      const faulted = deployment.proxy.seen.filter((request) => request.fault !== null).length;
      deployment.proxy.setRules([]);
      expect(faulted, "faults injected").toBeGreaterThan(0);
      expect(STORE_FAILED, `${operation} answered ${status}`).toContain(status);
      await expectUnchanged();
    };
    const rows = shapes.flatMap(([shape, rules]) =>
      FAULTS.flatMap((mode) =>
        OPERATIONS.map((operation) => [operation, shape, mode.name, rules(mode)] as const),
      ),
    );
    it.skipIf(target.skip).each(rows)(
      "%s fails and changes nothing when %s fails with %s",
      { timeout: 120_000 },
      async (operation, _shape, _mode, rules) => {
        await run(operation, rules);
      },
    );
  });
});
