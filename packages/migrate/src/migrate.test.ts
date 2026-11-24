import { createMemoryStorage } from "@davloom/core";
import { createWebDavHandler, createMemoryLockStore } from "@davloom/webdav";
import { describe, expect, it } from "vitest";
import { migrate, MigrationError, type Endpoint } from "./migrate";

// Two WebDAV servers in this process, each on its own memory storage, and the migration between
// them. Each server checks the API Key it is given, as Davloom does.

const KEY = "dav_test-key";

const server = (origin: string, options: { readOnly?: boolean } = {}) => {
  const handler = createWebDavHandler({
    basePath: "/dav",
    storage: createMemoryStorage(),
    locks: createMemoryLockStore(),
    ...(options.readOnly
      ? { authorize: ({ method }) => ["GET", "HEAD", "PROPFIND", "OPTIONS"].includes(method) }
      : {}),
  });
  const fetch = async (request: Request) =>
    request.headers.get("authorization") === `Basic ${btoa(`davloom:${KEY}`)}`
      ? await handler(request)
      : new Response(null, { status: 401 });
  const dav = (
    method: string,
    path: string,
    init: { body?: BodyInit; headers?: Record<string, string> } = {},
  ) =>
    fetch(
      new Request(`${origin}/dav${path}`, {
        method,
        body: init.body,
        headers: { authorization: `Basic ${btoa(`davloom:${KEY}`)}`, ...init.headers },
      }),
    );
  const endpoint = (path = "/"): Endpoint => ({ url: `${origin}/dav${path}`, key: KEY, fetch });
  return { dav, endpoint, fetch };
};

const proppatch = (name: string, value: string) =>
  `<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:z"><D:set><D:prop><Z:${name} lang="en">${value}<Z:inner a="1"/></Z:${name}></D:prop></D:set></D:propertyupdate>`;

const BIG = new Uint8Array(3 * 1024 * 1024 + 17).map((_, i) => (i * 31 + (i >> 10)) % 256);

const pathFor = (path: string) => path.split("/").map(encodeURIComponent).join("/");

const seed = async (source: ReturnType<typeof server>) => {
  await source.dav("MKCOL", "/docs");
  await source.dav("MKCOL", "/docs/deep");
  await source.dav("MKCOL", "/docs/deep/er");
  await source.dav("MKCOL", "/empty");
  await source.dav("PUT", "/docs/a.txt", { body: "alpha" });
  await source.dav("PUT", "/docs/deep/er/b.txt", { body: "beta" });
  await source.dav("PUT", "/docs/zero", { body: "" });
  await source.dav("PUT", pathFor("/naïve name %#?.txt"), { body: "odd" });
  await source.dav("PUT", "/big.bin", { body: BIG });
  await source.dav("PROPPATCH", "/docs/a.txt", { body: proppatch("tag", "one &amp; two") });
  await source.dav("PROPPATCH", "/docs/", { body: proppatch("color", "red") });
};

const FILES: readonly (readonly [string, string | Uint8Array])[] = [
  ["/docs/a.txt", "alpha"],
  ["/docs/deep/er/b.txt", "beta"],
  ["/docs/zero", ""],
  ["/naïve name %#?.txt", "odd"],
  ["/big.bin", BIG],
];

const contentOf = async (target: ReturnType<typeof server>, path: string) =>
  new Uint8Array(await (await target.dav("GET", pathFor(path))).arrayBuffer());

const bytes = (value: string | Uint8Array) =>
  typeof value === "string" ? new TextEncoder().encode(value) : value;

