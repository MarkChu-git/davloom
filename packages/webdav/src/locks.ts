import { isWithin, type Path } from "@davloom/core";
import {
  lockConflicts,
  lockCovers,
  lockRefuses,
  type LockPlace,
  type LockScope,
} from "@davloom/laws";

export type { LockScope };

export interface Lock {
  /** The lock token, a `urn:uuid:` URI. */
  readonly token: string;
  readonly root: Path;
  readonly depth: "0" | "infinity";
  readonly scope: LockScope;
  /** The `DAV:owner` element as the client sent it, serialized, or empty. */
  readonly owner: string;
  /** The timeout the server granted, in seconds. */
  readonly timeout: number;
  /** When the lock expires, in milliseconds since the epoch. */
  readonly expires: number;
}

/** Where locks live. Paths are paths of the WebDAV namespace, mounts included. */
export interface LockStore {
  /**
   * The unexpired locks that cover `path`: a lock on the path itself, or a depth-infinity lock on
   * an ancestor. With `descendants`, also every lock whose root lies under the path.
   */
  covering(
    path: Path,
    options: { readonly descendants: boolean; readonly now: number },
  ): Promise<Lock[]>;
  /**
   * Stores a lock unless an unexpired lock conflicts with it, atomically, so two requests never
   * both get conflicting locks. Returns whether the lock was stored.
   */
  create(lock: Lock, now: number): Promise<boolean>;
  /** Extends an unexpired lock; null when no such lock exists. */
  refresh(token: string, timeout: number, expires: number, now: number): Promise<Lock | null>;
  remove(token: string): Promise<boolean>;
  /** Removes every lock rooted at the path or under it. */
  removeTree(path: Path): Promise<void>;
}

/** Where `root` lies, seen from `path`. */
export const placeOf = (root: Path, path: Path): LockPlace =>
  isWithin(path, root)
    ? root.length === path.length
      ? "same"
      : "above"
    : isWithin(root, path)
      ? "below"
      : "apart";

/** Whether a lock covers a path, with or without the locks under the path (law lock_covers_exact). */
export const covers = (lock: Lock, path: Path, descendants: boolean): boolean =>
  lockCovers(lock.depth, placeOf(lock.root, path), descendants);

/** Two locks conflict unless both are shared (law lock_conflict_exact). */
export const conflicts = (existing: Lock, scope: LockScope) => lockConflicts(existing.scope, scope);

/** Whether a held lock refuses a new one (law lock_refuses_exact). */
export const refuses = (held: Lock, wanted: Lock) =>
  lockRefuses(held, placeOf(held.root, wanted.root), wanted);

export const createMemoryLockStore = (): LockStore => {
  const locks = new Map<string, Lock>();
  const live = (now: number) => [...locks.values()].filter((lock) => lock.expires > now);
  return {
    covering: (path, { descendants, now }) =>
      Promise.resolve(live(now).filter((lock) => covers(lock, path, descendants))),
    create: (lock, now) => {
      const blocked = live(now).some((held) => refuses(held, lock));
      if (!blocked) locks.set(lock.token, lock);
      return Promise.resolve(!blocked);
    },
    refresh: (token, timeout, expires, now) => {
      const lock = locks.get(token);
      if (!lock || lock.expires <= now) return Promise.resolve(null);
      const refreshed = { ...lock, timeout, expires };
      locks.set(token, refreshed);
      return Promise.resolve(refreshed);
    },
    remove: (token) => Promise.resolve(locks.delete(token)),
    removeTree: (path) => {
      for (const [token, lock] of locks) if (isWithin(lock.root, path)) locks.delete(token);
      return Promise.resolve();
    },
  };
};

export interface IfCondition {
  readonly not: boolean;
  readonly kind: "token" | "etag";
  readonly value: string;
}

export interface IfList {
  /** The resource the list applies to, as a URL; null for the request's own resource. */
  readonly resource: string | null;
  readonly conditions: readonly IfCondition[];
}

/** Parses an If header (RFC 4918 §10.4); null when malformed. */
export const parseIfHeader = (header: string): IfList[] | null => {
  const lists: IfList[] = [];
  let rest = header.trim();
  let resource: string | null = null;
  let tagged: boolean | undefined;
  while (rest.length > 0) {
    if (rest.startsWith("<")) {
      const end = rest.indexOf(">");
      if (end === -1 || tagged === false) return null;
      tagged = true;
      resource = rest.slice(1, end);
      rest = rest.slice(end + 1).trimStart();
      if (!rest.startsWith("(")) return null;
      continue;
    }
    if (!rest.startsWith("(")) return null;
    if (tagged === undefined) tagged = false;
    const end = rest.indexOf(")");
    if (end === -1) return null;
    let body = rest.slice(1, end).trim();
    rest = rest.slice(end + 1).trimStart();
    const conditions: IfCondition[] = [];
    while (body.length > 0) {
      let not = false;
      if (/^not\b/i.test(body)) {
        not = true;
        body = body.slice(3).trimStart();
      }
      if (body.startsWith("<")) {
        const close = body.indexOf(">");
        if (close === -1) return null;
        conditions.push({ not, kind: "token", value: body.slice(1, close) });
        body = body.slice(close + 1).trimStart();
      } else if (body.startsWith("[")) {
        const close = body.indexOf("]");
        if (close === -1) return null;
        conditions.push({ not, kind: "etag", value: body.slice(1, close).trim() });
        body = body.slice(close + 1).trimStart();
      } else {
        return null;
      }
    }
    if (conditions.length === 0) return null;
    lists.push({ resource: tagged ? resource : null, conditions });
  }
  return lists.length > 0 ? lists : null;
};
