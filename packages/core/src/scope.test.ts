import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "./memory-storage";
import { formatRoot, MAX_SCOPE_ROOTS, parseScope, relationOf, scopeStorage } from "./scope";

describe("parseScope", () => {
  it.each([
    [["/files"], [["files"]]],
    [
      ["/files/photos/2026", "docs"],
      [["files", "photos", "2026"], ["docs"]],
    ],
    [["//files//a/"], [["files", "a"]]],
    [["/中文/😀"], [["中文", "😀"]]],
  ])("reads %j", (value, roots) => {
    expect(parseScope(value)).toEqual(roots);
  });

  it.each([
    ["nothing", undefined],
    ["an empty list", []],
    ["the root", ["/"]],
    ["a dot segment", ["/files/.."]],
    ["a name with NUL", ["/a\0b"]],
    ["a number", [1]],
    ["a string", "/files"],
    ["too many roots", Array.from({ length: MAX_SCOPE_ROOTS + 1 }, (_, i) => `/m${i}`)],
  ])("refuses %s", (_, value) => {
    expect(parseScope(value)).toBeNull();
  });

  it("formats a root as the API shows it", () => {
    expect(formatRoot(["files", "a b"])).toBe("/files/a b");
  });
});

describe("relationOf", () => {
  const scope = [["files", "photos"], ["docs"]];
  it.each([
    [[], "above"],
    [["files"], "above"],
    [["files", "photos"], "inside"],
    [["files", "photos", "2026", "a.jpg"], "inside"],
    [["files", "photosx"], "outside"],
    [["files", "other"], "outside"],
    [["docs"], "inside"],
    [["docs", "x"], "inside"],
    [["doc"], "outside"],
    [["music"], "outside"],
  ] as const)("%j is %s", (path, relation) => {
    expect(relationOf(path, scope)).toBe(relation);
  });

  it("everything is inside without a scope", () => {
    expect(relationOf(["any", "where"], null)).toBe("inside");
    expect(relationOf([], null)).toBe("inside");
  });
});

const seeded = async () => {
  const storage = createMemoryStorage();
  for (const path of [["files"], ["files", "photos"], ["files", "other"], ["docs"], ["music"]]) {
    await storage.createCollection(path);
  }
  await storage.write(["files", "photos", "a.jpg"], null, {});
  await storage.write(["files", "top.txt"], null, {});
  return storage;
};

const names = async (storage: ReturnType<typeof scopeStorage>, path: string[]) => {
  const listed = await storage.list(path);
  return listed.ok
    ? listed.value.map((entry) => entry.path.join("/")).toSorted((a, b) => a.localeCompare(b))
    : listed;
};

describe("scopeStorage", () => {
  it("lists only the way to the roots above them, and everything inside", async () => {
    const storage = scopeStorage(await seeded(), [["files", "photos"], ["docs"]]);
    expect(await names(storage, [])).toEqual(["docs", "files"]);
    expect(await names(storage, ["files"])).toEqual(["files/photos"]);
    expect(await names(storage, ["files", "photos"])).toEqual(["files/photos/a.jpg"]);
  });

  it("passes failures and unscoped storage through", async () => {
    const base = await seeded();
    expect(scopeStorage(base, null)).toBe(base);
    const storage = scopeStorage(base, [["files"]]);
    expect(await storage.list(["nope"])).toEqual({ ok: false, failure: "not-found" });
    expect((await storage.stat(["music"])).ok).toBe(true);
  });
});
