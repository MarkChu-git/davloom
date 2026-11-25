import type { Answer } from "@davloom/client";
import type { Page, Route } from "@playwright/test";
import { davNames, multistatus, type ListedEntry } from "./multistatus";

// The data the screenshot tests show: every answer of the management API and of WebDAV, made here
// rather than read from a Worker that other tests change, and dated against the clock the page
// runs on, so that each screen looks the same on every run. The answers take the server's types
// (packages/client), so a change to an answer's shape fails the typecheck here first.

/** The time the screenshots' pages run at. */
export const NOW = new Date("2026-11-16T12:00:00Z");

const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const DAY = 86_400_000;
const HOUR = 3_600_000;

const ME: Answer<"GET /api/me"> = {
  id: "user-1",
  name: "Admin",
  username: "admin",
  email: "admin@example.com",
  twoFactorEnabled: false,
  verifiedAt: NOW.getTime(),
};

const BACKENDS: Answer<"GET /api/backends"> = [
  {
    id: "b1",
    name: "Default",
    kind: "durable-object",
    createdAt: ago(30 * DAY),
    available: true,
    usage: { files: 128, collections: 14, bytes: 734_003_200 },
    status: { state: "answered", ms: 12 },
    capacity: 5_000_000_000,
    config: {},
    hasSecretKey: false,
  },
  {
    id: "b2",
    name: "Photos bucket",
    kind: "s3",
    createdAt: ago(12 * DAY),
    available: true,
    usage: {
      files: 2_048,
      collections: 36,
      bytes: 18_250_000_000,
      measuredAt: NOW.getTime() - HOUR,
    },
    status: { state: "answered", ms: 84 },
    capacity: null,
    config: {
      endpoint: "https://s3.example.com",
      region: "eu-west-1",
      bucket: "photos",
      prefix: "davloom/",
      forcePathStyle: true,
      accessKeyId: "AKIAEXAMPLE",
    },
    hasSecretKey: true,
  },
];

const MOUNTS: Answer<"GET /api/mounts"> = [
  {
    id: "m1",
    name: "files",
    backendId: "b1",
    backendKind: "durable-object",
    root: "",
    createdAt: ago(30 * DAY),
  },
  {
    id: "m2",
    name: "photos",
    backendId: "b2",
    backendKind: "s3",
    root: "",
    createdAt: ago(12 * DAY),
  },
];

const OVERVIEW: Answer<"GET /api/overview"> = {
  usage: { files: 2_176, collections: 50, bytes: 18_984_003_200 },
  mounts: MOUNTS,
  backends: BACKENDS,
};

const KEYS: Answer<"GET /api/keys"> = [
  {
    id: "k1",
    name: "Work laptop",
    start: "dav_7Qx",
    access: "read-write",
    paths: null,
    enabled: true,
    expiresAt: ahead(84 * DAY),
    createdAt: ago(6 * DAY),
    lastUsedAt: ago(2 * HOUR),
  },
  {
    id: "k2",
    name: "Accountant",
    start: "dav_m2P",
    access: "read-only",
    paths: ["/files/Invoices 2026"],
    enabled: true,
    expiresAt: ahead(25 * DAY),
    createdAt: ago(5 * DAY),
    lastUsedAt: null,
  },
  {
    id: "k3",
    name: "Old phone",
    start: "dav_c9L",
    access: "read-write",
    paths: ["/photos"],
    enabled: true,
    expiresAt: ago(3 * DAY),
    createdAt: ago(93 * DAY),
    lastUsedAt: ago(20 * DAY),
  },
];

/** 24 hours of operations, oldest first, with a few failures in the afternoon. */
const OPERATIONS: Answer<"GET /api/operations"> = {
  hours: Array.from({ length: 24 }, (_, index) => ({
    start: ago((24 - index) * HOUR),
    operations:
      [12, 8, 4, 2, 1, 1, 3, 9, 28, 46, 52, 61, 58, 49, 55, 63, 70, 44, 31, 26, 22, 18, 15, 11][
        index
      ] ?? 0,
    failed: index === 14 ? 2 : index === 20 ? 1 : 0,
  })),
  errors: [
    {
      id: "e1",
      at: ago(4 * HOUR),
      method: "PUT",
      path: "/files/Scans/receipt-0412.pdf",
      destination: null,
      status: 507,
    },
    {
      id: "e2",
      at: ago(10 * HOUR),
      method: "MOVE",
      path: "/files/Drafts/blog-post.md",
      destination: "/files/Contracts/blog-post.md",
      status: 412,
    },
  ],
};

const STORAGE_SETTINGS: Answer<"GET /api/settings/storage"> = { defaultBackendId: "b1" };

const INSTANCE: Answer<"GET /api/instance"> = {
  version: "1.0.0",
  commit: "4f2c9a1",
  runtime: "Cloudflare Workers",
  deployment: "Cloudflare Free",
  region: "FRA",
  database: "D1",
  storageKinds: ["durable-object", "s3"],
};

