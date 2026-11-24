import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../memory-storage";
import { pathKey, type Path, type StorageBackend, type StorageResult } from "../storage";

// The storage contract: every adapter of the Storage Port must pass it. Scenario tables state the
// expected outcome of each operation, and a model-based test runs random sequences of operations
// on the adapter and on the in-memory reference and compares every outcome and the final tree.

export interface ContractOptions {
  /** A fresh, empty backend for each test. */
  readonly make: () => StorageBackend | Promise<StorageBackend>;
  /** Model-based sequences to run; each needs a fresh backend. */
  readonly runs?: number;
}

const encoder = new TextEncoder();
const streamOf = (text: string) => new Blob([encoder.encode(text)]).stream();
const bytesOf = async (stream: ReadableStream<Uint8Array>) =>
  new TextDecoder().decode(await new Response(stream).arrayBuffer());

const failureOf = <T>(result: StorageResult<T>) => (result.ok ? "ok" : result.failure);

/** Every path in a backend with its kind and, for files, its content. */
export const snapshot = async (
  storage: StorageBackend,
  path: Path = [],
): Promise<Record<string, string>> => {
  const tree: Record<string, string> = {};
  const listed = await storage.list(path);
  if (!listed.ok) return tree;
  for (const entry of listed.value) {
    if (entry.kind === "collection") {
      tree[`${pathKey(entry.path)}/`] = "";
      Object.assign(tree, await snapshot(storage, entry.path));
    } else {
      const read = await storage.read(entry.path);
      tree[pathKey(entry.path)] = read.ok ? await bytesOf(read.value.body) : "<unreadable>";
    }
  }
  return tree;
};

/** The files, collections and bytes of a backend, counted by walking its whole tree. */
export const recount = async (
  storage: StorageBackend,
  path: Path = [],
): Promise<{ files: number; collections: number; bytes: number }> => {
  const total = { files: 0, collections: 0, bytes: 0 };
  const listed = await storage.list(path);
  if (!listed.ok) return total;
  for (const entry of listed.value) {
    if (entry.kind === "collection") {
      const inner = await recount(storage, entry.path);
      total.files += inner.files;
      total.collections += inner.collections + 1;
      total.bytes += inner.bytes;
    } else {
      total.files += 1;
      total.bytes += entry.size;
    }
  }
  return total;
};

type Op =
  | { op: "write"; path: Path; text: string }
  | { op: "mkcol"; path: Path }
  | { op: "remove"; path: Path }
  | { op: "copy"; from: Path; to: Path; overwrite: boolean; shallow: boolean }
  | { op: "move"; from: Path; to: Path; overwrite: boolean }
  | { op: "prop"; path: Path; value: string };

const run = async (storage: StorageBackend, op: Op): Promise<string> => {
  if (op.op === "write") {
    return failureOf(
      await storage.write(op.path, streamOf(op.text), { size: encoder.encode(op.text).length }),
    );
  }
  if (op.op === "mkcol") return failureOf(await storage.createCollection(op.path));
  if (op.op === "remove") return failureOf(await storage.remove(op.path));
  if (op.op === "copy") {
    return failureOf(
      await storage.copy(op.from, op.to, { overwrite: op.overwrite, shallow: op.shallow }),
    );
  }
  if (op.op === "move")
    return failureOf(await storage.move(op.from, op.to, { overwrite: op.overwrite }));
  return failureOf(
    await storage.patchProperties(
      op.path,
      [{ name: "{urn:t}p", xml: `<p xmlns="urn:t">${op.value}</p>` }],
      [],
    ),
  );
};