const deadProperty = async (target: ReturnType<typeof server>, path: string, name: string) =>
  await (
    await target.dav("PROPFIND", path, {
      headers: { depth: "0" },
      body: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:Z="urn:z"><D:prop><Z:${name}/></D:prop></D:propfind>`,
    })
  ).text();

describe("migrate", () => {
  it("copies every folder, file and dead property, and checks what it wrote", async () => {
    const source = server("https://old.example");
    const target = server("https://new.example");
    await seed(source);
    const events: string[] = [];
    const report = await migrate({
      source: source.endpoint(),
      target: target.endpoint(),
      onEntry: ({ path, action }) => events.push(`${action} ${path}`),
    });
    expect(report).toEqual({
      created: 4,
      written: 5,
      skipped: 0,
      bytes: BIG.length + 5 + 4 + 3,
      properties: 2,
      conflicts: [],
    });
    expect(events).toHaveLength(9);
    for (const [path, content] of FILES) {
      expect(await contentOf(target, path), path).toEqual(bytes(content));
    }
    expect((await target.dav("PROPFIND", "/empty/", { headers: { depth: "0" } })).status).toBe(207);
    const tag = await deadProperty(target, "/docs/a.txt", "tag");
    expect(tag).toContain("one &amp; two");
    expect(tag).toMatch(/lang="en"/);
    expect(tag).toMatch(/inner a="1"/);
    expect(await deadProperty(target, "/docs/", "color")).toContain("red");
    // It hashes a 3 MiB file several times, which instrumented coverage runs slow down.
  }, 30_000);

  it("copies nothing again on a second run", async () => {
    const source = server("https://old.example");
    const target = server("https://new.example");
    await seed(source);
    await migrate({ source: source.endpoint(), target: target.endpoint() });
    const again = await migrate({ source: source.endpoint(), target: target.endpoint() });
    expect(again).toMatchObject({ created: 0, written: 0, skipped: 9, bytes: 0, conflicts: [] });
  });

  it("copies into a folder of the target, from a folder of the source", async () => {
    const source = server("https://old.example");
    const target = server("https://new.example");
    await seed(source);
    await target.dav("MKCOL", "/moved");
    const report = await migrate({
      source: source.endpoint("/docs/"),
      target: target.endpoint("/moved"),
    });
    expect(report).toMatchObject({ created: 2, written: 3 });
    expect(new TextDecoder().decode(await contentOf(target, "/moved/deep/er/b.txt"))).toBe("beta");
    expect((await target.dav("GET", "/big.bin")).status).toBe(404);
  });

  it("leaves what the target holds otherwise, and overwrites a different file only when asked", async () => {
    const source = server("https://old.example");
    const target = server("https://new.example");
    await seed(source);
    await target.dav("PUT", "/docs", { body: "a file where a folder is" });
    await target.dav("MKCOL", "/big.bin");
    await target.dav("PUT", pathFor("/naïve name %#?.txt"), { body: "different" });
    const report = await migrate({ source: source.endpoint(), target: target.endpoint() });
    expect(report.conflicts.toSorted()).toEqual(["/big.bin", "/docs", "/naïve name %#?.txt"]);
    expect(new TextDecoder().decode(await contentOf(target, "/docs"))).toBe(
      "a file where a folder is",
    );
    expect(new TextDecoder().decode(await contentOf(target, "/naïve name %#?.txt"))).toBe(
      "different",
    );

    const replaced = await migrate({
      source: source.endpoint(),
      target: target.endpoint(),
      overwrite: true,
    });
    expect(replaced.conflicts.toSorted()).toEqual(["/big.bin", "/docs"]);
    expect(new TextDecoder().decode(await contentOf(target, "/naïve name %#?.txt"))).toBe("odd");
  });

  it("treats a file of the same size but other content as different", async () => {
    const source = server("https://old.example");
    const target = server("https://new.example");
    await source.dav("PUT", "/x.txt", { body: "abc" });
    await target.dav("PUT", "/x.txt", { body: "abd" });
    expect(
      (await migrate({ source: source.endpoint(), target: target.endpoint() })).conflicts,
    ).toEqual(["/x.txt"]);
  });

  it("stops when a file reads back different from what was sent", async () => {
    const source = server("https://old.example");
    const target = server("https://new.example");
    await source.dav("PUT", "/x.txt", { body: "original" });
    const lossy: Endpoint = {
      ...target.endpoint(),
      fetch: async (request) =>
        request.method === "PUT"
          ? await target.fetch(
              new Request(request, { body: "damaged!", duplex: "half" } as RequestInit),
            )
          : await target.fetch(request),
    };
    await expect(migrate({ source: source.endpoint(), target: lossy })).rejects.toThrow(
      "/x.txt reads back different from the source",
    );
  });

  it.each([
    [
      "a target that is missing",
      (s: ReturnType<typeof server>, t: ReturnType<typeof server>) => ({
        source: s.endpoint(),
        target: t.endpoint("/nowhere/"),
      }),
      /target is not a collection/,
    ],
    [
      "a source that is missing",
      (s: ReturnType<typeof server>, t: ReturnType<typeof server>) => ({
        source: s.endpoint("/nowhere/"),
        target: t.endpoint(),
      }),
      /source is not a collection/,
    ],
    [
      "a wrong key",
      (s: ReturnType<typeof server>, t: ReturnType<typeof server>) => ({
        source: s.endpoint(),
        target: { ...t.endpoint(), key: "wrong" },
      }),
      /PROPFIND \/ answered 401/,
    ],
    [
      "a source file as the root",
      (s: ReturnType<typeof server>, t: ReturnType<typeof server>) => ({
        source: s.endpoint("/docs/a.txt"),
        target: t.endpoint(),
      }),
      /source is not a collection/,
    ],
  ] as const)("refuses %s", async (_, endpoints, message) => {
    const source = server("https://old.example");
    const target = server("https://new.example");
    await seed(source);
    await expect(migrate(endpoints(source, target))).rejects.toThrow(message);
  });

  it("stops at the first write the target refuses", async () => {
    const source = server("https://old.example");
    const target = server("https://new.example", { readOnly: true });
    await seed(source);
    const error = await migrate({ source: source.endpoint(), target: target.endpoint() }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MigrationError);
    expect(String(error)).toMatch(/answered 403/);
  });

  it("leaves the dead properties of what it skips as the target has them", async () => {
    const source = server("https://old.example");
    const target = server("https://new.example");
    for (const [side, value] of [
      [source, "old"],
      [target, "newer"],
    ] as const) {
      await side.dav("MKCOL", "/d");
      await side.dav("PUT", "/d/f", { body: "same" });
      await side.dav("PROPPATCH", "/d/f", { body: proppatch("note", value) });
    }
    const report = await migrate({ source: source.endpoint(), target: target.endpoint() });
    expect(report).toMatchObject({ skipped: 2, properties: 0 });
    expect(await deadProperty(target, "/d/f", "note")).toContain("newer");
  });

  it.each([
    ["a target inside the source", "/", "/backup/"],
    ["a source inside the target", "/docs/", "/"],
    ["the same collection", "/docs", "/docs/"],
    ["the same collection, encoded another way", "/a%2Bb/", "/a+b/"],
  ])("refuses %s on one server", async (_, from, to) => {
    const one = server("https://one.example");
    await seed(one);
    await one.dav("MKCOL", "/backup");
    await expect(migrate({ source: one.endpoint(from), target: one.endpoint(to) })).rejects.toThrow(
      "The source and the target overlap",
    );
    expect((await one.dav("PROPFIND", "/backup/", { headers: { depth: "1" } })).status).toBe(207);
  });

  it("copies between collections on one server that do not overlap", async () => {
    const one = server("https://one.example");
    await one.dav("MKCOL", "/from");
    await one.dav("MKCOL", "/fromage");
    await one.dav("PUT", "/from/x.txt", { body: "x" });
    const report = await migrate({
      source: one.endpoint("/from/"),
      target: one.endpoint("/fromage/"),
    });
    expect(report).toMatchObject({ written: 1 });
  });

  it("reaches a collection whose name the server encodes otherwise", async () => {
    const source = server("https://old.example");
    const target = server("https://new.example");
    await source.dav("MKCOL", "/a%2Bb%3Ac");
    await source.dav("PUT", "/a%2Bb%3Ac/x.txt", { body: "x" });
    const report = await migrate({ source: source.endpoint("/a+b:c/"), target: target.endpoint() });
    expect(report).toMatchObject({ written: 1, conflicts: [] });
  });

  it.each([
    ["created", undefined],
    ["changed", "earlier"],
  ])(
    "stops when a file is %s on the target during the copy, and keeps that version",
    async (_, before) => {
      const source = server("https://old.example");
      const target = server("https://new.example");
      await source.dav("PUT", "/x.txt", { body: "from the source" });
      if (before !== undefined) await target.dav("PUT", "/x.txt", { body: before });
      const racing: Endpoint = {
        ...target.endpoint(),
        fetch: async (request) => {
          if (request.method === "PUT") await target.dav("PUT", "/x.txt", { body: "a client's" });
          return await target.fetch(request);
        },
      };
      await expect(
        migrate({ source: source.endpoint(), target: racing, overwrite: true }),
      ).rejects.toThrow("/x.txt changed on the target during the copy");
      expect(new TextDecoder().decode(await contentOf(target, "/x.txt"))).toBe("a client's");
    },
  );

  it("ignores an href that is not valid percent-encoding", async () => {
    const source = server("https://old.example");
    const target = server("https://new.example");
    await source.dav("PUT", "/x.txt", { body: "x" });
    const odd: Endpoint = {
      ...source.endpoint(),
      fetch: async (request) => {
        const response = await source.fetch(request);
        if (request.method !== "PROPFIND" || request.headers.get("depth") !== "1") return response;
        const xml = (await response.text()).replace("/dav/x.txt", "/dav/%E0%A4%A");
        return new Response(xml, { status: 207 });
      },
    };
    expect(await migrate({ source: odd, target: target.endpoint() })).toMatchObject({ written: 0 });
  });

  it("stops when the target keeps only some of the dead properties", async () => {
    const source = server("https://old.example");
    const target = server("https://new.example");
    await source.dav("PUT", "/x.txt", { body: "x" });
    await source.dav("PROPPATCH", "/x.txt", { body: proppatch("tag", "t") });
    const partial: Endpoint = {
      ...target.endpoint(),
      fetch: async (request) =>
        request.method === "PROPPATCH"
          ? new Response(
              '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/x.txt</D:href><D:propstat><D:prop/><D:status>HTTP/1.1 403 Forbidden</D:status></D:propstat></D:response></D:multistatus>',
              { status: 207 },
            )
          : await target.fetch(request),
    };
    await expect(migrate({ source: source.endpoint(), target: partial })).rejects.toThrow(
      "PROPPATCH /x.txt did not set every property",
    );
  });

  it("sets on a later run the dead properties an earlier run stopped before", async () => {
    const source = server("https://old.example");
    const target = server("https://new.example");
    await source.dav("PUT", "/f", { body: "f" });
    await source.dav("PROPPATCH", "/f", { body: proppatch("note", "kept") });
    await source.dav("PROPPATCH", "/f", { body: proppatch("tag", "also") });
    const failing: Endpoint = {
      ...target.endpoint(),
      fetch: async (request) =>
        request.method === "PROPPATCH"
          ? new Response(null, { status: 503 })
          : await target.fetch(request),
    };
    await expect(migrate({ source: source.endpoint(), target: failing })).rejects.toThrow(
      "PROPPATCH /f answered 503",
    );
    await target.dav("PROPPATCH", "/f", { body: proppatch("tag", "the target's") });
    const again = await migrate({ source: source.endpoint(), target: target.endpoint() });
    expect(again).toMatchObject({ skipped: 1, properties: 1 });
    expect(await deadProperty(target, "/f", "note")).toContain("kept");
    expect(await deadProperty(target, "/f", "tag")).toContain("the target's");
  });
});
