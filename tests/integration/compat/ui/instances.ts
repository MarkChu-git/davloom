import { resolve } from "node:path";
import type { APIRequestContext, APIResponse, Page } from "@playwright/test";

// The instances the browser tests run against, and the files they start with. The secrets are
// those of `../http/davloom.ts`, written out so that Playwright's config loads no Miniflare.

export const SECRET = "local-instance-secret-for-tests-only-0123456789";
/** The test Workers run offline, so they leave out the leaked-password check (`../http/davloom.ts`). */
export const OFFLINE_VARS = {
  DAVLOOM_CHECK_LEAKED_PASSWORDS: "off",
  DAVLOOM_AUTH_RATE_LIMIT: "off",
} as const;
export const ADMIN = {
  username: "admin",
  name: "Admin",
  email: "admin@example.com",
  password: "correct horse battery staple",
};

/** The first of the four ports the browser tests use; DAVLOOM_UI_PORT_BASE moves them, so two runs can share a machine. */
const base = Number(process.env.DAVLOOM_UI_PORT_BASE ?? "") || 4310;
export const BUN_PORT = base;
export const WORKERS_PORT = base + 1;
export const DEV_WORKER_PORT = base + 3;

export const BUN_ORIGIN = `http://127.0.0.1:${BUN_PORT}`;
export const WORKERS_ORIGIN = `http://127.0.0.1:${WORKERS_PORT}`;
/** The `dev` project's Worker, on the host name the dev server shares. */
export const DEV_WORKER_ORIGIN = `http://localhost:${DEV_WORKER_PORT}`;

const AUTH_DIRECTORY = resolve(import.meta.dirname, "../test-results/.auth");

/** The signed-in browser state of each Worker, which `instances.setup.ts` writes. */
export const STATE = {
  workers: resolve(AUTH_DIRECTORY, "workers.json"),
  dev: resolve(AUTH_DIRECTORY, "dev.json"),
};

/** The Mount that registration creates. */
export const MOUNT = "files";

/** A name no other test uses, so tests that run at once never meet. */
export const unique = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const DASHBOARD = { "x-davloom-dashboard": "1" };

/** The /dav address of a Files path such as "/files/Drafts". */
export const davPath = (path: string, isFolder = false): string => {
  const names = path.split("/").filter((name) => name !== "");
  return `/dav/${names.map((name) => encodeURIComponent(name)).join("/")}${isFolder ? "/" : ""}`;
};

/**
 * The headers of a change to the API, which takes one only as JSON from its own origin
 * (apps/api/src/same-origin.ts). The request context is no browser page, so it says what a
 * browser would for the Dashboard's own requests, whatever host the project reaches.
 */
const SAME_ORIGIN_JSON = { "content-type": "application/json", "sec-fetch-site": "same-origin" };

/** Whether an answer asks the session to prove presence again (apps/api/src/verification.ts). */
const needsStepUp = async (response: APIResponse): Promise<boolean> =>
  response.status() === 403 && (await response.text()).includes("verification_required");

/**
 * Proves presence again with the owner's password, as the Dashboard's step-up dialog does, for
 * a session that signed in longer ago than the step-up window.
 */
export const reverify = async (request: APIRequestContext): Promise<void> => {
  const response = await request.post("/api/verify", {
    headers: SAME_ORIGIN_JSON,
    data: JSON.stringify({ password: ADMIN.password }),
  });
  if (!response.ok()) {
    throw new Error(`verify: ${response.status()} ${await response.text()}`);
  }
};

/** Sends a request, and once more after a step-up when the server asks for one. */
const withStepUp = async (
  request: APIRequestContext,
  send: () => Promise<APIResponse>,
): Promise<APIResponse> => {
  const response = await send();
  if (!(await needsStepUp(response))) {
    return response;
  }
  await reverify(request);
  return await send();
};

const stepUpDialog = (page: Page) => page.getByRole("dialog", { name: "Verify it is you" });

/** Leaves the step-up dialog open from now on, for a spec that looks at the dialog itself. */
export const keepStepUpOpen = async (page: Page): Promise<void> => {
  await page.removeLocatorHandler(stepUpDialog(page));
};

/**
 * Answers the Dashboard's step-up dialog with the owner's password whenever it opens, so that a
 * spec that deletes, replaces or changes credentials through the page carries on.
 */
export const answerStepUp = async (page: Page): Promise<void> => {
  const dialog = stepUpDialog(page);
  await page.addLocatorHandler(dialog, async () => {
    await dialog.getByLabel("Password").fill(ADMIN.password);
    await dialog.getByRole("button", { name: "Verify" }).click();
    await dialog.waitFor({ state: "hidden" });
  });
};

/** Sends a WebDAV request as the Dashboard does, with the context's session. */
export const dav = async (
  request: APIRequestContext,
  method: string,
  path: string,
  {
    body,
    isFolder = false,
    headers = {},
  }: {
    body?: string | Buffer;
    isFolder?: boolean;
    headers?: Record<string, string>;
  } = {},
) => {
  const response = await withStepUp(request, () =>
    request.fetch(davPath(path, isFolder), {
      method,
      headers: { ...DASHBOARD, ...headers },
      data: body,
    }),
  );
  if (response.status() >= 300) {
    throw new Error(`${method} ${path}: ${response.status()}`);
  }
  return response;
};

/** Text a preview shows. */
export const README =
  "This folder syncs to the laptop and the phone through WebDAV.\nDo not rename the top-level folders.\n";

