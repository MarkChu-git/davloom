import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSmoke } from "../../../../scripts/smoke";
import { startDavloom, startWorkersServer, type Davloom } from "./davloom";
import { hasDocker, startSelfHostedServer } from "./selfhosted";
import type { Server } from "./servers";

// The release smoke test (PRD §15, scripts/smoke.ts) against both deployments, as a release runs
// it against the real ones: Workers with D1 and Durable Objects, and the Docker stack of Bun,
// SQLite and RustFS.

const TARGETS: [string, () => Promise<Server>, boolean][] = [
  ["Workers with D1 and Durable Objects", startWorkersServer, false],
  ["Bun with SQLite and RustFS", startSelfHostedServer, !hasDocker()],
];

describe.each(TARGETS)("the smoke test on %s", (_name, start, skip) => {
  let davloom: Davloom | undefined;
  beforeAll(async () => {
    if (!skip) davloom = await startDavloom(start);
  }, 180_000);
  afterAll(async () => {
    await davloom?.server.stop();
  });

  it.skipIf(skip)("passes every check", { timeout: 60_000 }, async () => {
    if (!davloom) throw new Error("no server");
    const result = await runSmoke({ url: davloom.server.url, key: davloom.readWriteKey });
    expect(result.failed).toEqual([]);
    expect(result.passed).toHaveLength(13);
  });

  it.skipIf(skip)("fails with a Read Only key, and says where", { timeout: 60_000 }, async () => {
    if (!davloom) throw new Error("no server");
    const result = await runSmoke({ url: davloom.server.url, key: davloom.readOnlyKey });
    expect(result.failed.map((f) => f.check)).toContain("creates a folder");
  });
});