const name = fc.constantFrom("a", "b", "c");
const path = fc.array(name, { minLength: 0, maxLength: 3 });
const opArbitrary: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant("write" as const), path, text: fc.string({ maxLength: 8 }) }),
  fc.record({ op: fc.constant("mkcol" as const), path }),
  fc.record({ op: fc.constant("remove" as const), path }),
  fc.record({
    op: fc.constant("copy" as const),
    from: path,
    to: path,
    overwrite: fc.boolean(),
    shallow: fc.boolean(),
  }),
  fc.record({ op: fc.constant("move" as const), from: path, to: path, overwrite: fc.boolean() }),
  fc.record({ op: fc.constant("prop" as const), path, value: fc.constantFrom("x", "y") }),
);

export const storageContract = (adapter: string, { make, runs = 60 }: ContractOptions) => {
  describe(`storage contract: ${adapter}`, () => {
    // Requests that reach one backend at once (PRD §15, concurrency): each finishes with an
    // answer of its own, nothing is lost or mixed, and the tree stays readable.
    describe("at once", () => {
      const texts = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];

      it("create-only writes of one new file: exactly one wins, and the file holds its text", async () => {
        const storage = await make();
        const results = await Promise.all(
          texts.map((text) =>
            storage.write(["f"], streamOf(text), { size: text.length, ifAbsent: true }),
          ),
        );
        const outcomes = results.map(failureOf);
        expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
        expect(outcomes.every((o) => o === "ok" || o === "exists")).toBe(true);
        const winner = texts[outcomes.indexOf("ok")];
        expect(await snapshot(storage)).toEqual({ f: winner });
      });

      it("writes of one file: each succeeds, and the file holds one whole text", async () => {
        const storage = await make();
        const results = await Promise.all(
          texts.map((text) => storage.write(["f"], streamOf(text), { size: text.length })),
        );
        expect(results.map(failureOf)).toEqual(texts.map(() => "ok"));
        expect(texts).toContain((await snapshot(storage))["f"]);
      });

      it("writes of many files in one collection: every file arrives", async () => {
        const storage = await make();
        await storage.createCollection(["d"]);
        const results = await Promise.all(
          texts.map((text) => storage.write(["d", text], streamOf(text), { size: text.length })),
        );
        expect(results.map(failureOf)).toEqual(texts.map(() => "ok"));
        expect(await snapshot(storage)).toEqual({
          "d/": "",
          ...Object.fromEntries(texts.map((text) => [`d/${text}`, text])),
        });
      });

      it("creating one collection: it exists once, and no answer is an error", async () => {
        const storage = await make();
        const results = await Promise.all(texts.map(() => storage.createCollection(["d"])));
        const outcomes = results.map(failureOf);
        expect(outcomes).toContain("ok");
        expect(outcomes.every((o) => o === "ok" || o === "exists")).toBe(true);
        expect(await snapshot(storage)).toEqual({ "d/": "" });
      });

      it("moving one file to two places: it is never lost", async () => {
        const storage = await make();
        await storage.write(["f"], streamOf("kept"), { size: 4 });
        const results = await Promise.all([
          storage.move(["f"], ["a"], { overwrite: false }),
          storage.move(["f"], ["b"], { overwrite: false }),
        ]);
        expect(results.map(failureOf)).toContain("ok");
        const tree = await snapshot(storage);
        expect(Object.values(tree)).toContain("kept");
        expect(Object.values(tree)).not.toContain("<unreadable>");
      });

      it("copying one tree to two places: both copies are whole", async () => {
        const storage = await make();
        await storage.createCollection(["src"]);
        for (const text of texts) {
          await storage.write(["src", text], streamOf(text), { size: text.length });
        }
        const results = await Promise.all([
          storage.copy(["src"], ["one"], { overwrite: false, shallow: false }),
          storage.copy(["src"], ["two"], { overwrite: false, shallow: false }),
        ]);
        expect(results.map(failureOf)).toEqual(["ok", "ok"]);
        const tree = await snapshot(storage);
        for (const root of ["src", "one", "two"]) {
          for (const text of texts) expect(tree[`${root}/${text}`]).toBe(text);
        }
      });

      it("removing a collection while writing into it: the tree stays readable", async () => {
        const storage = await make();
        await storage.createCollection(["d"]);
        await storage.write(["d", "old"], streamOf("old"), { size: 3 });
        const results = await Promise.all([
          storage.remove(["d"]),
          ...texts.map((text) => storage.write(["d", text], streamOf(text), { size: text.length })),
        ]);
        for (const outcome of results.map(failureOf)) {
          expect(["ok", "no-parent", "not-found"]).toContain(outcome);
        }
        const tree = await snapshot(storage);
        expect(Object.values(tree)).not.toContain("<unreadable>");
        for (const [key, text] of Object.entries(tree)) {
          if (!key.endsWith("/"))
            expect(key.split("/").at(-1) === text || text === "old").toBe(true);
        }
      });
    });

    it("an empty backend has an empty root collection", async () => {
      const storage = await make();
      const root = await storage.stat([]);
      expect(root.ok && root.value.kind).toBe("collection");
      expect(await storage.list([])).toEqual({ ok: true, value: [] });
      expect(await storage.usage()).toEqual({
        ok: true,
        value: { files: 0, collections: 0, bytes: 0 },
      });
    });

    it.each([
      ["write a new file", [], { op: "write", path: ["f"], text: "x" }, "ok"],
      [
        "write under a missing parent",
        [],
        { op: "write", path: ["d", "f"], text: "x" },
        "no-parent",
      ],
      [
        "write under a file",
        [{ op: "write", path: ["f"], text: "x" }],
        { op: "write", path: ["f", "g"], text: "x" },
        "no-parent",
      ],
      [
        "write over a collection",
        [{ op: "mkcol", path: ["d"] }],
        { op: "write", path: ["d"], text: "x" },
        "is-collection",
      ],
      ["write the root", [], { op: "write", path: [], text: "x" }, "is-collection"],
      ["create a collection", [], { op: "mkcol", path: ["d"] }, "ok"],
      [
        "create an existing collection",
        [{ op: "mkcol", path: ["d"] }],
        { op: "mkcol", path: ["d"] },
        "exists",
      ],
      [
        "create over a file",
        [{ op: "write", path: ["f"], text: "x" }],
        { op: "mkcol", path: ["f"] },
        "exists",
      ],
      ["create the root", [], { op: "mkcol", path: [] }, "exists"],
      ["create without a parent", [], { op: "mkcol", path: ["a", "b"] }, "no-parent"],
      [
        "remove a file",
        [{ op: "write", path: ["f"], text: "x" }],
        { op: "remove", path: ["f"] },
        "ok",
      ],
      ["remove a missing path", [], { op: "remove", path: ["f"] }, "not-found"],
      ["remove the root", [], { op: "remove", path: [] }, "root"],
      [
        "copy a file",
        [{ op: "write", path: ["f"], text: "x" }],
        { op: "copy", from: ["f"], to: ["g"], overwrite: false, shallow: false },
        "ok",
      ],
      [
        "copy a missing source",
        [],
        { op: "copy", from: ["f"], to: ["g"], overwrite: false, shallow: false },
        "not-found",
      ],
      [
        "copy onto itself",
        [{ op: "write", path: ["f"], text: "x" }],
        { op: "copy", from: ["f"], to: ["f"], overwrite: true, shallow: false },
        "into-itself",
      ],
      [
        "copy into itself",
        [{ op: "mkcol", path: ["d"] }],
        { op: "copy", from: ["d"], to: ["d", "e"], overwrite: true, shallow: false },
        "into-itself",
      ],
      [
        "copy over a file without overwrite",
        [
          { op: "write", path: ["f"], text: "x" },
          { op: "write", path: ["g"], text: "y" },
        ],
        { op: "copy", from: ["f"], to: ["g"], overwrite: false, shallow: false },
        "exists",
      ],
      [
        "copy over a file with overwrite",
        [
          { op: "write", path: ["f"], text: "x" },
          { op: "write", path: ["g"], text: "y" },
        ],
        { op: "copy", from: ["f"], to: ["g"], overwrite: true, shallow: false },
        "ok",
      ],
      [
        "copy to the root",
        [{ op: "write", path: ["f"], text: "x" }],
        { op: "copy", from: ["f"], to: [], overwrite: true, shallow: false },
        "root",
      ],
      [
        "copy without a destination parent",
        [{ op: "write", path: ["f"], text: "x" }],
        { op: "copy", from: ["f"], to: ["n", "g"], overwrite: true, shallow: false },
        "no-parent",
      ],
      ["move the root", [], { op: "move", from: [], to: ["x"], overwrite: true }, "root"],
      [
        "move a collection into itself",
        [{ op: "mkcol", path: ["d"] }],
        { op: "move", from: ["d"], to: ["d", "e"], overwrite: true },
        "into-itself",
      ],
      [
        "move over an ancestor of the source",
        [
          { op: "mkcol", path: ["a"] },
          { op: "mkcol", path: ["a", "b"] },
          { op: "write", path: ["a", "b", "f"], text: "x" },
        ],
        { op: "move", from: ["a", "b"], to: ["a"], overwrite: true },
        "into-itself",
      ],
      [
        "copy over an ancestor of the source",
        [
          { op: "mkcol", path: ["a"] },
          { op: "write", path: ["a", "f"], text: "x" },
        ],
        { op: "copy", from: ["a", "f"], to: ["a"], overwrite: true, shallow: false },
        "into-itself",
      ],
      [
        "move a file",
        [{ op: "write", path: ["f"], text: "x" }],
        { op: "move", from: ["f"], to: ["g"], overwrite: false },
        "ok",
      ],
      [
        "set a property of a missing path",
        [],
        { op: "prop", path: ["f"], value: "x" },
        "not-found",
      ],
    ] as [string, Op[], Op, string][])("%s", async (_, before, op, expected) => {
      const storage = await make();
      for (const step of before) expect(await run(storage, step)).toBe("ok");
      expect(await run(storage, op)).toBe(expected);
    });

    it("reads back what it wrote, whole and by range", async () => {
      const storage = await make();
      await run(storage, { op: "write", path: ["f"], text: "0123456789" });
      const whole = await storage.read(["f"]);
      expect(whole.ok && (await bytesOf(whole.value.body))).toBe("0123456789");
      const part = await storage.read(["f"], { start: 2, stop: 5 });
      expect(part.ok && (await bytesOf(part.value.body))).toBe("234");
      expect(failureOf(await storage.read(["nope"]))).toBe("not-found");
      expect(failureOf(await storage.read([]))).toBe("is-collection");
    });

    it("refuses a body whose size differs from the stated size and keeps the old file", async () => {
      const storage = await make();
      await run(storage, { op: "write", path: ["f"], text: "old" });
      expect(failureOf(await storage.write(["f"], streamOf("toolong"), { size: 3 }))).toBe(
        "size-mismatch",
      );
      expect(failureOf(await storage.write(["f"], streamOf("ab"), { size: 3 }))).toBe(
        "size-mismatch",
      );
      expect(await snapshot(storage)).toEqual({ f: "old" });
    });

    it("a create-only write refuses a path that holds anything", async () => {
      const storage = await make();
      await run(storage, { op: "write", path: ["f"], text: "kept" });
      expect(failureOf(await storage.write(["f"], null, { size: 0, ifAbsent: true }))).toBe(
        "exists",
      );
      expect((await storage.write(["g"], null, { size: 0, ifAbsent: true })).ok).toBe(true);
      expect(await snapshot(storage)).toEqual({ f: "kept", g: "" });
    });

    it("writes an empty file from a null body", async () => {
      const storage = await make();
      const written = await storage.write(["e"], null, { size: 0 });
      expect(written.ok && written.value.created).toBe(true);
      expect(await snapshot(storage)).toEqual({ e: "" });
    });

    it("a new write changes the ETag and keeps the creation time", async () => {
      const storage = await make();
      const first = await storage.write(["f"], streamOf("a"), {});
      const second = await storage.write(["f"], streamOf("b"), { contentType: "text/plain" });
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(second.value.created).toBe(false);
      expect(second.value.entry.etag).not.toBe(first.value.entry.etag);
      expect(second.value.entry.created).toBe(first.value.entry.created);
      expect(second.value.entry.contentType).toBe("text/plain");
    });

    it("lists only the direct members of a collection", async () => {
      const storage = await make();
      for (const op of [
        { op: "mkcol", path: ["d"] },
        { op: "mkcol", path: ["d", "e"] },
        { op: "write", path: ["d", "e", "f"], text: "x" },
        { op: "write", path: ["d", "g"], text: "x" },
      ] as Op[])
        await run(storage, op);
      const listed = await storage.list(["d"]);
      expect(
        listed.ok &&
          listed.value.map((entry) => pathKey(entry.path)).toSorted((a, b) => a.localeCompare(b)),
      ).toEqual(["d/e", "d/g"]);
      expect(failureOf(await storage.list(["d", "g"]))).toBe("not-collection");
      expect(failureOf(await storage.list(["zz"]))).toBe("not-found");
    });

    it("copies and moves dead properties with their entries and removes them with them", async () => {
      const storage = await make();
      await run(storage, { op: "mkcol", path: ["d"] });
      await run(storage, { op: "write", path: ["d", "f"], text: "x" });
      await run(storage, { op: "prop", path: ["d", "f"], value: "x" });
      await run(storage, { op: "copy", from: ["d"], to: ["c"], overwrite: false, shallow: false });
      await run(storage, { op: "move", from: ["d"], to: ["m"], overwrite: false });
      const props = await storage.properties([
        ["c", "f"],
        ["m", "f"],
        ["d", "f"],
      ]);
      expect(props.ok && Object.keys(props.value).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "c/f",
        "m/f",
      ]);
      await storage.patchProperties(["c", "f"], [], ["{urn:t}p"]);
      const after = await storage.properties([["c", "f"]]);
      expect(after.ok && after.value["c/f"]).toEqual([]);
    });

    it("a shallow copy of a collection copies the collection alone", async () => {
      const storage = await make();
      await run(storage, { op: "mkcol", path: ["d"] });
      await run(storage, { op: "write", path: ["d", "f"], text: "x" });
      await run(storage, { op: "copy", from: ["d"], to: ["s"], overwrite: false, shallow: true });
      expect(await snapshot(storage)).toEqual({ "d/": "", "d/f": "x", "s/": "" });
    });

    it("counts files, collections and bytes", async () => {
      const storage = await make();
      await run(storage, { op: "mkcol", path: ["d"] });
      await run(storage, { op: "write", path: ["d", "f"], text: "abc" });
      await run(storage, { op: "write", path: ["g"], text: "de" });
      expect(await storage.usage()).toEqual({
        ok: true,
        value: { files: 2, collections: 1, bytes: 5 },
      });
    });

    it("matches the reference model on random sequences of operations", async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(opArbitrary, { minLength: 1, maxLength: 12 }), async (ops) => {
          const storage = await make();
          const model = createMemoryStorage();
          for (const op of ops) {
            expect(await run(storage, op), JSON.stringify(op)).toBe(await run(model, op));
          }
          expect(await snapshot(storage)).toEqual(await snapshot(model));
        }),
        { numRuns: runs },
      );
    });

    // An adapter may keep its usage as running totals rather than count on every call: whatever
    // happens, the totals equal a count of the whole tree.
    it("keeps its usage equal to a count of its tree after every operation", async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(opArbitrary, { minLength: 1, maxLength: 12 }), async (ops) => {
          const storage = await make();
          for (const op of ops) {
            await run(storage, op);
            expect(await storage.usage(), JSON.stringify(op)).toEqual({
              ok: true,
              value: await recount(storage),
            });
          }
        }),
        { numRuns: runs },
      );
    });
  });
};
