import { Effect, Layer } from "effect";
import * as fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_PAGE,
  AUDIT_RETENTION_MS,
  AuditLog,
  auditPage,
  auditRecord,
  countedId,
  createAuditCounter,
  formatAuditCursor,
  isAuditAction,
  isAuditOutcome,
  keyStartOf,
  parseAuditCursor,
  recordAudit,
  type AuditCursor,
  type AuditRecord,
} from "./audit";

/** The Audit Log Port in memory, as the database keeps it: by id, newest first. */
const memoryLog = () => {
  const rows = new Map<string, AuditRecord>();
  const cutoffs: number[] = [];
  const service = {
    add: async (events: readonly AuditRecord[], cutoff: number) => {
      cutoffs.push(cutoff);
      for (const event of events) {
        const known = rows.get(event.id);
        rows.set(event.id, known ? { ...known, count: known.count + event.count } : event);
      }
      for (const [id, row] of rows) if (row.at < cutoff) rows.delete(id);
    },
    list: async (cursor: AuditCursor | null, limit: number) =>
      [...rows.values()]
        .toSorted((a, b) => b.at - a.at || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0))
        .filter(
          (row) =>
            cursor === null || row.at < cursor.at || (row.at === cursor.at && row.id < cursor.id),
        )
        .slice(0, limit),
  };
  return { rows, cutoffs, service, layer: Layer.succeed(AuditLog, service) };
};

afterEach(() => {
  vi.restoreAllMocks();
});

const noop = () => undefined;

describe("auditRecord", () => {
  it.each([
    [{ action: "export" as const }, { outcome: "success", address: null, target: null }],
    [
      { action: "sign-in" as const, outcome: "failure" as const, address: "203.0.113.1" },
      { outcome: "failure", address: "203.0.113.1", target: null },
    ],
    [{ action: "key.create" as const, target: "" }, { target: null }],
    [{ action: "key.create" as const, target: "k".repeat(300) }, { target: "k".repeat(128) }],
  ])("records %j", (entry, expected) => {
    expect(auditRecord(entry, 5, "id")).toMatchObject({
      id: "id",
      at: 5,
      action: entry.action,
      count: 1,
      ...expected,
    });
  });
});

describe("recordAudit", () => {
  it("adds the event and removes what is older than the retention, in one write", async () => {
    const log = memoryLog();
    const old = auditRecord({ action: "export" }, 0, "old");
    log.rows.set(old.id, old);
    const now = AUDIT_RETENTION_MS + 10;
    await Effect.runPromise(
      Effect.provide(recordAudit({ action: "sign-out", address: "a" }, now), log.layer),
    );
    expect([...log.rows.values()]).toEqual([
      expect.objectContaining({ action: "sign-out", address: "a", at: now }),
    ]);
    expect(log.cutoffs).toEqual([10]);
  });

  it("logs a write that fails, without the event, and never fails itself", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = Layer.succeed(AuditLog, {
      add: () => Promise.reject(new Error("disk full: secret-target")),
      list: () => Promise.resolve([]),
    });
    await Effect.runPromise(
      Effect.provide(recordAudit({ action: "key.create", target: "secret-target" }), failing),
    );
    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret-target");
  });
});

describe("cursors", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["12", null],
    ["x.y", null],
    ["12.", null],
    ["12.abc", { at: 12, id: "abc" }],
    [
      "12.webdav.auth:60000:2001:db8::1:dav_abc",
      { at: 12, id: "webdav.auth:60000:2001:db8::1:dav_abc" },
    ],
    [`1.${"a".repeat(401)}`, null],
  ])("reads %j as %j", (value, cursor) => {
    expect(parseAuditCursor(value)).toEqual(cursor);
  });

  it("reads back every cursor it writes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 52 }),
        fc.string({ minLength: 1, maxLength: 300 }).filter((id) => !id.includes("\0")),
        (at, id) => {
          expect(parseAuditCursor(formatAuditCursor({ at, id }))).toEqual({ at, id });
        },
      ),
    );
  });
});

const fill = (count: number) => {
  const log = memoryLog();
  for (let index = 0; index < count; index += 1) {
    const record = auditRecord(
      { action: "key.create", target: `k${index}` },
      1000 + (index % 3),
      `id${String(index).padStart(3, "0")}`,
    );
    log.rows.set(record.id, record);
  }
  return log;
};
const page = (log: ReturnType<typeof memoryLog>, input: { before?: string; limit?: string }) =>
  Effect.runPromise(Effect.provide(auditPage(input), log.layer));

describe("auditPage", () => {
  it("answers the newest page, with ISO times, and where the next one starts", async () => {
    const log = fill(AUDIT_PAGE + 5);
    const first = await page(log, {});
    expect(first.events).toHaveLength(AUDIT_PAGE);
    expect(first.events[0]?.at).toBe(new Date(1002).toISOString());
    expect(first.next).not.toBeNull();
    const second = await page(log, { before: first.next ?? "" });
    expect(second.events).toHaveLength(5);
    expect(second.next).toBeNull();
  });

  it.each([
    ["1", 1],
    ["7", 7],
    ["100", 100],
    ["500", 100],
  ])("answers at most %s events as %i", async (limit, size) => {
    expect((await page(fill(150), { limit })).events).toHaveLength(size);
  });

  it("pages through every event once, whatever the page size", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 1, max: 12 }),
        async (count, limit) => {
          const log = fill(count);
          const seen: string[] = [];
          let before: string | undefined;
          for (let index = 0; index <= count; index += 1) {
            const read = await page(log, { limit: String(limit), ...(before ? { before } : {}) });
            seen.push(...read.events.map((event) => event.id));
            if (read.next === null) break;
            before = read.next;
          }
          expect(seen.toSorted()).toEqual([...log.rows.keys()].toSorted());
          expect(new Set(seen).size).toBe(seen.length);
        },
      ),
    );
  });
});

