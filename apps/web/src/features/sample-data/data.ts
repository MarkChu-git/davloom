/**
 * Sample data for the Dashboard prototype. Nothing here comes from a server: every page reads
 * these values until the Dashboard calls the API (PRD §8). Dates are fixed so screenshots stay
 * stable.
 */

export const SAMPLE_NOW = new Date("2026-11-16T15:30:00Z");

const minutesAgo = (minutes: number): string =>
  new Date(SAMPLE_NOW.getTime() - minutes * 60_000).toISOString();

export const instance = {
  name: "Home storage",
  version: "0.0.0",
  deployment: "Cloudflare Free",
  runtime: "Cloudflare Workers",
  database: "Cloudflare D1",
  webdavUrl: "https://files.example.com/dav/",
  region: "Automatic (nearest data center)",
  commit: "b97dfc8",
} as const;

export type BackendStatus = "connected" | "degraded" | "unreachable";

export interface StorageBackend extends Record<string, unknown> {
  id: string;
  name: string;
  kind: string;
  /** Where Davloom reaches the backend; absent for Durable Objects, which Davloom itself runs. */
  endpoint?: string;
  status: BackendStatus;
  objectCount: number;
  usedBytes: number;
  /** Absent when the backend does not report a limit. */
  capacityBytes?: number;
  checkedAt: string;
  statusDetail: string;
}

export const backends: StorageBackend[] = [
  {
    id: "do",
    name: "Durable Objects",
    kind: "Cloudflare Durable Objects",
    status: "connected",
    objectCount: 12_480,
    usedBytes: 1_860_000_000,
    capacityBytes: 5_000_000_000,
    checkedAt: minutesAgo(1),
    statusDetail: "answered in 38\u00a0ms",
  },
  {
    id: "r2",
    name: "R2 photos",
    kind: "Cloudflare R2",
    endpoint: "davloom-photos",
    status: "connected",
    objectCount: 8_215,
    usedBytes: 41_200_000_000,
    checkedAt: minutesAgo(1),
    statusDetail: "answered in 64\u00a0ms",
  },
  {
    id: "rustfs",
    name: "RustFS archive",
    kind: "S3 compatible (RustFS)",
    endpoint: "http://rustfs.lan:9000",
    status: "unreachable",
    objectCount: 3_902,
    usedBytes: 212_000_000_000,
    capacityBytes: 2_000_000_000_000,
    checkedAt: minutesAgo(12),
    statusDetail: "no answer within 30\u00a0s",
  },
];

export interface Mount extends Record<string, unknown> {
  id: string;
  path: string;
  backendId: string;
  bucket: string;
  prefix: string;
}

export const mounts: Mount[] = [
  {
    id: "documents",
    path: "/documents",
    backendId: "do",
    bucket: "default",
    prefix: "documents/",
  },
  {
    id: "shared",
    path: "/shared",
    backendId: "do",
    bucket: "default",
    prefix: "shared/",
  },
  {
    id: "photos",
    path: "/photos",
    backendId: "r2",
    bucket: "davloom-photos",
    prefix: "",
  },
  {
    id: "archive",
    path: "/archive",
    backendId: "rustfs",
    bucket: "davloom-archive",
    prefix: "backups/",
  },
];

export interface OperationError extends Record<string, unknown> {
  id: string;
  method: string;
  path: string;
  status: number;
  message: string;
  at: string;
}

export const recentErrors: OperationError[] = [
  {
    id: "e1",
    method: "PUT",
    path: "/archive/2026-11-16.tar.zst",
    status: 504,
    message: "RustFS archive did not answer within 30\u00a0s.",
    at: minutesAgo(12),
  },
  {
    id: "e2",
    method: "MOVE",
    path: "/documents/Drafts → /shared/Drafts",
    status: 412,
    message: "/shared already has Drafts, and the client asked not to overwrite it.",
    at: minutesAgo(47),
  },
  {
    id: "e3",
    method: "PUT",
    path: "/documents/budget-2027.xlsx",
    status: 423,
    message: "The file is locked by another client.",
    at: minutesAgo(95),
  },
  {
    id: "e4",
    method: "PUT",
    path: "/photos/2026/holiday.mov",
    status: 413,
    message: "Uploads over 100\u00a0MB do not fit one request on Cloudflare Free.",
    at: minutesAgo(310),
  },
];

/** Operations recorded in one hour of the audit log (PRD §7, `audit_events`). */
export interface HourlyOperations {
  /** Whole hours between the end of this hour and the sample clock: 0 is the latest hour. */
  hoursAgo: number;
  operations: number;
  /** Operations that failed in this hour; each one is in `recentErrors`. */
  failed: number;
}

/** Operations per hour, oldest first: quiet at night, busy while clients sync in the morning. */
const HOURLY_COUNTS = [
  114, 156, 183, 141, 99, 63, 42, 27, 21, 36, 288, 426, 354, 192, 123, 111, 135, 174, 216, 198, 162,
  147, 183, 141,
];

/** The last 24 hours of operations, oldest first. */
export const operationsByHour: HourlyOperations[] = HOURLY_COUNTS.map((operations, index) => {
  const hoursAgo = HOURLY_COUNTS.length - 1 - index;
  const failed = recentErrors.filter(
    (error) =>
      Math.floor((SAMPLE_NOW.getTime() - new Date(error.at).getTime()) / 3_600_000) === hoursAgo,
  ).length;
  return { hoursAgo, operations, failed };
});

