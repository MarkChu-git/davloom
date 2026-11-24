import { RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, ORIGIN, type Handler } from "../test/render";
import { getRouter } from "../router";
import { Route as FilesRoute } from "./_app/_dashboard/files";
import { Route as SettingsRoute } from "./_app/_dashboard/settings";
import { Route as SignInRoute } from "./_app/sign-in";

beforeEach(() => {
  // As in the build: `vite dev` alone serves the StyleX stylesheet and runtime the head names.
  vi.stubEnv("DEV", false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const ME = { id: "u", name: "Admin", email: "admin@davloom.test" };

/** The whole Dashboard, as the browser loads it at `href`, with the API answered by `api`. */
const openApp = async (href: string, api: Record<string, Handler>) => {
  const calls: Request[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const request = new Request(new URL(url, ORIGIN), input instanceof Request ? input : init);
    calls.push(request);
    const handler = api[`${request.method} ${new URL(request.url).pathname}`];
    return handler ? await handler(request) : json({ error: { code: "not_found" } }, 404);
  });
  window.history.replaceState(null, "", href);
  const router = getRouter();
  await router.load();
  render(<RouterProvider router={router} />);
  return { router, calls };
};

describe("the router", () => {
  const router = getRouter();

  it.each([
    ["?path=%2Ffiles%2Ftrue", { path: "/files/true" }],
    ["?file=1.10&path=%2F", { file: "1.10", path: "/" }],
    ["?flag=null&n=1", { flag: "null", n: "1" }],
    ["", {}],
  ])("reads %j as text", (search, values) => {
    expect(router.options.parseSearch(search)).toEqual(values);
  });

  it.each([
    [{ path: "/files", file: "a b" }, "?path=%2Ffiles&file=a+b"],
    [{ path: "/files", n: 1, gone: undefined, on: true }, "?path=%2Ffiles"],
    [{}, ""],
  ])("writes %j as %j, keeping only text", (values, search) => {
    expect(router.options.stringifySearch(values)).toBe(search);
  });
});

/** What a route's own search validation makes of `search`. */
const searchOf = (
  validate: ((search: Record<string, unknown>) => unknown) | object | undefined,
  search: Record<string, unknown>,
): unknown => {
  if (typeof validate !== "function") {
    throw new TypeError("The route validates its search with a function.");
  }
  return validate(search);
};

describe("search validation", () => {
  it.each([
    [{ redirect: "/files" }, { redirect: "/files" }],
    [{ redirect: 1 }, { redirect: undefined }],
    [{}, { redirect: undefined }],
  ])("sign-in reads %j as %j", (search, valid) => {
    expect(searchOf(SignInRoute.options.validateSearch, search)).toEqual(valid);
  });

  it.each([
    [{ section: "export" }, { section: "export" }],
    [{ section: "about" }, { section: "about" }],
    [{ section: "billing" }, { section: undefined }],
    [{ section: 2 }, { section: undefined }],
    [{}, { section: undefined }],
  ])("settings reads %j as %j", (search, valid) => {
    expect(searchOf(SettingsRoute.options.validateSearch, search)).toEqual(valid);
  });

  it.each([
    [
      { path: "/files/photos", file: "a.jpg" },
      { path: "/files/photos", file: "a.jpg" },
    ],
    [
      { path: "/files/photos/", file: "" },
      { path: "/files/photos", file: undefined },
    ],
    [
      { path: 3, file: 4 },
      { path: undefined, file: undefined },
    ],
    [{}, { path: undefined, file: undefined }],
  ])("files reads %j as %j", (search, valid) => {
    expect(searchOf(FilesRoute.options.validateSearch, search)).toEqual(valid);
  });
});

describe("the Dashboard's pages", () => {
  it("sends a visit without a session to sign in, and back once signed in", async () => {
    let isSignedIn = false;
    const { router } = await openApp("/settings?section=about", {
      "GET /api/me": () => (isSignedIn ? json(ME) : json({ error: { code: "unauthorized" } }, 401)),
      "GET /api/registration": () => json({ open: false }),
      "POST /api/auth/sign-in/username": () => {
        isSignedIn = true;
        return json({ ok: true });
      },
      "GET /api/backends": () => json([]),
      "GET /api/mounts": () => json([]),
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(router.state.location.search).toEqual({ redirect: "/settings?section=about" });
    await userEvent.type(await screen.findByLabelText("Username or email"), "owner");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.href).toBe("/settings?section=about"));
    expect(await screen.findByRole("heading", { name: "About this instance" })).toBeTruthy();
  });

  it.each([
    ["/settings", "Profile"],
    ["/settings?section=webdav", "WebDAV"],
    ["/settings?section=billing", "Profile"],
  ])("opens %s at the section %s", async (href, heading) => {
    await openApp(href, {
      "GET /api/me": () => json(ME),
      "GET /api/backends": () => json([]),
    });
    expect(await screen.findByRole("heading", { level: 2, name: heading })).toBeTruthy();
  });

  it("says when the Dashboard cannot read the session, and reads it again", async () => {
    let answer = json({ error: { code: "x" } }, 500);
    const { calls } = await openApp("/settings", {
      "GET /api/me": () => answer.clone(),
      "GET /api/backends": () => json([]),
    });
    expect(
      await screen.findByText("Davloom cannot open the Dashboard", {}, { timeout: 5000 }),
    ).toBeTruthy();
    answer = json(ME);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Profile" })).toBeTruthy();
    expect(calls.filter((call) => call.url.endsWith("/api/me")).length).toBeGreaterThan(1);
  });

  it.each([
    ["/", "Overview | Davloom"],
    ["/files?path=%2Ffiles", "Files | Davloom"],
    ["/credentials", "Credentials | Davloom"],
    ["/storage", "Storage & Mounts | Davloom"],
    ["/settings", "Settings | Davloom"],
    ["/sign-in", "Sign in | Davloom"],
    ["/register", "Create account | Davloom"],
  ])("names the tab of %s %j", async (href, title) => {
    // Sign-in and registration show themselves only before there is a session or an owner.
    const isAuthPage = href === "/sign-in" || href === "/register";
    await openApp(href, {
      "GET /api/me": () => (isAuthPage ? json({ error: { code: "unauthorized" } }, 401) : json(ME)),
      "GET /api/registration": () => json({ open: href === "/register" }),
      "GET /api/backends": () => json([]),
      "GET /api/mounts": () => json([]),
      "GET /api/keys": () => json([]),
    });
    await waitFor(() => expect(document.title).toBe(title));
  });

  it("opens Files at the folder its address names", async () => {
    const { calls } = await openApp("/files?path=%2Ffiles%2Fphotos%2F", {
      "GET /api/me": () => json(ME),
      "GET /api/backends": () => json([]),
      "GET /api/mounts": () =>
        json([
          {
            id: "m",
            name: "files",
            backendId: "b",
            backendKind: "durable-object",
            root: "",
            createdAt: "2026-11-01T00:00:00Z",
          },
        ]),
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Files" })).toBeTruthy();
    await waitFor(() => expect(calls.map((call) => call.method)).toContain("PROPFIND"));
    const listed = calls.find((call) => call.method === "PROPFIND");
    expect(new URL(listed?.url ?? ORIGIN).pathname).toBe("/dav/files/photos/");
  });

  it("opens the registration page on its own", async () => {
    await openApp("/register", { "GET /api/registration": () => json({ open: true }) });
    expect(await screen.findByRole("button", { name: "Create account" })).toBeTruthy();
  });

  it("sends a visit to registration on an instance with an owner to sign in", async () => {
    const { router } = await openApp("/register", {
      "GET /api/registration": () => json({ open: false }),
      "GET /api/me": () => json({ error: { code: "unauthorized" } }, 401),
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
  });
});