export const NOTES =
  "# Notes, 14 November\n\n- Move the photo backup\n- Give the accountant a read-only key\n";

export const LONG_LOG_NAME =
  "an-export-from-the-old-nas-with-a-very-long-file-name-that-keeps-going-2026-11-16.log";

/** Bytes of a given length, for files whose content does not matter. */
const filler = (size: number): Buffer => Buffer.alloc(size, 0x61);

/**
 * The sample folder: what a person keeps in a mount. Sizes are small so that every test can have
 * its own copy, and differ so that sorting by size has an order: the notes (84 bytes) are the
 * smallest file and the budget (48.2 kB) the largest.
 */
export const SAMPLE: readonly { path: string; body?: string | Buffer }[] = [
  { path: "Contracts" },
  { path: "Contracts/lease-2026.pdf", body: filler(12_400) },
  { path: "Contracts/internet-service.pdf", body: filler(3_120) },
  { path: "Drafts" },
  { path: "Drafts/blog-post-self-hosting.md", body: "# Why I self-host my files\n" },
  { path: "Invoices 2026" },
  { path: "Invoices 2026/2026-10-electricity.pdf", body: filler(1_880) },
  { path: "Scans" },
  { path: "budget-2027.xlsx", body: filler(48_200) },
  { path: "meeting-notes-2026-11-14.md", body: NOTES },
  {
    path: "Quarterly report — Q3 2026, final version (signed by both parties).pdf",
    body: filler(24_000),
  },
  { path: "README.txt", body: README },
  { path: "wifi-guest.txt", body: filler(120) },
  { path: LONG_LOG_NAME, body: filler(9_320) },
];

/** The names at the top of the sample folder, folders first, each in name order. */
export const SAMPLE_NAMES = [
  "Contracts",
  "Drafts",
  "Invoices 2026",
  "Scans",
  LONG_LOG_NAME,
  "budget-2027.xlsx",
  "meeting-notes-2026-11-14.md",
  "Quarterly report — Q3 2026, final version (signed by both parties).pdf",
  "README.txt",
  "wifi-guest.txt",
];

/** Fills the folder at `folder`, such as "/files/t-1", with the sample; the folder must exist. */
export const seedSample = async (request: APIRequestContext, folder: string): Promise<void> => {
  for (const item of SAMPLE) {
    const path = `${folder}/${item.path}`;
    await (item.body === undefined
      ? dav(request, "MKCOL", path, { isFolder: true })
      : dav(request, "PUT", path, { body: item.body }));
  }
};

/**
 * The folder of the Mount "files" that tests keep their folders in. A listing of 200 entries or
 * more draws only the rows in view, and every browser project of a run shares the one Worker, so
 * the top of the Mount, whose sample files some tests open, holds only a few of them.
 */
const FLOWS = `/${MOUNT}/flows`;

/** Makes `folder` unless it is there already, as when tests that run at once both make it. */
const ensureFolder = async (request: APIRequestContext, folder: string): Promise<void> => {
  const response = await request.fetch(davPath(folder, true), {
    method: "MKCOL",
    headers: DASHBOARD,
  });
  // 405: another test made it first.
  if (response.status() !== 201 && response.status() !== 405) {
    throw new Error(`MKCOL ${folder}: ${response.status()}`);
  }
};

/** The top of the Mount "files", for the few tests whose folder has to sit there. */
export const MOUNT_TOP = `/${MOUNT}`;

/**
 * Makes a folder of its own in the Mount "files" for one test, with the sample in it: inside
 * `parent`, which is made when it is missing, and by default in FLOWS.
 */
export const scratchFolder = async (
  request: APIRequestContext,
  { withSample = true, parent = FLOWS }: { withSample?: boolean; parent?: string } = {},
): Promise<string> => {
  if (parent !== MOUNT_TOP) await ensureFolder(request, parent);
  const folder = `${parent}/${unique("t")}`;
  await dav(request, "MKCOL", folder, { isFolder: true });
  if (withSample) {
    await seedSample(request, folder);
  }
  return folder;
};

/** Calls the management API with the context's session. */
export const api = async (
  request: APIRequestContext,
  method: string,
  path: string,
  body?: unknown,
) => {
  const response = await withStepUp(request, () =>
    request.fetch(path, {
      method,
      headers: SAME_ORIGIN_JSON,
      data: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  if (!response.ok()) {
    throw new Error(`${method} ${path}: ${response.status()} ${await response.text()}`);
  }
  return response.status() === 204 ? null : ((await response.json()) as unknown);
};

/** A field of a JSON answer, as text. */
export const field = (value: unknown, name: string): string => {
  const found: unknown =
    typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
  if (typeof found !== "string") {
    throw new Error(`no ${name} in ${JSON.stringify(value)}`);
  }
  return found;
};

/** Creates an API Key through the API, as another device's owner would have earlier. */
export const createKey = async (
  request: APIRequestContext,
  name: string,
  access: "read-only" | "read-write" = "read-write",
  expiresInDays: number | null = 90,
) => field(await api(request, "POST", "/api/keys", { name, access, expiresInDays }), "key");

/** Adds a Mount on the default backend, named `name`, showing `root` of the backend. */
export const createMount = async (request: APIRequestContext, name: string, root = "") => {
  const backends = await api(request, "GET", "/api/backends");
  const backendId = Array.isArray(backends) ? field(backends[0], "id") : "";
  return field(await api(request, "POST", "/api/mounts", { name, backendId, root }), "id");
};
