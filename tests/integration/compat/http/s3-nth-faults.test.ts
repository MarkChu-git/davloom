import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3_TARGETS, type S3Deployment } from "./s3-targets";
import {
  CASES,
  checkFaulted,
  modeNamed,
  MULTI_OBJECT,
  referencesOf,
  STORE_FAILED,
  WORLD,
  type Reference,
} from "./s3-world";

// One failing request at each point of a WebDAV request: the nth request to the store fails, for
// every n up to past the last request the WebDAV request makes. A 403 fails the store request for
// good, a 500 and a reset connection make the S3 client try again, so the WebDAV request may still
// succeed; a 403 of any request the WebDAV request makes must fail it. Whatever Davloom answers, an answer of success is the whole success, any other answer
// says the store failed, and no file is lost: a DELETE, COPY or MOVE of a collection that stops
// part-way leaves every file whole at its source or its destination (s3-world.ts, lossesOf).
//
// With listings in pages of three keys, the WebDAV requests of the table make up to 22 store
// requests; those that change more than one object are swept up to 24, the others up to 10.

const PAGE_SIZE = 3;
const LONG_SWEEP = 24;
const SHORT_SWEEP = 10;

const MODES = ["403 AccessDenied", "500 InternalError", "a reset connection"].map(modeNamed);

const sweepOf = (name: string) =>
  MULTI_OBJECT.has(name) || name.startsWith("PROPFIND depth 1") ? LONG_SWEEP : SHORT_SWEEP;

describe.each(S3_TARGETS)("the nth store request failing on $name", (target) => {
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

  const rows = MODES.flatMap((mode) =>
    CASES.flatMap((kase) =>
      Array.from({ length: sweepOf(kase.name) }, (_, index) => index + 1).map(
        (nth) => [kase.name, nth, mode.name, mode, kase] as const,
      ),
    ),
  );
  it.skipIf(target.skip).each(rows)(
    "%s, request %i failing with %s",
    { timeout: 60_000 },
    async (_case, nth, _mode, mode, kase) => {
      const reference = references.get(kase.name);
      if (!reference) throw new Error(`no reference for ${kase.name}`);
      const { answer, faulted } = await checkFaulted(deployment, kase, reference, [
        { nth, fault: mode.fault },
      ]);
      // A store request that fails for good fails the WebDAV request: none is ignored. PROPFIND
      // ignores a failure to read dead properties, the known bug that the test below shows.
      if (
        mode.name === "403 AccessDenied" &&
        nth <= reference.requests &&
        kase.method !== "PROPFIND"
      ) {
        expect(faulted).toBe(1);
        expect(STORE_FAILED, `answered ${answer.status}`).toContain(answer.status);
      }
    },
  );

  // Known product bug: PROPFIND (packages/webdav/src/handler.ts) reads dead properties with
  // `storage.properties`, and when that fails it answers 207 as if the entries had none, instead
  // of 503. On an object store, `properties` first checks that each entry exists with a head and a
  // listing, so a store that fails then makes a PROPFIND drop every dead property of the answer,
  // and a client that syncs properties takes them for removed.
  it.skipIf(target.skip).fails(
    "PROPFIND keeps dead properties or fails when the store fails while reading them (known bug)",
    async () => {
      const { davloom, mount, proxy, store } = deployment;
      await store.reset({ ...WORLD, "w/props.txt": "with a dead property" });
      proxy.setRules([]);
      const patched = await davloom.dav(`${mount}/w/props.txt`, {
        method: "PROPPATCH",
        headers: { "content-type": "application/xml" },
        body: PROPPATCH_TAG,
      });
      expect(patched.status).toBe(207);
      // The first head is the PROPFIND's own lookup, the second the check before the properties.
      proxy.setRules([{ method: "HEAD", nth: 2, fault: modeNamed("403 AccessDenied").fault }]);
      const found = await davloom.dav(`${mount}/w/props.txt`, {
        method: "PROPFIND",
        headers: { depth: "0" },
      });
      const body = await found.text();
      proxy.setRules([]);
      if (found.status === 207) expect(body).toContain("kept");
      else expect(STORE_FAILED).toContain(found.status);
    },
  );
});

const PROPPATCH_TAG = [
  '<?xml version="1.0"?>',
  '<D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:z">',
  "<D:set><D:prop><Z:tag>kept</Z:tag></D:prop></D:set>",
  "</D:propertyupdate>",
].join("");
