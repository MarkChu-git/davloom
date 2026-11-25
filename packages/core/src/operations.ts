import { redactedError } from "./redact";
import { Context, Effect } from "effect";

// The WebDAV operations of the last day, for the Overview (PRD §8.1): how many ran in each hour,
// how many failed, and the latest failures with their status. Workers Free allows 100,000 D1 rows
// written a day and 10 ms of CPU a request, so a request costs one counter bump in memory. The
// counts reach the Operation Log in one batch per isolate at most every few seconds: one row per
// hour, and only the first few distinct failures of each batch.

/** One WebDAV request as the log sees it. Paths are under /dav, decoded, such as /files/a.txt. */
export interface OperationSample {
  /** Milliseconds since the epoch. */
  readonly at: number;
  readonly method: string;
  readonly path: string;
  /** The Destination of a COPY or MOVE, as a path under /dav; else null. */
  readonly destination: string | null;
  readonly status: number;
}

export interface OperationErrorRecord extends OperationSample {
  readonly id: string;
}

/** The operations of one hour; `hour` is the hour's start in milliseconds since the epoch. */
export interface HourCount {
  readonly hour: number;
  readonly operations: number;
  readonly failed: number;
}

export interface OperationBatch {
  readonly hours: readonly HourCount[];
  readonly errors: readonly OperationErrorRecord[];
}

/** The Port to where the operation counts and recent failures are kept. */
export class OperationLog extends Context.Service<
  OperationLog,
  {
    /** Adds the batch's counts to the hours' stored counts and keeps its errors. */
    readonly add: (batch: OperationBatch, now: number) => Promise<void>;
    /** The hours from `since` on, and the latest `errorLimit` errors from `since` on, newest first. */
    readonly read: (
      since: number,
      errorLimit: number,
    ) => Promise<{ hours: HourCount[]; errors: OperationErrorRecord[] }>;
  }
>()("@davloom/core/OperationLog") {}

export const HOUR_MS = 3_600_000;
/** The hours the Overview shows, the current one included. */
export const OPERATION_HOURS = 24;
/** How long the log keeps counts and errors. */
export const OPERATION_RETENTION_MS = 2 * OPERATION_HOURS * HOUR_MS;
const RECENT_ERRORS = 50;

export const hourOf = (at: number): number => at - (((at % HOUR_MS) + HOUR_MS) % HOUR_MS);

/** Methods that only read: a 404 to one is a client looking for a name, as Finder does for ._ files. */
const READS = new Set(["GET", "HEAD", "PROPFIND", "OPTIONS"]);

/**
 * Whether a response counts as an operation: a 401 challenge is the first half of an exchange that
 * the client completes with its credentials, so it is not one.
 */
export const isOperation = (status: number): boolean => status !== 401;

/** Whether an operation failed: an error status, except a read that finds no such name. */
export const isFailedOperation = (method: string, status: number): boolean =>
  status >= 400 && isOperation(status) && !(status === 404 && READS.has(method.toUpperCase()));

export interface OperationRecorderOptions {
  readonly write: (batch: OperationBatch, now: number) => Promise<void>;
  /** Keeps the runtime alive for a write after the response, such as Workers' waitUntil. */
  readonly schedule: (task: Promise<void>) => void;
  /** How long counts gather in memory before they are written. Workers allow at most 30 s. */
  readonly delayMs?: number;
  /** The most distinct errors one batch keeps. */
  readonly maxErrors?: number;
  readonly now?: () => number;
  readonly wait?: (ms: number) => Promise<void>;
  readonly id?: () => string;
}

export interface OperationRecorder {
  readonly record: (sample: OperationSample) => void;
  /** Writes what has gathered now; the scheduled write then finds nothing. */
  readonly flush: () => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Gathers operations in memory and writes them in one batch a few seconds after the first. */
export const createOperationRecorder = ({
  write,
  schedule,
  delayMs = 20_000,
  maxErrors = 3,
  now = Date.now,
  wait = sleep,
  id = () => crypto.randomUUID(),
}: OperationRecorderOptions): OperationRecorder => {
  let hours = new Map<number, { operations: number; failed: number }>();
  let errors: OperationErrorRecord[] = [];
  let pending = false;

  const flush = async () => {
    pending = false;
    if (hours.size === 0) return;
    const batch: OperationBatch = {
      hours: [...hours].map(([hour, count]) => ({ hour, ...count })),
      errors,
    };
    hours = new Map();
    errors = [];
    try {
      await write(batch, now());
    } catch (error) {
      // Counts are a convenience: a failed write loses one batch and never fails a request.
      console.error("could not write the operation log:", redactedError(error));
    }
  };

  const record = (sample: OperationSample) => {
    if (!isOperation(sample.status)) return;
    const failed = isFailedOperation(sample.method, sample.status);
    const hour = hourOf(sample.at);
    const count = hours.get(hour) ?? { operations: 0, failed: 0 };
    count.operations += 1;
    if (failed) count.failed += 1;
    hours.set(hour, count);
    if (
      failed &&
      errors.length < maxErrors &&
      !errors.some(
        (error) =>
          error.method === sample.method &&
          error.path === sample.path &&
          error.status === sample.status,
      )
    ) {
      errors.push({ id: id(), ...sample });
    }
    if (!pending) {
      pending = true;
      schedule(wait(delayMs).then(flush));
    }
  };

  return { record, flush };
};

export interface OperationHourView {
  /** The hour's start, as ISO 8601. */
  readonly start: string;
  readonly operations: number;
  readonly failed: number;
}

export interface OperationErrorView {
  readonly id: string;
  readonly at: string;
  readonly method: string;
  readonly path: string;
  readonly destination: string | null;
  readonly status: number;
}

/** The last 24 hours, oldest first and one entry for each, and the latest errors among them. */
export const operationSummary = (now: number) =>
  Effect.gen(function* () {
    const log = yield* OperationLog;
    const since = hourOf(now) - (OPERATION_HOURS - 1) * HOUR_MS;
    const read = yield* Effect.promise(() => log.read(since, RECENT_ERRORS));
    const byHour = new Map<number, { operations: number; failed: number }>();
    for (const hour of read.hours) {
      const known = byHour.get(hour.hour) ?? { operations: 0, failed: 0 };
      byHour.set(hour.hour, {
        operations: known.operations + hour.operations,
        failed: known.failed + hour.failed,
      });
    }
    const hours: OperationHourView[] = Array.from({ length: OPERATION_HOURS }, (_, index) => {
      const hour = since + index * HOUR_MS;
      const count = byHour.get(hour);
      return {
        start: new Date(hour).toISOString(),
        operations: count?.operations ?? 0,
        failed: count?.failed ?? 0,
      };
    });
    const errors: OperationErrorView[] = read.errors
      .filter((error) => error.at >= since && error.at <= now)
      .toSorted((a, b) => b.at - a.at)
      .slice(0, RECENT_ERRORS)
      .map((error) => ({
        id: error.id,
        at: new Date(error.at).toISOString(),
        method: error.method,
        path: error.path,
        destination: error.destination,
        status: error.status,
      }));
    return { hours, errors };
  });

/** The path of a WebDAV URL under /dav, decoded, such as /files/a b.txt; null for another path. */
export const davPathOf = (url: string, base = "/dav"): string | null => {
  let pathname: string;
  try {
    pathname = new URL(url, "http://localhost").pathname;
  } catch {
    return null;
  }
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  const rest = pathname.slice(base.length) || "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    decoded = rest;
  }
  return decoded.length > 1024 ? `${decoded.slice(0, 1023)}…` : decoded;
};
