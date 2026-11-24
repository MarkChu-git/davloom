import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startWorkersWithS3, type S3Deployment } from "./s3-targets";

// The production Worker with an S3 backend, in local workerd, against the in-memory S3 that
// s3-proxy.ts serves: the store answers as S3 does, so whatever fails is the Worker's.

describe("an S3 backend on Workers", () => {
  let deployment: S3Deployment;
  beforeAll(async () => {
    deployment = await startWorkersWithS3();
  }, 120_000);
  afterAll(async () => {
    await deployment?.stop();
  });

  // Known product bug (s3-targets.ts, RUN_WORKERS_S3): the Worker bundle's AWS SDK parses XML with
  // DOMParser, which workerd lacks, so every request to an S3 Mount answers 503. When this fails,
  // the bug is fixed: make it a plain `it` and let the tables run the Workers target.
  it.fails("writes, lists and reads files", async () => {
    const { davloom, mount } = deployment;
    expect((await davloom.dav(`${mount}/a.txt`, { method: "PUT", body: "alpha" })).status).toBe(
      201,
    );
    const listed = await davloom.dav(`${mount}/`, { method: "PROPFIND", headers: { depth: "1" } });
    expect(listed.status).toBe(207);
    expect(await listed.text()).toContain("a.txt");
    const read = await davloom.dav(`${mount}/a.txt`);
    expect(read.status).toBe(200);
    expect(await read.text()).toBe("alpha");
  });
});
