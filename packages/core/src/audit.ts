import {
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  type AuditAction,
  type AuditOutcome,
} from "@davloom/schema";
import { Context, Effect } from "effect";
import { redactedError } from "./redact";

// The audit trail (PRD §7 `audit_events`): sign-ins, step-up verification, changes to credentials,
// keys, backends, Mounts and settings, exports and imports, and refused WebDAV credentials. An
// event names what it acted on by a name or an id, never by a secret. Workers Free allows 100,000
// D1 rows written a day, so the events of a request go in one write, which also removes what is
// older than the retention, and refused WebDAV credentials are counted in memory and written per
// client address, key and minute.

export { AUDIT_ACTIONS, AUDIT_OUTCOMES } from "@davloom/schema";
export type { AuditAction, AuditOutcome } from "@davloom/schema";

/** One event, as the trail keeps it. `at` is in milliseconds since the epoch. */
export interface AuditRecord {
  readonly id: string;
  readonly at: number;
  readonly action: AuditAction;
  readonly outcome: AuditOutcome;
  /** The client's address, where the deployment knows it. */
  readonly address: string | null;
  /** What the action named, such as a key's name; never a secret. */
  readonly target: string | null;
  /** How many times it happened: more than one for counted events. */
  readonly count: number;
}

export const isAuditAction = (value: string): value is AuditAction =>
  (AUDIT_ACTIONS as readonly string[]).includes(value);
export const isAuditOutcome = (value: string): value is AuditOutcome =>
  (AUDIT_OUTCOMES as readonly string[]).includes(value);

/** Where a page of the trail starts: after the event at `at` with `id`, going back in time. */
export interface AuditCursor {
  readonly at: number;
  readonly id: string;
}

/** The Port to where the audit trail is kept. */
export class AuditLog extends Context.Service<
  AuditLog,
  {
    /**
     * Adds events, adding the count of one whose id is already kept, and removes the events
     * older than `cutoff`, all in one write.
     */
    readonly add: (events: readonly AuditRecord[], cutoff: number) => Promise<void>;
    /** Up to `limit` events before `cursor` (or the newest), newest first. */
    readonly list: (cursor: AuditCursor | null, limit: number) => Promise<AuditRecord[]>;
  }
>()("@davloom/core/AuditLog") {}

const DAY_MS = 86_400_000;
/** How long the trail keeps an event. */
export const AUDIT_RETENTION_MS = 90 * DAY_MS;
export const MINUTE_MS = 60_000;
/** Events on one page of the trail, unless the request asks for fewer. */
export const AUDIT_PAGE = 50;
export const AUDIT_PAGE_MAX = 100;
/** The longest target kept: a name of up to 64 characters fits. */
const MAX_TARGET = 128;

/** What happened, before the trail gives it an id and a time. */
export interface AuditEntry {
  readonly action: AuditAction;
  readonly outcome?: AuditOutcome;
  readonly address?: string | null;
  readonly target?: string | null;
}

const clip = (value: string | null | undefined): string | null =>
  value === undefined || value === null || value === "" ? null : value.slice(0, MAX_TARGET);

/** The record of an entry at `now`. */
export const auditRecord = (entry: AuditEntry, now: number, id: string): AuditRecord => ({
  id,
  at: now,
  action: entry.action,
  outcome: entry.outcome ?? "success",
  address: clip(entry.address),
  target: clip(entry.target),
  count: 1,
});

/**
 * Records an event. The trail never fails what it records: a write that fails is logged, without
 * the event's values, and the action's answer stands.
 */
export const recordAudit = (entry: AuditEntry, now = Date.now()) =>
  Effect.gen(function* () {
    const log = yield* AuditLog;
    yield* Effect.promise(() =>
      log
        .add([auditRecord(entry, now, crypto.randomUUID())], now - AUDIT_RETENTION_MS)
        .catch((error: unknown) => {
          console.error("could not write the audit trail:", redactedError(error));
        }),
    );
  });

export interface AuditEventView {
  readonly id: string;
  readonly at: string;
  readonly action: AuditAction;
  readonly outcome: AuditOutcome;
  readonly address: string | null;
  readonly target: string | null;
  readonly count: number;
}

const CURSOR = /^(\d{1,16})\.([^\0]{1,400})$/;

/** A cursor as the API writes it, `<at>.<id>`; null for one that names nothing. */
export const parseAuditCursor = (value: string | undefined): AuditCursor | null => {
  const match = value === undefined ? null : CURSOR.exec(value);
  return match ? { at: Number(match[1]), id: match[2] ?? "" } : null;
};