export type EntryKind = "folder" | "file";

export interface Entry {
  name: string;
  kind: EntryKind;
  sizeBytes: number;
  modifiedAt: string;
  /** Shown in the details pane for text files. */
  text?: string;
  children?: Entry[];
}

const file = (name: string, sizeBytes: number, minutes: number, text?: string): Entry => ({
  name,
  kind: "file",
  sizeBytes,
  modifiedAt: minutesAgo(minutes),
  text,
});

const folder = (name: string, minutes: number, children: Entry[]): Entry => ({
  name,
  kind: "folder",
  sizeBytes: 0,
  modifiedAt: minutesAgo(minutes),
  children,
});

/** One tree per mount, keyed by the mount id. */
export const fileTrees: Record<string, Entry[]> = {
  documents: [
    folder("Contracts", 4_300, [
      file("lease-2026.pdf", 1_240_000, 9_800),
      file("internet-service.pdf", 312_000, 21_000),
    ]),
    folder("Drafts", 47, [
      file(
        "blog-post-self-hosting.md",
        8_400,
        47,
        "# Why I self-host my files\n\nA WebDAV server on a free plan, my own buckets, and no sync client to babysit.",
      ),
    ]),
    folder("Invoices 2026", 2_900, [
      file("2026-10-electricity.pdf", 188_000, 8_100),
      file("2026-11-water.pdf", 164_000, 2_900),
    ]),
    folder("Scans", 15_000, []),
    file("budget-2027.xlsx", 48_200, 95),
    file(
      "meeting-notes-2026-11-14.md",
      6_200,
      2_700,
      "# Notes, 14 November\n\n- Move the photo backup to R2\n- Give the accountant a read-only key\n- Check the RustFS box after the power cut",
    ),
    file(
      "Quarterly report — Q3 2026, final version (signed by both parties).pdf",
      2_400_000,
      6_000,
    ),
    file(
      "README.txt",
      1_100,
      40_000,
      "This folder syncs to the laptop and the phone through WebDAV.\nDo not rename the top-level folders.",
    ),
    file(
      "an-export-from-the-old-nas-with-a-very-long-file-name-that-keeps-going-2026-11-16.log",
      932_000,
      30,
      "2026-11-16T14:59:58Z copied 3,902 objects\n2026-11-16T15:00:02Z verified checksums\n2026-11-16T15:00:03Z done",
    ),
  ],
  shared: [
    folder("Family", 9_000, [
      file("recipes.md", 3_100, 9_000, "# Recipes\n\n- Dumplings\n- Congee"),
    ]),
    file("wifi-guest.txt", 120, 60_000, "Network: guest\nPassword: on the fridge"),
  ],
  photos: [
    folder("2025", 200_000, [file("IMG_0001.heic", 2_900_000, 200_000)]),
    folder("2026", 310, [
      file("IMG_2041.heic", 3_100_000, 1_200),
      file("IMG_2042.heic", 2_800_000, 1_190),
    ]),
  ],
  archive: [],
};

export type Permission = "read-write" | "read-only";

export interface Credential extends Record<string, unknown> {
  id: string;
  name: string;
  prefix: string;
  permission: Permission;
  scope: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  isRevoked: boolean;
}

export const credentials: Credential[] = [
  {
    id: "k1",
    name: "Laptop (Finder)",
    prefix: "dvl_7Q2M",
    permission: "read-write",
    scope: "All mounts",
    createdAt: minutesAgo(65_000),
    expiresAt: null,
    lastUsedAt: minutesAgo(2),
    isRevoked: false,
  },
  {
    id: "k2",
    name: "Phone photo backup",
    prefix: "dvl_K9XA",
    permission: "read-write",
    scope: "/photos",
    createdAt: minutesAgo(30_000),
    expiresAt: "2027-05-01T00:00:00Z",
    lastUsedAt: minutesAgo(1_300),
    isRevoked: false,
  },
  {
    id: "k3",
    name: "Accountant, invoices only",
    prefix: "dvl_P3VD",
    permission: "read-only",
    scope: "/documents/Invoices 2026",
    createdAt: minutesAgo(9_000),
    expiresAt: "2026-12-31T00:00:00Z",
    lastUsedAt: null,
    isRevoked: false,
  },
  {
    id: "k4",
    name: "Old tablet",
    prefix: "dvl_2HTE",
    permission: "read-only",
    scope: "All mounts",
    createdAt: minutesAgo(400_000),
    expiresAt: "2026-09-30T00:00:00Z",
    lastUsedAt: minutesAgo(80_000),
    isRevoked: true,
  },
  {
    id: "k5",
    name: "Conference laptop",
    prefix: "dvl_M4RC",
    permission: "read-write",
    scope: "/shared",
    createdAt: minutesAgo(80_000),
    expiresAt: "2026-10-31T00:00:00Z",
    lastUsedAt: minutesAgo(30_000),
    isRevoked: false,
  },
];

export const profile = {
  name: "Owner",
  email: "owner@example.com",
} as const;
