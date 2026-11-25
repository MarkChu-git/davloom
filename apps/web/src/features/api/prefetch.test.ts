import { afterEach, describe, expect, it, vi } from "vitest";
import { json, ORIGIN } from "../../test/render";
import { pageQueries, prefetchPage, takeFrameRead } from "./prefetch";
import { createQueryClient, keys } from "./queries";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answers every read with an empty answer and records the paths read. */
const recordReads = () => {
  const paths: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input), ORIGIN);
    paths.push(url.pathname);
    return json(url.pathname === "/api/auth/get-session" ? null : []);
  });
  return paths;
};

describe("prefetchPage", () => {
  it.each([
    [
      "/",
      ["/api/me", "/api/backends", "/api/overview", "/api/operations", "/api/settings/storage"],
    ],
    ["/files", ["/api/me", "/api/backends", "/api/mounts"]],
    ["/files/", ["/api/me", "/api/backends", "/api/mounts"]],
    ["/credentials", ["/api/me", "/api/backends", "/api/keys", "/api/mounts"]],
    ["/storage", ["/api/me", "/api/backends", "/api/mounts"]],
    ["/settings", ["/api/me", "/api/backends"]],
    ["/sign-in", ["/api/auth/get-session", "/api/registration"]],
    ["/register", ["/api/registration"]],
    ["/no-such-page", []],
  ])("reads what %s shows first", async (pathname, expected) => {
    const paths = recordReads();
    await prefetchPage(createQueryClient(), pathname);
    expect(paths.toSorted()).toEqual(expected.toSorted());
  });

  it("does not read again what the client already has fresh", async () => {
    const client = createQueryClient();
    recordReads();
    await prefetchPage(client, "/settings");
    const again = recordReads();
    await prefetchPage(client, "/files");
    expect(again).toEqual(["/api/mounts"]);
  });

  it("settles when a read fails, and leaves the failure to the page", async () => {
    vi.stubGlobal("fetch", async () => json({ error: { code: "unavailable" } }, 503));
    const client = createQueryClient();
    client.setDefaultOptions({ queries: { retry: false } });
    await expect(prefetchPage(client, "/register")).resolves.toBeUndefined();
  });

  it("names a read for every page", () => {
    for (const pathname of ["/", "/files", "/credentials", "/storage", "/settings", "/sign-in"]) {
      expect(pageQueries(pathname).length).toBeGreaterThan(0);
    }
  });
});

/** Stands in for the reads the script in the page's head started (features/frame/fill.ts). */
const frameReads = (reads: Record<string, Promise<unknown>>) => {
  vi.stubGlobal("window", { davloomFrameReads: reads });
  return reads;
};

describe("the reads the frame's script started", () => {
  it("become the page's answers, so the page does not read them again", async () => {
    const overview = { usage: { bytes: 1, files: 1, collections: 0 }, mounts: [], backends: [] };
    const user = { id: "u", name: "Ada" };
    const reads = frameReads({
      "/api/overview": Promise.resolve(overview),
      "/api/me": Promise.resolve(user),
    });
    const paths = recordReads();
    const client = createQueryClient();
    await prefetchPage(client, "/");
    expect(paths).not.toContain("/api/overview");
    expect(paths).not.toContain("/api/me");
    expect(client.getQueryData(keys.overview)).toEqual(overview);
    expect(client.getQueryData(keys.me)).toEqual(user);
    // Each is handed out once.
    expect(reads).toEqual({});
  });

  it("are read again when they failed, so the page learns why", async () => {
    const failed = Promise.reject(new Error("401"));
    failed.catch(() => undefined);
    frameReads({ "/api/me": failed });
    const paths = recordReads();
    const client = createQueryClient();
    await prefetchPage(client, "/settings");
    expect(paths).toContain("/api/me");
    expect(client.getQueryData(keys.me)).toEqual([]);
  });

  it("are none without a window or without the script", () => {
    expect(takeFrameRead("/api/me")).toBeUndefined();
    vi.stubGlobal("window", {});
    expect(takeFrameRead("/api/me")).toBeUndefined();
  });
});
