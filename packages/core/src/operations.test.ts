import { Effect, Layer } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createOperationRecorder,
  davPathOf,
  hourOf,
  HOUR_MS,
  isFailedOperation,
  isOperation,
  OperationLog,
  operationSummary,
  OPERATION_HOURS,
  type OperationBatch,
  type OperationErrorRecord,
  type OperationSample,
} from "./operations";

const sample = (overrides: Partial<OperationSample> = {}): OperationSample => ({
  at: Date.UTC(2026, 10, 24, 10, 15),
  method: "PUT",
  path: "/files/a.txt",
  destination: null,
  status: 201,
  ...overrides,
});

describe("isFailedOperation", () => {
  it.each([
    ["PUT", 201, false],
    ["GET", 200, false],
    ["GET", 206, false],
    ["GET", 304, false],
    ["PROPFIND", 207, false],
    ["GET", 404, false],
    ["HEAD", 404, false],
    ["PROPFIND", 404, false],
    ["OPTIONS", 404, false],
    ["propfind", 404, false],
    ["DELETE", 404, true],
    ["MOVE", 404, true],
    ["PUT", 401, false],
    ["PUT", 403, true],
    ["MKCOL", 405, true],
    ["PUT", 409, true],
    ["MOVE", 412, true],
    ["PUT", 413, true],
    ["PUT", 423, true],
    ["GET", 500, true],
    ["PUT", 503, true],
    ["PUT", 507, true],
  ])("%s answered %i failed: %s", (method, status, failed) => {
    expect(isFailedOperation(method, status)).toBe(failed);
  });

  it("never counts a status below 400 or a 401 as failed", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 100, max: 399 }), (method, status) => {
        expect(isFailedOperation(method, status)).toBe(false);
        expect(isFailedOperation(method, 401)).toBe(false);
      }),
    );
  });

  it("counts every 5xx as failed", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 500, max: 599 }), (method, status) => {
        expect(isFailedOperation(method, status)).toBe(true);
      }),
    );
  });

  it("leaves a 401 challenge out of the operations", () => {
    expect(isOperation(401)).toBe(false);
    expect(isOperation(200)).toBe(true);
    expect(isOperation(403)).toBe(true);
  });
});

describe("hourOf", () => {
  it("is the start of the hour, at or before the time and less than an hour before it", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e13, max: 1e13 }), (at) => {
        const hour = hourOf(at);
        expect(Math.abs(hour % HOUR_MS)).toBe(0);
        expect(hour).toBeLessThanOrEqual(at);
        expect(at - hour).toBeLessThan(HOUR_MS);
      }),
    );
  });
});

describe("davPathOf", () => {
  it.each([
    ["https://d.test/dav", "/"],
    ["https://d.test/dav/", "/"],
    ["https://d.test/dav/files/a%20b.txt", "/files/a b.txt"],
    ["/dav/files/%E2%82%AC", "/files/€"],
    ["https://d.test/dav/files/%E0%A4%A", "/files/%E0%A4%A"],
    ["https://d.test/davx/files", null],
    ["https://d.test/api/me", null],
    ["http://[bad", null],
  ])("%s is %s", (url, path) => {
    expect(davPathOf(url)).toBe(path);
  });

  it("cuts a very long path short", () => {
    const path = davPathOf(`/dav/${"a".repeat(2000)}`);
    expect(path).toHaveLength(1024);
    expect(path?.endsWith("…")).toBe(true);
  });
});

/** A recorder whose waits and writes the test runs by hand. */
const recorderWorld = (options: { maxErrors?: number; failWrite?: boolean } = {}) => {
  const writes: OperationBatch[] = [];
  const scheduled: Promise<void>[] = [];
  const waits: (() => void)[] = [];
  let ids = 0;
  const recorder = createOperationRecorder({
    write: (batch) => {
      if (options.failWrite) return Promise.reject(new Error("D1 is down"));
      writes.push(batch);
      return Promise.resolve();
    },
    schedule: (task) => scheduled.push(task),
    wait: () => new Promise<void>((resolve) => waits.push(resolve)),
    now: () => 0,
    id: () => `e${(ids += 1)}`,
    ...(options.maxErrors === undefined ? {} : { maxErrors: options.maxErrors }),
  });
  const elapse = async () => {
    for (const resolve of waits.splice(0)) resolve();
    await Promise.all(scheduled.splice(0));
  };
  return { recorder, writes, scheduled, elapse };
};

