import { describe, expect, it } from "vitest";
import { BASE, hrefs, setup } from "../test/harness";
import { decodeHref, DISTINCT, NAMES, SAME, url } from "./names-cases";

// Unicode names and URL encoding (PRD §5): the table and oracle of names-cases.ts, against the
// handler.

describe("Unicode names", () => {
  it("has distinct names", () => {
    expect(new Set(NAMES.map(([, name]) => name)).size).toBe(NAMES.length);
  });

  it.each(NAMES)("a file named with %s round-trips through PUT and GET", async (_label, name) => {
    const w = setup();
    expect((await w.put(url(name), `content of ${name}`)).status).toBe(201);
    const response = await w.dav("GET", url(name));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(`content of ${name}`);
    const stat = await w.storage.stat([name]);
    expect(stat.ok && stat.value.path).toEqual([name]);
  });

  it.each(NAMES)(
    "PROPFIND lists a collection named with %s by an href that decodes to it",
    async (_label, name) => {
      const w = setup();
      expect((await w.mkcol(url(name))).status).toBe(201);
      expect((await w.put(`${url(name)}/inner.txt`, "x")).status).toBe(201);
      const response = await w.dav("PROPFIND", "/", { headers: { depth: "1" } });
      const listed = hrefs(await response.text()).map((href = "") => href);
      const member = listed.filter((href) => href !== `${BASE}/`);
      expect(member).toHaveLength(1);
      expect(member[0]?.endsWith("/")).toBe(true);
      expect(decodeHref((member[0] ?? "").slice(BASE.length + 1, -1))).toBe(name);
    },
  );

  it.each(NAMES)(
    "a collection named with %s is deleted by its encoded URL",
    async (_label, name) => {
      const w = setup();
      await w.mkcol(url(name));
      await w.put(`${url(name)}/inner.txt`, "x");
      expect((await w.dav("DELETE", url(name))).status).toBe(204);
      expect((await w.storage.stat([name])).ok).toBe(false);
    },
  );

  it.each(DISTINCT)("%j and %j are two files", async (first, second) => {
    const w = setup();
    await w.put(url(first), "first");
    await w.put(url(second), "second");
    expect(await (await w.dav("GET", url(first))).text()).toBe("first");
    expect(await (await w.dav("GET", url(second))).text()).toBe("second");
  });

  it.each(SAME)("%s and %s name the same file", async (sent, other) => {
    const w = setup();
    await w.put(`/${sent}`, "one");
    expect(await (await w.dav("GET", `/${other}`)).text()).toBe("one");
  });
});
