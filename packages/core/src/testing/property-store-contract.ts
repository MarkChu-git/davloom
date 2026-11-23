import { assert, describe, expect, it } from "vitest";
import type { PropertyStore } from "../property-store";
import type { DeadProperty, Path, StorageResult } from "../storage";

// The Property Store contract: every implementation of the Port must pass it. Paths here hold the
// characters that break naive prefix matching: names that share a beginning, and names with
// characters that sort before and after `/`.

export interface PropertyStoreContractOptions {
  /** A fresh, empty store for each test. */
  readonly make: () => PropertyStore | Promise<PropertyStore>;
}

const property = (local: string, value = "v"): DeadProperty => ({
  name: `{urn:t}${local}`,
  xml: `<${local} xmlns="urn:t">${value}</${local}>`,
});

const value = <T>(result: StorageResult<T>): T => {
  assert(result.ok, "the store failed");
  return result.value;
};

const names = (properties: readonly DeadProperty[]) =>
  properties.map((found) => found.name.slice("{urn:t}".length));

/** Every path given, with the local names of its properties. */
const dump = async (store: PropertyStore, paths: readonly Path[]) => {
  const found = value(await store.get(paths));
  return Object.fromEntries(
    Object.entries(found)
      .filter(([, properties]) => properties.length > 0)
      .map(([key, properties]) => [key, names(properties)]),
  );
};

// Neighbours of `a`: "a b", "a-b", "a.b" and "a+b" sort before "a/", "a0" and "ab" after it.
const NEIGHBOURS: Path[] = [["a b"], ["a-b"], ["a.b"], ["a+b"], ["a0"], ["ab"], ["中"], ["😀"]];
const TREE: Path[] = [["a"], ["a", "x"], ["a", "x", "y"], ["a", "中文 #%+"], ...NEIGHBOURS];

const seed = async (store: PropertyStore) => {
  for (const path of TREE) value(await store.patch(path, [property("p", path.join("/"))], []));
};

export const propertyStoreContract = (
  implementation: string,
  { make }: PropertyStoreContractOptions,
) => {
  describe(`property store contract: ${implementation}`, () => {
    it("starts empty and gives an empty list for every path", async () => {
      const store = await make();
      expect(value(await store.get([[], ["a"], ["a", "b"]]))).toEqual({
        "": [],
        a: [],
        "a/b": [],
      });
    });

    it("sets, replaces and removes properties of one path", async () => {
      const store = await make();
      value(await store.patch(["f"], [property("p", "1"), property("q", "1")], []));
      value(await store.patch(["f"], [property("p", "2")], ["{urn:t}q", "{urn:t}missing"]));
      expect(value(await store.get([["f"]]))).toEqual({ f: [property("p", "2")] });
      value(await store.patch(["f"], [], ["{urn:t}p"]));
      expect(value(await store.get([["f"]]))).toEqual({ f: [] });
    });

    it("keeps the root's properties under the empty key", async () => {
      const store = await make();
      value(await store.patch([], [property("r")], []));
      expect(value(await store.get([[]]))).toEqual({ "": [property("r")] });
    });

    it("gives the properties of each path sorted by name", async () => {
      const store = await make();
      value(await store.patch(["f"], [property("c"), property("a"), property("b")], []));
      expect(await store.get([["f"]])).toEqual({
        ok: true,
        value: { f: [property("a"), property("b"), property("c")] },
      });
    });

    it("copies a subtree and nothing beside it", async () => {
      const store = await make();
      await seed(store);
      value(await store.patch(["c"], [property("old"), property("p", "stale")], []));
      value(await store.copyTree(["a"], ["c"]));
      expect(await dump(store, [["c"], ["c", "x"], ["c", "x", "y"], ["c", "中文 #%+"]])).toEqual({
        c: ["old", "p"],
        "c/x": ["p"],
        "c/x/y": ["p"],
        "c/中文 #%+": ["p"],
      });
      expect(await store.get([["c"]])).toEqual({
        ok: true,
        value: { c: [property("old"), property("p", "a")] },
      });
      expect(await dump(store, TREE)).toEqual(
        Object.fromEntries(TREE.map((path) => [path.join("/"), ["p"]])),
      );
      // A store that took "a b" for a path under "a" would have copied it to "c b".
      expect(await dump(store, [["c b"], ["c-b"], ["c.b"], ["c+b"], ["c0"], ["cb"]])).toEqual({});
    });

    it("copies a path inside a collection to a new name", async () => {
      const store = await make();
      await seed(store);
      value(await store.copyTree(["a", "x"], ["a", "z"]));
      expect(
        await dump(store, [
          ["a", "z"],
          ["a", "z", "y"],
        ]),
      ).toEqual({
        "a/z": ["p"],
        "a/z/y": ["p"],
      });
    });

    it("moves a subtree and leaves its neighbours", async () => {
      const store = await make();
      await seed(store);
      value(await store.patch(["m"], [property("p", "stale")], []));
      value(await store.moveTree(["a"], ["m"]));
      expect(await dump(store, TREE)).toEqual(
        Object.fromEntries(NEIGHBOURS.map((path) => [path.join("/"), ["p"]])),
      );
      expect(
        await dump(store, [["m"], ["m", "x"], ["m", "x", "y"], ["m", "中文 #%+"], ["m", "a"]]),
      ).toEqual({ m: ["p"], "m/x": ["p"], "m/x/y": ["p"], "m/中文 #%+": ["p"] });
      expect(value(await store.get([["m"]])).m).toEqual([property("p", "a")]);
    });

    it("moves a file's properties within its collection", async () => {
      const store = await make();
      await seed(store);
      value(await store.moveTree(["a", "x", "y"], ["a", "y"]));
      expect(
        await dump(store, [
          ["a", "x", "y"],
          ["a", "y"],
        ]),
      ).toEqual({ "a/y": ["p"] });
    });

    it("removes a subtree and leaves its neighbours", async () => {
      const store = await make();
      await seed(store);
      value(await store.removeTree(["a"]));
      expect(await dump(store, TREE)).toEqual(
        Object.fromEntries(NEIGHBOURS.map((path) => [path.join("/"), ["p"]])),
      );
    });

    it("removes everything from the root", async () => {
      const store = await make();
      await seed(store);
      value(await store.patch([], [property("r")], []));
      value(await store.removeTree([]));
      expect(await dump(store, [[], ...TREE])).toEqual({});
    });

    it("refuses to copy or move from or to the root", async () => {
      const store = await make();
      await seed(store);
      expect(await store.copyTree([], ["c"])).toEqual({ ok: false, failure: "root" });
      expect(await store.moveTree(["a"], [])).toEqual({ ok: false, failure: "root" });
      expect(await dump(store, TREE)).toEqual(
        Object.fromEntries(TREE.map((path) => [path.join("/"), ["p"]])),
      );
    });
  });
};
