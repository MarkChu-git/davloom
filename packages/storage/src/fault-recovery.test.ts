import { createMemoryPropertyStore, type StorageBackend, type StorageResult } from "@davloom/core";
import { snapshot } from "@davloom/core/testing";
import { describe, expect, it } from "vitest";
import { createObjectStoreStorage } from "./object-store";
import { createMemoryDriver, type MemoryDriver } from "./testing/memory-driver";

// Failure recovery of multi-object operations (PRD §4, §5, §15). For each operation, every call it
// makes to the object store fails in turn, once. Whatever step fails, no file is missing from both
// the source and the destination, and no file holds anything but one of its whole contents. Then
// the client's retry of the same request finishes the work, and retrying again changes nothing.

const text = (value: string) => new Blob([value]).stream();

const FILES = { a: "alpha", b: "bravo", c: "charlie" } as const;

/** A collection `src` with three files and a sub-collection `src/sub` with one more. */
const setup = async (extra?: (storage: StorageBackend) => Promise<unknown>) => {
  const driver = createMemoryDriver();
  const storage = createObjectStoreStorage({
    driver,
    prefix: "dav/",
    properties: createMemoryPropertyStore(),
  });
  await storage.createCollection(["src"]);
  for (const [name, content] of Object.entries(FILES)) {
    await storage.write(["src", name], text(content), {});
  }
  await storage.createCollection(["src", "sub"]);
  await storage.write(["src", "sub", "d"], text("delta"), {});
  await extra?.(storage);
  return { driver, storage };
};

const SOURCE_FILES: Record<string, string> = {
  a: FILES.a,
  b: FILES.b,
  c: FILES.c,
  "sub/d": "delta",
};

interface Scenario {
  readonly name: string;
  readonly extra?: (storage: StorageBackend) => Promise<unknown>;
  readonly run: (storage: StorageBackend) => Promise<StorageResult<unknown>>;
  /** What must hold right after a failed attempt, whatever step failed. */
  readonly holds: (tree: Record<string, string>) => void;
}

/** Every file of the source is whole at the source or at the destination. */
const nothingLost = (destination: string) => (tree: Record<string, string>) => {
  for (const [path, content] of Object.entries(SOURCE_FILES)) {
    const found = [tree[`src/${path}`], tree[`${destination}/${path}`]];
    expect(found, path).toContain(content);
  }
};

const noTornFiles = (tree: Record<string, string>) => {
  const contents = new Set([...Object.values(SOURCE_FILES), "", "old", "new content"]);
  for (const [path, content] of Object.entries(tree)) {
    expect(contents.has(content), `${path} holds ${content}`).toBe(true);
  }
};

const SCENARIOS: readonly Scenario[] = [
  {
    name: "moving a tree",
    run: (s) => s.move(["src"], ["dst"], { overwrite: true }),
    holds: nothingLost("dst"),
  },
  {
    name: "moving a tree over an existing one",
    extra: async (s) => {
      await s.createCollection(["dst"]);
      await s.write(["dst", "old"], text("old"), {});
    },
    run: (s) => s.move(["src"], ["dst"], { overwrite: true }),
    holds: nothingLost("dst"),
  },
  {
    name: "copying a tree",
    run: (s) => s.copy(["src"], ["dst"], { overwrite: true, shallow: false }),
    holds: (tree) => {
      for (const [path, content] of Object.entries(SOURCE_FILES)) {
        expect(tree[`src/${path}`], path).toBe(content);
      }
    },
  },
  {
    name: "copying a tree over an existing one",
    extra: async (s) => {
      await s.createCollection(["dst"]);
      await s.write(["dst", "old"], text("old"), {});
    },
    run: (s) => s.copy(["src"], ["dst"], { overwrite: true, shallow: false }),
    holds: (tree) => {
      for (const [path, content] of Object.entries(SOURCE_FILES)) {
        expect(tree[`src/${path}`], path).toBe(content);
      }
    },
  },
  {
    name: "moving a file",
    run: (s) => s.move(["src", "a"], ["moved"], { overwrite: true }),
    holds: (tree) => expect([tree["src/a"], tree["moved"]]).toContain(FILES.a),
  },
  {
    name: "removing a tree",
    run: (s) => s.remove(["src"]),
    holds: (tree) => {
      for (const [path, content] of Object.entries(SOURCE_FILES)) {
        expect([undefined, content], path).toContain(tree[`src/${path}`]);
      }
    },
  },
  {
    name: "replacing a file",
    run: (s) => s.write(["src", "a"], text("new content"), {}),
    holds: (tree) => expect([FILES.a, "new content"]).toContain(tree["src/a"]),
  },
];

/** The driver calls the operation makes when nothing fails. */
const callsOf = async (scenario: Scenario) => {
  const { driver, storage } = await setup(scenario.extra);
  const before = driver.calls.length;
  const result = await scenario.run(storage);
  expect(result.ok).toBe(true);
  return { count: driver.calls.length - before, final: await snapshot(storage) };
};

/** Fails the `nth` call from now, once. */
const failOnce = (driver: MemoryDriver, nth: number) => {
  let seen = 0;
  driver.failWhen(() => {
    seen += 1;
    return seen === nth ? "unavailable" : null;
  });
};

describe("failure recovery", () => {
  describe.each(SCENARIOS)("$name", (scenario) => {
    it("loses nothing whichever call fails, and a retry finishes the work", async () => {
      const clean = await callsOf(scenario);
      expect(clean.count).toBeGreaterThan(0);
      for (let nth = 1; nth <= clean.count; nth += 1) {
        const { driver, storage } = await setup(scenario.extra);
        failOnce(driver, nth);
        const attempt = await scenario.run(storage);
        driver.failWhen(null);
        const afterFailure = await snapshot(storage);
        scenario.holds(afterFailure);
        noTornFiles(afterFailure);
        if (attempt.ok) {
          // The failed call was one the operation could do without, such as a final head.
          expect(afterFailure, `call ${nth}`).toEqual(clean.final);
          continue;
        }
        expect(attempt.failure, `call ${nth}`).toBe("unavailable");

        const retry = await scenario.run(storage);
        const afterRetry = await snapshot(storage);
        expect(afterRetry, `retry after call ${nth} failed`).toEqual(clean.final);
        if (!retry.ok) expect(retry.failure).toBe("not-found");

        await scenario.run(storage);
        expect(await snapshot(storage), `second retry after call ${nth}`).toEqual(clean.final);
      }
    });
  });
});
