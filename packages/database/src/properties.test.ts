import { Database } from "bun:sqlite";
import { propertyStoreContract } from "@davloom/core/testing/property-store";
import { describe, expect, it } from "vitest";
import { createBunSqliteDatabase, migrateBunSqliteDatabase } from "./bun-sqlite";
import { createSqlPropertyStore } from "./properties";

// The SQL Property Store against a migrated in-memory Bun SQLite database, the same queries D1 runs.

const fresh = () => {
  const db = createBunSqliteDatabase(new Database(":memory:"));
  migrateBunSqliteDatabase(db);
  return db;
};

propertyStoreContract("SQL", { make: () => createSqlPropertyStore(fresh(), "backend-1") });

const property = (local: string, value = "v") => ({
  name: `{urn:t}${local}`,
  xml: `<${local} xmlns="urn:t">${value}</${local}>`,
});

describe("SQL property store", () => {
  it("keeps the properties of each backend apart", async () => {
    const db = fresh();
    const one = createSqlPropertyStore(db, "one");
    const two = createSqlPropertyStore(db, "two");
    await one.patch(["a"], [property("p", "1")], []);
    await two.patch(["a"], [property("p", "2")], []);
    await one.moveTree(["a"], ["b"]);
    await two.copyTree(["a"], ["c"]);
    await one.removeTree([]);
    expect(await one.get([["a"], ["b"]])).toEqual({ ok: true, value: { a: [], b: [] } });
    expect(await two.get([["a"], ["c"]])).toEqual({
      ok: true,
      value: { a: [property("p", "2")], c: [property("p", "2")] },
    });
  });

  it("takes more paths, sets and removals than one statement binds", async () => {
    const store = createSqlPropertyStore(fresh(), "b");
    const many = Array.from({ length: 250 }, (_, index) => property(`p${index}`));
    expect(await store.patch(["f"], many, [])).toEqual({ ok: true, value: null });
    const paths = Array.from({ length: 250 }, (_, index) => [`f${index}`]);
    const found = await store.get([["f"], ...paths]);
    expect(found.ok && found.value.f?.length).toBe(250);
    expect(found.ok && Object.keys(found.value).length).toBe(251);
    expect(
      await store.patch(
        ["f"],
        [],
        many.map((removed) => removed.name),
      ),
    ).toEqual({ ok: true, value: null });
    expect(await store.get([["f"]])).toEqual({ ok: true, value: { f: [] } });
  });

  it("applies the last of several sets of a name, and a removal after them", async () => {
    const store = createSqlPropertyStore(fresh(), "b");
    await store.patch(["f"], [property("p", "1"), property("p", "2"), property("q")], ["{urn:t}q"]);
    expect(await store.get([["f"]])).toEqual({ ok: true, value: { f: [property("p", "2")] } });
  });

  it("moves names whose characters SQLite and JavaScript count differently", async () => {
    const store = createSqlPropertyStore(fresh(), "b");
    await store.patch(["😀中", "é", "x"], [property("p")], []);
    await store.moveTree(["😀中"], ["a😀"]);
    expect(
      await store.get([
        ["a😀", "é", "x"],
        ["😀中", "é", "x"],
      ]),
    ).toEqual({
      ok: true,
      value: { "a😀/é/x": [property("p")], "😀中/é/x": [] },
    });
  });

  it("answers unavailable when the database fails", async () => {
    const sqlite = new Database(":memory:");
    const db = createBunSqliteDatabase(sqlite);
    migrateBunSqliteDatabase(db);
    sqlite.close();
    const store = createSqlPropertyStore(db, "b");
    const unavailable = { ok: false, failure: "unavailable" };
    expect(await store.get([["a"]])).toEqual(unavailable);
    expect(await store.patch(["a"], [property("p")], [])).toEqual(unavailable);
    expect(await store.copyTree(["a"], ["b"])).toEqual(unavailable);
    expect(await store.moveTree(["a"], ["b"])).toEqual(unavailable);
    expect(await store.removeTree(["a"])).toEqual(unavailable);
  });
});