describe("keyStartOf", () => {
  it.each([
    ["dav_abcdefghijkl", "dav_abcdef"],
    ["dav_abcdef", null],
    ["dav_abcdefg", "dav_abcdef"],
    ["a password", null],
    ["", null],
    ["DAV_abcdefghijkl", null],
  ])("keeps %j as %j", (password, start) => {
    expect(keyStartOf(password)).toBe(start);
  });

  it("never keeps more of a key than its public start, nor any of another password", () => {
    fc.assert(
      fc.property(fc.string(), (password) => {
        const start = keyStartOf(password);
        if (start === null) return;
        expect(password.startsWith(start)).toBe(true);
        expect(start).toHaveLength(10);
        expect(start.startsWith("dav_")).toBe(true);
      }),
    );
  });
});

describe("isAuditAction and isAuditOutcome", () => {
  it.each([
    ["sign-in", true],
    ["webdav.auth", true],
    ["drop table", false],
    ["", false],
  ])("knows the action %j: %s", (value, known) => {
    expect(isAuditAction(value)).toBe(known);
  });

  it.each([
    ["success", true],
    ["locked", true],
    ["maybe", false],
  ])("knows the outcome %j: %s", (value, known) => {
    expect(isAuditOutcome(value)).toBe(known);
  });
});

describe("createAuditCounter", () => {
  const MINUTE = 60_000;
  const counter = (options: { maxEntries?: number; write?: () => Promise<void> } = {}) => {
    const writes: { events: readonly AuditRecord[]; cutoff: number }[] = [];
    const scheduled: Promise<void>[] = [];
    let release: () => void = noop;
    const counted = createAuditCounter({
      write:
        options.write ??
        (async (events, cutoff) => {
          writes.push({ events, cutoff });
        }),
      schedule: (task) => scheduled.push(task),
      wait: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      now: () => 10 * MINUTE,
      ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
    });
    return { counted, writes, scheduled, release: () => release() };
  };

  it("counts per minute, address and key, and writes once after the first", async () => {
    const { counted, writes, scheduled, release } = counter();
    counted.refused({ at: 61_000, address: "a", keyStart: "dav_123456" });
    counted.refused({ at: 119_999, address: "a", keyStart: "dav_123456" });
    counted.refused({ at: 120_000, address: "a", keyStart: "dav_123456" });
    counted.refused({ at: 61_000, address: "b", keyStart: null });
    expect(scheduled).toHaveLength(1);
    release();
    await scheduled[0];
    expect(writes).toHaveLength(1);
    expect(writes[0]?.cutoff).toBe(10 * MINUTE - AUDIT_RETENTION_MS);
    expect(writes[0]?.events).toEqual([
      {
        id: countedId(MINUTE, "a", "dav_123456"),
        at: MINUTE,
        action: "webdav.auth",
        outcome: "failure",
        address: "a",
        target: "dav_123456",
        count: 2,
      },
      expect.objectContaining({ at: 2 * MINUTE, address: "a", count: 1 }),
      expect.objectContaining({ at: MINUTE, address: "b", target: null, count: 1 }),
    ]);
    // Nothing gathered: a flush writes nothing, and the next refusal schedules a write again.
    await counted.flush();
    expect(writes).toHaveLength(1);
    counted.refused({ at: 61_000, address: "a", keyStart: null });
    expect(scheduled).toHaveLength(2);
  });

  it("counts every refusal, and keeps at most its limit of addresses and keys apart", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            at: fc.integer({ min: 0, max: 5 * MINUTE }),
            address: fc.option(fc.constantFrom("a", "b", "c", "d", "2001:db8::1")),
            keyStart: fc.option(fc.constantFrom("dav_000000", "dav_111111")),
          }),
          { maxLength: 60 },
        ),
        fc.integer({ min: 1, max: 6 }),
        async (refusals, maxEntries) => {
          const { counted, writes } = counter({ maxEntries });
          for (const refusal of refusals) counted.refused(refusal);
          await counted.flush();
          const events = writes.flatMap((write) => write.events);
          expect(events.reduce((sum, event) => sum + event.count, 0)).toBe(refusals.length);
          expect(events.length).toBeLessThanOrEqual(maxEntries + 6);
          expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
        },
      ),
    );
  });

  it("logs a write that fails, and goes on counting", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { counted } = counter({ write: () => Promise.reject(new Error("down")) });
    counted.refused({ at: 0, address: "a", keyStart: null });
    await counted.flush();
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("writes after its delay by default", async () => {
    vi.useFakeTimers();
    try {
      const writes: number[] = [];
      const counted = createAuditCounter({
        write: async (events) => {
          writes.push(events.length);
        },
        schedule: () => undefined,
        delayMs: 50,
      });
      counted.refused({ at: Date.now(), address: null, keyStart: null });
      await vi.advanceTimersByTimeAsync(60);
      expect(writes).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });
});
