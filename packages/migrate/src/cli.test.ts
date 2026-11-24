import { createMemoryStorage } from "@davloom/core";
import { createMemoryLockStore, createWebDavHandler } from "@davloom/webdav";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli";

// The command line, with the global fetch routed to two WebDAV servers in this process.

const KEY = "dav_cli";
const handlers = new Map<string, (request: Request) => Response | Promise<Response>>();
const lines: string[] = [];

beforeEach(() => {
  for (const host of ["old.example", "new.example"]) {
    handlers.set(
      host,
      createWebDavHandler({
        basePath: "/dav",
        storage: createMemoryStorage(),
        locks: createMemoryLockStore(),
      }),
    );
  }
  vi.stubGlobal("fetch", (request: Request) => {
    const handler = handlers.get(new URL(request.url).host);
    return handler
      ? Promise.resolve(handler(request))
      : Promise.resolve(new Response(null, { status: 502 }));
  });
  vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
  vi.spyOn(console, "error").mockImplementation((line: string) => void lines.push(`! ${line}`));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  lines.length = 0;
});

const put = (host: string, path: string, body: string) =>
  handlers.get(host)?.(new Request(`https://${host}/dav${path}`, { method: "PUT", body }));

const ENV = { DAVLOOM_SOURCE_KEY: KEY, DAVLOOM_TARGET_KEY: KEY };
const URLS = ["https://old.example/dav/", "https://new.example/dav/"];

describe("davloom-migrate", () => {
  it("copies, prints each entry and a summary, and exits 0", async () => {
    await put("old.example", "/a.txt", "alpha");
    expect(await main(URLS, ENV)).toBe(0);
    expect(lines).toEqual([
      "write    /a.txt",
      "0 folders created, 1 files written (5 bytes), 0 already there, 0 properties set.",
    ]);
  });

  it("prints only the summary when quiet", async () => {
    await put("old.example", "/a.txt", "alpha");
    expect(await main(["--quiet", ...URLS], ENV)).toBe(0);
    expect(lines).toHaveLength(1);
  });

  it("exits 1 and names the conflicts", async () => {
    await put("old.example", "/a.txt", "alpha");
    await put("new.example", "/a.txt", "other");
    expect(await main(["--quiet", ...URLS], ENV)).toBe(1);
    expect(lines.at(-1)).toBe(
      "! 1 left as they are, because the target holds something else there:\n/a.txt",
    );
    expect(await main(["--quiet", "--overwrite", ...URLS], ENV)).toBe(0);
  });

  it("exits 1 with the reason when the migration stops", async () => {
    expect(await main(["https://old.example/dav/", "https://gone.example/dav/"], ENV)).toBe(1);
    expect(lines).toEqual(["! PROPFIND / answered 502"]);
  });

  it.each([
    [[], ENV, 2],
    [["--help"], ENV, 0],
    [[URLS[0] ?? ""], ENV, 2],
    [[...URLS, "extra"], ENV, 2],
  ] as const)("prints the usage for %j", async (argv, env, code) => {
    expect(await main(argv, env)).toBe(code);
    expect(lines[0]).toMatch(/^Usage: bun run migrate/);
  });

  it("asks for both keys", async () => {
    expect(await main(URLS, { DAVLOOM_SOURCE_KEY: KEY })).toBe(2);
    expect(lines).toEqual([
      "! Set DAVLOOM_SOURCE_KEY and DAVLOOM_TARGET_KEY to an API Key of each side.",
    ]);
  });
});
