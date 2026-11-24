import { afterEach, describe, expect, it, vi } from "vitest";
import { json, ORIGIN } from "../../test/render";
import { pageQueries, prefetchPage } from "./prefetch";
import { createQueryClient } from "./queries";

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