export const formatAuditCursor = ({ at, id }: AuditCursor): string => `${at}.${id}`;

/** A page of the trail, newest first, and the cursor of the next page, if there is one. */
export const auditPage = (input: { before?: string; limit?: string }) =>
  Effect.gen(function* () {
    const log = yield* AuditLog;
    const limit = Math.min(AUDIT_PAGE_MAX, Number(input.limit ?? AUDIT_PAGE) || AUDIT_PAGE);
    const records = yield* Effect.promise(() =>
      log.list(parseAuditCursor(input.before), limit + 1),
    );
    const page = records.slice(0, limit);
    const last = page.at(-1);
    return {
      events: page.map((record): AuditEventView => ({
        ...record,
        at: new Date(record.at).toISOString(),
      })),
      next: records.length > limit && last ? formatAuditCursor(last) : null,
    };
  });

// --- Counted events ---------------------------------------------------------------------------

/** A refused WebDAV credential: where it came from, and the public start of the key it named. */
export interface RefusedCredential {
  readonly at: number;
  readonly address: string | null;
  /** The key's first characters, as Davloom shows a key's start; null for no key. */
  readonly keyStart: string | null;
}

/** How Davloom's API Keys start (Better Auth's `defaultPrefix`), and how much of a key is public. */
const KEY_PREFIX = "dav_";
const KEY_START_LENGTH = 10;

/**
 * The part of a refused password that names its key: the start Davloom shows of every key, and
 * only for a password that is shaped as a key. A password of another shape, such as the account's
 * own typed by mistake, names nothing.
 */
export const keyStartOf = (password: string): string | null =>
  password.startsWith(KEY_PREFIX) && password.length > KEY_START_LENGTH
    ? password.slice(0, KEY_START_LENGTH)
    : null;

export interface AuditCounterOptions {
  readonly write: (events: readonly AuditRecord[], cutoff: number) => Promise<void>;
  /** Keeps the runtime alive for a write after the response, such as Workers' waitUntil. */
  readonly schedule: (task: Promise<void>) => void;
  /** How long counts gather before they are written; Workers allow at most 30 s. */
  readonly delayMs?: number;
  /** The most distinct addresses and keys one write keeps; the rest are counted together. */
  readonly maxEntries?: number;
  readonly now?: () => number;
  readonly wait?: (ms: number) => Promise<void>;
}

export interface AuditCounter {
  readonly refused: (credential: RefusedCredential) => void;
  /** Writes what has gathered now. */
  readonly flush: () => Promise<void>;
}

const minuteOf = (at: number) => at - (((at % MINUTE_MS) + MINUTE_MS) % MINUTE_MS);

/**
 * The id of a counted event, the same in every isolate for one minute, address and key, so each
 * write adds to the one row.
 */
export const countedId = (minute: number, address: string | null, keyStart: string | null) =>
  `webdav.auth:${minute}:${address ?? ""}:${keyStart ?? ""}`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Counts refused WebDAV credentials in memory and writes them in one batch after the first. */
export const createAuditCounter = ({
  write,
  schedule,
  delayMs = 20_000,
  maxEntries = 20,
  now = Date.now,
  wait = sleep,
}: AuditCounterOptions): AuditCounter => {
  let counts = new Map<string, AuditRecord>();
  let pending = false;

  const flush = async () => {
    pending = false;
    if (counts.size === 0) return;
    const events = [...counts.values()];
    counts = new Map();
    try {
      await write(events, now() - AUDIT_RETENTION_MS);
    } catch (error) {
      console.error("could not write the audit trail:", redactedError(error));
    }
  };

  const refused = ({ at, address, keyStart }: RefusedCredential) => {
    const minute = minuteOf(at);
    let entry = { address: clip(address), target: clip(keyStart) };
    let key = countedId(minute, entry.address, entry.target);
    // Beyond the limit, every other address and key of the minute shares one event.
    if (!counts.has(key) && counts.size >= maxEntries) {
      entry = { address: null, target: null };
      key = countedId(minute, null, null);
    }
    counts.set(key, {
      id: key,
      at: minute,
      action: "webdav.auth",
      outcome: "failure",
      ...entry,
      count: (counts.get(key)?.count ?? 0) + 1,
    });
    if (!pending) {
      pending = true;
      schedule(wait(delayMs).then(flush));
    }
  };

  return { refused, flush };
};
