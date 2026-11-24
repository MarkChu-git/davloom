import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createMemoryLockStore, type Lock, type LockStore } from "./locks";
import { multistatus, propfindBody, setup, valueOf } from "./test/harness";

// PROPFIND reads the lock store once, however many children it lists: D1 answers each read with a
// query, and the Workers Free plan allows 50 per request, so a read per child failed every listing
// of about 50 entries there. Each entry's DAV:lockdiscovery must still hold exactly the locks that
// cover it (RFC 4918 §7.4, §15.8): a lock rooted at the entry, or a depth-infinity lock rooted at
// an ancestor. That rule is the oracle below, written from the RFC rather than from `covers`.

const TREE = ["c", "c/f1", "c/f2", "c/d", "c/d/g", "other"] as const;
const ROOTS = ["", ...TREE] as const;

const pathOf = (key: string) => (key === "" ? [] : key.split("/"));
const tokenOf = (index: number) =>
  `urn:uuid:00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

/** RFC 4918: a lock covers a resource it is rooted at, and with depth infinity all below it. */
const coversByRfc = (root: string, depth: "0" | "infinity", key: string) =>
  root === key || (depth === "infinity" && (root === "" || key.startsWith(`${root}/`)));

const countingStore = (inner: LockStore) => {
  let reads = 0;
  const store: LockStore = {
    ...inner,
    covering: async (path, options) => {
      reads += 1;
      return await inner.covering(path, options);
    },
  };
  return { store, reads: () => reads };
};

const world = async (locks: readonly { root: string; depth: "0" | "infinity" }[]) => {
  const counted = countingStore(createMemoryLockStore());
  const { dav, put, mkcol } = setup({ locks: counted.store });
  await mkcol("/c");
  await put("/c/f1", "1");
  await put("/c/f2", "2");
  await mkcol("/c/d");
  await put("/c/d/g", "g");
  await mkcol("/other");
  const now = Date.UTC(2026, 10, 24, 12, 0, 0);
  for (const [index, { root, depth }] of locks.entries()) {
    const lock: Lock = {
      token: tokenOf(index),
      root: pathOf(root),
      depth,
      // Shared, so that any set of locks can be held at once.
      scope: "shared",
      owner: "",
      timeout: 600,
      expires: now + 600_000,
    };
    expect(await counted.store.create(lock, now)).toBe(true);
  }
  return { dav, reads: counted.reads };
};

const discovered = async (dav: Awaited<ReturnType<typeof world>>["dav"], depth: "0" | "1") => {
  const response = await dav("PROPFIND", "/c", {
    headers: { depth },
    body: propfindBody("<D:prop><D:lockdiscovery/></D:prop>"),
  });
  expect(response.status).toBe(207);
  return Object.fromEntries(
    multistatus(await response.text()).map((entry) => [
      decodeURIComponent(entry.href)
        .replace(/^\/dav\/?/, "")
        .replace(/\/$/, ""),
      [...(valueOf(entry, "lockdiscovery") ?? "").matchAll(/urn:uuid:[0-9a-f-]+/g)]
        .map((match) => match[0])
        .toSorted(),
    ]),
  );
};

const lockArbitrary = fc.record({
  root: fc.constantFrom(...ROOTS),
  depth: fc.constantFrom("0" as const, "infinity" as const),
});

describe("PROPFIND and the lock store", () => {
  it.each([
    ["no lock", []],
    ["a depth-0 lock on the collection", [{ root: "c", depth: "0" }]],
    ["a depth-infinity lock on the collection", [{ root: "c", depth: "infinity" }]],
    ["a depth-infinity lock on the root", [{ root: "", depth: "infinity" }]],
    ["a depth-0 lock on the root", [{ root: "", depth: "0" }]],
    ["a lock on one child", [{ root: "c/f1", depth: "0" }]],
    ["a lock under a child", [{ root: "c/d/g", depth: "infinity" }]],
    ["a lock on a sibling of the collection", [{ root: "other", depth: "infinity" }]],
  ] as const)("lists the locks covering each entry with %s", async (_, locks) => {
    const { dav, reads } = await world(locks);
    const before = reads();
    const listing = await discovered(dav, "1");
    expect(reads() - before).toBe(1);
    for (const key of ["c", "c/f1", "c/f2", "c/d"]) {
      expect(listing[key], key).toEqual(
        locks
          .flatMap((lock, index) =>
            coversByRfc(lock.root, lock.depth, key) ? [tokenOf(index)] : [],
          )
          .toSorted(),
      );
    }
  });

  it("reads the lock store once for a listing of 120 entries", async () => {
    const counted = countingStore(createMemoryLockStore());
    const { dav, put, mkcol } = setup({ locks: counted.store });
    await mkcol("/c");
    for (let index = 0; index < 120; index += 1) await put(`/c/f${index}`, "x");
    const before = counted.reads();
    const response = await dav("PROPFIND", "/c", { headers: { depth: "1" } });
    expect(response.status).toBe(207);
    expect(counted.reads() - before).toBe(1);
  });

  it("gives every entry exactly the locks that cover it, for any set of locks", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(lockArbitrary, { maxLength: 6 }),
        fc.constantFrom("0" as const, "1" as const),
        async (locks, depth) => {
          const { dav, reads } = await world(locks);
          const before = reads();
          const listing = await discovered(dav, depth);
          const keys = depth === "0" ? ["c"] : ["c", "c/f1", "c/f2", "c/d"];
          expect(Object.keys(listing).toSorted()).toEqual(keys.toSorted());
          for (const key of keys) {
            expect(listing[key], key).toEqual(
              locks
                .flatMap((lock, index) =>
                  coversByRfc(lock.root, lock.depth, key) ? [tokenOf(index)] : [],
                )
                .toSorted(),
            );
          }
          expect(reads() - before).toBe(1);
        },
      ),
      { numRuns: 150 },
    );
  });
});