const AUDIT: Answer<"GET /api/audit"> = {
  events: [
    {
      id: "a1",
      at: ago(20 * 60_000),
      action: "key.create",
      outcome: "success",
      address: "203.0.113.5",
      target: "Work laptop",
      count: 1,
    },
    {
      id: "a2",
      at: ago(2 * HOUR),
      action: "sign-in",
      outcome: "success",
      address: "203.0.113.5",
      target: "password",
      count: 1,
    },
    {
      id: "a3",
      at: ago(3 * HOUR),
      action: "sign-in",
      outcome: "failure",
      address: "198.51.100.7",
      target: "password",
      count: 3,
    },
    {
      id: "a4",
      at: ago(DAY),
      action: "mount.create",
      outcome: "success",
      address: "203.0.113.5",
      target: "photos",
      count: 1,
    },
    {
      id: "a5",
      at: ago(2 * DAY),
      action: "webdav.auth",
      outcome: "failure",
      address: "192.0.2.44",
      target: "dav_x1y",
      count: 12,
    },
  ],
  next: null,
};

const SESSION = {
  id: "s1",
  token: "session-token",
  createdAt: ago(2 * HOUR),
  updatedAt: ago(10 * 60_000),
  expiresAt: ahead(7 * DAY),
  ipAddress: "203.0.113.5",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0 Safari/537.36",
  userId: ME.id,
};

const README =
  "This folder syncs to the laptop and the phone through WebDAV.\nDo not rename the top-level folders.\n";

const at = (days: number, hours = 0) => new Date(NOW.getTime() - days * DAY - hours * HOUR);

/** The folders WebDAV lists, by their path under /dav. */
const FOLDERS: Readonly<Record<string, readonly ListedEntry[]>> = {
  "": [
    { name: "files", modified: at(30) },
    { name: "photos", modified: at(12) },
  ],
  files: [
    { name: "Contracts", modified: at(9) },
    { name: "Drafts", modified: at(2) },
    { name: "Invoices 2026", modified: at(14) },
    { name: "Scans", modified: at(1) },
    {
      name: "budget-2027.xlsx",
      bytes: 48_200,
      modified: at(3, 4),
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    { name: "meeting-notes-2026-11-14.md", bytes: 84, modified: at(2, 1), type: "text/markdown" },
    {
      name: "Quarterly report — Q3 2026.pdf",
      bytes: 24_000,
      modified: at(20),
      type: "application/pdf",
    },
    { name: "README.txt", bytes: README.length, modified: at(30), type: "text/plain" },
    { name: "wifi-guest.txt", bytes: 120, modified: at(45), type: "text/plain" },
  ],
  "files/Scans": [],
};

const FILES: Readonly<Record<string, string>> = { "files/README.txt": README };

export interface ScreenOptions {
  /** Whether the browser is signed in; the sign-in and registration screens are not. */
  readonly signedIn?: boolean;
  /** Whether the instance still waits for its owner, as Create account needs. */
  readonly registrationOpen?: boolean;
}

/** The API's answers, by `METHOD path`. */
const answersFor = ({ signedIn = true, registrationOpen = false }: ScreenOptions) => {
  const session = signedIn ? { session: SESSION, user: { ...ME, emailVerified: true } } : null;
  const registration: Answer<"GET /api/registration"> = {
    open: registrationOpen,
    tokenRequired: false,
    passkeys: false,
  };
  const answers: Record<string, unknown> = {
    "GET /api/registration": registration,
    "GET /api/auth/get-session": session,
  };
  if (signedIn) {
    Object.assign(answers, {
      "GET /api/me": ME,
      "GET /api/overview": OVERVIEW,
      "GET /api/backends": BACKENDS,
      "GET /api/mounts": MOUNTS,
      "GET /api/keys": KEYS,
      "GET /api/operations": OPERATIONS,
      "GET /api/settings/storage": STORAGE_SETTINGS,
      "GET /api/instance": INSTANCE,
      "GET /api/audit": AUDIT,
      "GET /api/auth/list-sessions": [SESSION],
      "GET /api/auth/passkey/list-user-passkeys": [],
    });
  }
  return answers;
};

const answerApi = (answers: Record<string, unknown>) => async (route: Route) => {
  const request = route.request();
  const key = `${request.method()} ${new URL(request.url()).pathname}`;
  if (Object.hasOwn(answers, key)) {
    await route.fulfill({ json: answers[key] });
    return;
  }
  // Signed out, or anything a screen does not need: what the API says to a visitor.
  await route.fulfill({ status: 401, json: { error: { code: "unauthorized" } } });
};

const answerDav = async (route: Route) => {
  const request = route.request();
  const names = davNames(request.url());
  const path = names.join("/");
  if (request.method() === "PROPFIND") {
    const entries = FOLDERS[path];
    await (entries === undefined
      ? route.fulfill({ status: 404 })
      : route.fulfill({
          status: 207,
          contentType: "application/xml; charset=utf-8",
          body: multistatus(names, entries),
        }));
    return;
  }
  const text = FILES[path];
  await (request.method() === "GET" && text !== undefined
    ? route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: text })
    : route.fulfill({ status: 404 }));
};

/**
 * Makes `page` show the screens' data: the API and WebDAV answered here, and the page's clock at
 * NOW, still running, so that what a screen says about time reads the same on every run.
 */
export const showScreenData = async (page: Page, options: ScreenOptions = {}): Promise<void> => {
  await page.clock.install({ time: NOW });
  await page.route("**/api/**", answerApi(answersFor(options)));
  await page.route("**/dav/**", answerDav);
};