describe("createOperationRecorder", () => {
  it("writes one batch per delay, however many requests arrive", async () => {
    const { recorder, writes, scheduled, elapse } = recorderWorld();
    for (let index = 0; index < 50; index += 1) recorder.record(sample());
    expect(scheduled).toHaveLength(1);
    expect(writes).toEqual([]);
    await elapse();
    expect(writes).toEqual([
      { hours: [{ hour: hourOf(sample().at), operations: 50, failed: 0 }], errors: [] },
    ]);
    recorder.record(sample());
    expect(scheduled).toHaveLength(1);
    await elapse();
    expect(writes).toHaveLength(2);
  });

  it("counts each hour apart, and failures with them", async () => {
    const { recorder, writes, elapse } = recorderWorld();
    const first = Date.UTC(2026, 10, 24, 9, 59);
    recorder.record(sample({ at: first }));
    recorder.record(sample({ at: first + 60_000, status: 507 }));
    recorder.record(sample({ at: first + 120_000, method: "GET", status: 404 }));
    await elapse();
    expect(writes[0]?.hours).toEqual([
      { hour: Date.UTC(2026, 10, 24, 9), operations: 1, failed: 0 },
      { hour: Date.UTC(2026, 10, 24, 10), operations: 2, failed: 1 },
    ]);
    expect(writes[0]?.errors).toEqual([
      { id: "e1", ...sample({ at: first + 60_000, status: 507 }) },
    ]);
  });

  it("leaves 401 challenges out and schedules nothing for them", async () => {
    const { recorder, writes, scheduled, elapse } = recorderWorld();
    recorder.record(sample({ status: 401 }));
    expect(scheduled).toEqual([]);
    await recorder.flush();
    await elapse();
    expect(writes).toEqual([]);
  });

  it("keeps only the first few distinct errors of a batch", async () => {
    const { recorder, writes, elapse } = recorderWorld({ maxErrors: 2 });
    recorder.record(sample({ status: 423 }));
    recorder.record(sample({ status: 423 }));
    recorder.record(sample({ status: 413 }));
    recorder.record(sample({ path: "/files/b", status: 423 }));
    await elapse();
    expect(writes[0]?.hours[0]).toMatchObject({ operations: 4, failed: 4 });
    expect(writes[0]?.errors.map((error) => [error.path, error.status])).toEqual([
      ["/files/a.txt", 423],
      ["/files/a.txt", 413],
    ]);
  });

  it("drops a batch whose write fails, and keeps counting", async () => {
    const { recorder, elapse } = recorderWorld({ failWrite: true });
    recorder.record(sample());
    await expect(elapse()).resolves.toBeUndefined();
  });

  it("writes what has gathered on flush", async () => {
    const { recorder, writes, elapse } = recorderWorld();
    recorder.record(sample());
    await recorder.flush();
    expect(writes).toHaveLength(1);
    await elapse();
    expect(writes).toHaveLength(1);
  });

  it("counts every operation exactly once across batches", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            minute: fc.integer({ min: 0, max: 600 }),
            status: fc.constantFrom(200, 201, 207, 401, 404, 412, 423, 503),
            method: fc.constantFrom("GET", "PUT", "PROPFIND", "MOVE"),
            flush: fc.boolean(),
          }),
        ),
        async (requests) => {
          const { recorder, writes, elapse } = recorderWorld();
          for (const request of requests) {
            recorder.record(
              sample({
                at: Date.UTC(2026, 10, 24) + request.minute * 60_000,
                status: request.status,
                method: request.method,
              }),
            );
            if (request.flush) await elapse();
          }
          await elapse();
          const total = writes.flatMap((batch) => batch.hours);
          const operations = total.reduce((sum, hour) => sum + hour.operations, 0);
          const failed = total.reduce((sum, hour) => sum + hour.failed, 0);
          expect(operations).toBe(requests.filter((r) => r.status !== 401).length);
          expect(failed).toBe(requests.filter((r) => isFailedOperation(r.method, r.status)).length);
        },
      ),
    );
  });
});

const error = (at: number, id: string): OperationErrorRecord => ({
  id,
  ...sample({ at, status: 503 }),
});

describe("operationSummary", () => {
  const now = Date.UTC(2026, 10, 24, 10, 30);
  const run = (read: OperationLog["Service"]["read"]) =>
    Effect.runPromise(
      Effect.provide(
        operationSummary(now),
        Layer.succeed(OperationLog, { add: () => Promise.resolve(), read }),
      ),
    );

  it("fills every one of the last 24 hours, oldest first, and sums rows of one hour", async () => {
    let asked: [number, number] | undefined;
    const summary = await run((since, limit) => {
      asked = [since, limit];
      return Promise.resolve({
        hours: [
          { hour: Date.UTC(2026, 10, 24, 10), operations: 3, failed: 1 },
          { hour: Date.UTC(2026, 10, 24, 10), operations: 2, failed: 0 },
          { hour: Date.UTC(2026, 10, 23, 11), operations: 7, failed: 0 },
        ],
        errors: [],
      });
    });
    expect(asked).toEqual([Date.UTC(2026, 10, 23, 11), 50]);
    expect(summary.hours).toHaveLength(OPERATION_HOURS);
    expect(summary.hours[0]).toEqual({
      start: "2026-11-23T11:00:00.000Z",
      operations: 7,
      failed: 0,
    });
    expect(summary.hours.at(-1)).toEqual({
      start: "2026-11-24T10:00:00.000Z",
      operations: 5,
      failed: 1,
    });
    expect(summary.hours.slice(1, -1).every((hour) => hour.operations === 0)).toBe(true);
  });

  it("lists errors of the window newest first", async () => {
    const summary = await run(() =>
      Promise.resolve({
        hours: [],
        errors: [
          error(now - 60_000 * 90, "old"),
          error(now - 60_000, "new"),
          error(now - 2 * 86_400_000, "gone"),
          error(now + 60_000, "future"),
        ],
      }),
    );
    expect(summary.errors.map((item) => item.id)).toEqual(["new", "old"]);
    expect(summary.errors[0]).toEqual({
      id: "new",
      at: new Date(now - 60_000).toISOString(),
      method: "PUT",
      path: "/files/a.txt",
      destination: null,
      status: 503,
    });
  });
});
