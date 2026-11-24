import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3_TARGETS, type S3Deployment } from "./s3-targets";
import { BUG_MODES, CASES, FAULT_MODES, send, STORE_FAILED, WORLD, type Answer } from "./s3-world";

// A store that fails every request, in each way an S3-compatible store or the network between can
// fail, against one WebDAV request of each method: Davloom must answer that its store failed (503,
// or 502 or 504), never 2xx, 404 or 403 for a name that exists, and leave the store as it was. A
// slow store is no failure: its requests answer as they do on a store without faults.
//
// The in-memory S3 serves listings in pages of three keys, so a request that reads a collection
// reads more than one page.

const PAGE_SIZE = 3;

describe.each(S3_TARGETS)("a store outage on $name", (target) => {
  const skip = target.skip;
  let deployment: S3Deployment;
  const references = new Map<string, { answer: Answer; done: Record<string, string> }>();

  beforeAll(async () => {
    if (skip) return;
    deployment = await target.start({ pageSize: PAGE_SIZE });
    // What each request answers and leaves behind on a store without faults.
    for (const kase of CASES) {
      await deployment.store.reset(WORLD);
      deployment.proxy.setRules([]);
      const answer = await send(deployment, kase);
      references.set(kase.name, { answer, done: await deployment.store.snapshot() });
    }
  }, 180_000);
  afterAll(async () => {
    await deployment?.stop();
  });

  const rows = FAULT_MODES.flatMap((mode) =>
    CASES.map((kase) => [mode.name, kase.name, mode, kase] as const),
  );
  const run = async (
    _mode: string,
    _case: string,
    mode: (typeof rows)[number][2],
    kase: (typeof rows)[number][3],
  ) => {
    const reference = references.get(kase.name);
    if (!reference) throw new Error(`no reference for ${kase.name}`);
    await deployment.store.reset(WORLD);
    deployment.proxy.setRules([{ fault: mode.fault }]);
    const answer = await send(deployment, kase);
    deployment.proxy.setRules([]);
    const after = await deployment.store.snapshot();
    if (mode.passes) {
      expect(answer.status, "the status without a fault").toBe(reference.answer.status);
      if (kase.method === "GET") expect(answer.body).toBe(reference.answer.body);
      expect(after).toEqual(reference.done);
      return;
    }
    expect(
      STORE_FAILED,
      `${kase.method} answered ${answer.status} (${reference.answer.status} without a fault)`,
    ).toContain(answer.status);
    expect(after, "the store after the request").toEqual(WORLD);
  };

  it.skipIf(skip).each(rows.filter((row) => !BUG_MODES.has(row[0])))(
    "%s, %s",
    { timeout: 60_000 },
    run,
  );
  // Each fails until the bug that BUG_MODES names is fixed; then it belongs in the table above.
  (skip ? it.skip : it.fails).each(rows.filter((row) => BUG_MODES.has(row[0])))(
    "%s, %s (known bug)",
    { timeout: 60_000 },
    run,
  );
});
