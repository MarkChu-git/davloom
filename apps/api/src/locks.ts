import { pathKey, type Path } from "@davloom/core";
import type { LockRecord, Repositories } from "@davloom/database/repositories";
import type { Lock, LockStore } from "@davloom/webdav";

// The LockStore of the WebDAV engine on the instance database's dav_locks table.

const toPath = (key: string): Path => (key === "" ? [] : key.split("/"));

const toLock = (record: LockRecord): Lock => ({
  token: record.token,
  root: toPath(record.root),
  depth: record.depth === "0" ? "0" : "infinity",
  scope: record.scope === "shared" ? "shared" : "exclusive",
  owner: record.owner,
  timeout: record.timeout,
  expires: record.expiresAt,
});

/** Every ancestor of a path, the path itself included, as keys. */
const ancestors = (path: Path) =>
  path.map((_, index) => pathKey(path.slice(0, index + 1))).concat("");

export const createSqlLockStore = (locks: Repositories["locks"]): LockStore => ({
  covering: async (path, { descendants, now }) => {
    const key = pathKey(path);
    const records = await locks.find(ancestors(path), descendants ? key : null, now);
    return records
      .map(toLock)
      .filter(
        (lock) =>
          pathKey(lock.root) === key ||
          lock.depth === "infinity" ||
          (descendants && lock.root.length > path.length),
      );
  },
  create: async (lock) => {
    await locks.create({
      token: lock.token,
      root: pathKey(lock.root),
      depth: lock.depth,
      scope: lock.scope,
      owner: lock.owner,
      timeout: lock.timeout,
      expiresAt: lock.expires,
    });
  },
  refresh: async (token, timeout, expires, now) => {
    const record = await locks.refresh(token, timeout, expires, now);
    return record ? toLock(record) : null;
  },
  remove: (token) => locks.remove(token),
  removeTree: (path) => locks.removeTree(pathKey(path)),
});
