import { LayerProvider } from "@astryxdesign/core/Layer";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chooseFromMenu,
  chooseOption,
  fill,
  handleCanceledAnimations,
  layOutAt,
  WIDE,
} from "../../test/layout";
import { json, renderPage, type Handler } from "../../test/render";
import type { Backend, BackendCheck, Mount } from "../api/queries";
import { endpointOf } from "./BackendCard";
import { s3Config, s3Problems, type S3Fields } from "./BackendForm";
import { StoragePage } from "./StoragePage";

// Storage & Mounts: S3-compatible backends, editing, checking and removing backends, and the
// default backend for new mounts.

handleCanceledAnimations();

const Page = () => (
  <LayerProvider>
    <StoragePage />
  </LayerProvider>
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const S3_CONFIG = {
  endpoint: "https://s3.example.com",
  region: "eu-west-1",
  bucket: "photos",
  prefix: "davloom/",
  forcePathStyle: true,
  accessKeyId: "AKIA1",
};

const DURABLE: Backend = {
  id: "b1",
  name: "Primary",
  kind: "durable-object",
  createdAt: "2026-03-01T12:00:00Z",
  available: true,
  usage: { files: 3, collections: 2, bytes: 250 },
  capacity: 1000,
  config: {},
  hasSecretKey: false,
};
const BUCKET: Backend = {
  id: "b2",
  name: "Photos",
  kind: "s3",
  createdAt: "2026-03-02T12:00:00Z",
  available: true,
  usage: { files: 1, collections: 0, bytes: 10 },
  capacity: null,
  config: S3_CONFIG,
  hasSecretKey: true,
};
const FILES: Mount = {
  id: "files",
  name: "files",
  backendId: "b1",
  backendKind: "durable-object",
  root: "",
  createdAt: "2026-03-03T12:00:00Z",
};

const api = (
  more: Record<string, Handler> = {},
  backends = [DURABLE, BUCKET],
  mounts = [FILES],
) => ({
  "GET /api/backends": () => json(backends),
  "GET /api/mounts": () => json(mounts),
  "GET /api/settings/storage": () => json({ defaultBackendId: "b2" }),
  "GET /api/instance": () =>
    json({
      version: "0.0.0",
      commit: null,
      runtime: "Bun",
      deployment: "Self-hosted",
      region: null,
      database: "SQLite",
      storageKinds: ["durable-object", "s3"],
    }),
  ...more,
});

const cardOf = (name: string): HTMLElement => {
  let element: HTMLElement | null = screen.getByRole("heading", { level: 3, name });
  while (element !== null && !(element.textContent ?? "").includes("Verify connection")) {
    element = element.parentElement;
  }
  if (element === null) throw new Error(`No card for ${name}`);
  return element;
};

const inDialog = () => within(screen.getByRole("dialog"));
const textbox = (name: RegExp) => inDialog().getByRole("textbox", { name });
const secret = () =>
  screen.getByRole("dialog").querySelector<HTMLInputElement>('input[type="password"]');

const filledS3 = (patch: Partial<S3Fields> = {}): S3Fields => ({
  endpoint: "https://s3.example.com",
  region: "",
  bucket: "photos",
  prefix: "",
  accessKeyId: "AKIA1",
  secretKey: "secret",
  forcePathStyle: true,
  ...patch,
});

describe("s3Problems", () => {
  it.each([
    ["a valid backend", {}, false, {}],
    ["no endpoint", { endpoint: "" }, false, { endpoint: expect.any(String) }],
    [
      "an endpoint of another scheme",
      { endpoint: "ftp://x" },
      false,
      { endpoint: expect.any(String) },
    ],
    [
      "an endpoint with a query",
      { endpoint: "https://x/?a=1" },
      false,
      { endpoint: expect.any(String) },
    ],
    ["an uppercase region", { region: "EU" }, false, { region: expect.any(String) }],
    ["a bucket of two letters", { bucket: "ab" }, false, { bucket: expect.any(String) }],
    ["a prefix with a leading slash", { prefix: "/a" }, false, { prefix: expect.any(String) }],
    ["no access key", { accessKeyId: " " }, false, { accessKeyId: expect.any(String) }],
    ["no secret on a new backend", { secretKey: "" }, false, { secretKey: expect.any(String) }],
    ["no secret on an edit, which keeps it", { secretKey: "" }, true, {}],
  ])("finds %s", (_, patch, isEditing, problems) => {
    expect(s3Problems(filledS3(patch), isEditing)).toEqual(problems);
  });

  it("sends the configuration trimmed, without the secret", () => {
    expect(s3Config(filledS3({ bucket: " photos ", region: " us-east-1 " }))).toEqual({
      endpoint: "https://s3.example.com",
      region: "us-east-1",
      bucket: "photos",
      prefix: "",
      forcePathStyle: true,
      accessKeyId: "AKIA1",
    });
  });
});

describe("endpointOf", () => {
  it.each([
    [BUCKET, "https://s3.example.com/photos/davloom/"],
    [{ ...BUCKET, config: { ...S3_CONFIG, prefix: "" } }, "https://s3.example.com/photos"],
    [{ ...BUCKET, config: {} }, null],
    [{ ...BUCKET, kind: "r2", config: { binding: "R2" } }, "R2"],
    [{ ...BUCKET, kind: "r2", config: {} }, null],
    [DURABLE, null],
  ])("names where Davloom reaches %#", (backend, endpoint) => {
    expect(endpointOf(backend)).toBe(endpoint);
  });
});

describe("StoragePage, backend cards", () => {
  it("shows the endpoint, objects, capacity used and the default mark", async () => {
    layOutAt(WIDE);
    await renderPage(<Page />, { api: api() });
    await screen.findByRole("heading", { level: 3, name: "Primary" });
    const durable = cardOf("Primary").textContent ?? "";
    expect(durable).toContain("EndpointBuilt in");
    expect(durable).toContain("Objects5");
    expect(durable).toContain("Stored250 bytes of 1 kB");
    expect(screen.getByRole("progressbar", { name: "Primary capacity used" })).toBeTruthy();
    await waitFor(() => expect(cardOf("Photos").textContent).toContain("S3 compatible · Default"));
    expect(cardOf("Photos").textContent).toContain("https://s3.example.com/photos/davloom/");
    expect(cardOf("Photos").textContent).toContain("10 bytes, no fixed limit");
    expect(screen.queryByRole("progressbar", { name: "Photos capacity used" })).toBeNull();
    expect(cardOf("Photos").textContent).toMatch(/Last checked/);
  });

  it.each([
    {
      title: "answers",
      check: { available: true, latencyMs: 38, reason: null },
      label: "Answered just now, in 38 ms",
    },
    {
      title: "does not answer",
      check: { available: false, latencyMs: null, reason: "The bucket does not exist" },
      label: "Still unavailable: The bucket does not exist",
    },
  ])("verifies a backend's connection that $title", async ({ check, label }) => {
    const result: BackendCheck = {
      id: "b2",
      name: "Photos",
      checkedAt: new Date().toISOString(),
      ...check,
    };
    const { calls } = await renderPage(<Page />, {
      api: api({ "POST /api/backends/b2/verify": () => json(result) }),
    });
    await screen.findByRole("heading", { level: 3, name: "Photos" });
    await userEvent.click(
      within(cardOf("Photos")).getByRole("button", { name: "Verify connection" }),
    );
    expect(await within(cardOf("Photos")).findByText(label)).toBeTruthy();
    expect(calls.some((call) => call.url.endsWith("/api/backends/b2/verify"))).toBe(true);
  });

  it("says when the check itself was refused", async () => {
    await renderPage(<Page />, {
      api: api({ "POST /api/backends/b2/verify": () => json({ error: { code: "x" } }, 500) }),
    });
    await screen.findByRole("heading", { level: 3, name: "Photos" });
    await userEvent.click(
      within(cardOf("Photos")).getByRole("button", { name: "Verify connection" }),
    );
    expect(
      await within(cardOf("Photos")).findByText("The server refused the request (500)."),
    ).toBeTruthy();
  });
});

describe("StoragePage, S3-compatible backends", () => {
  it("adds one with its endpoint, bucket, prefix and keys", async () => {
    const { calls } = await renderPage(<Page />, {
      api: api({ "POST /api/backends": () => json({ id: "b9" }, 201) }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Add backend" }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Kind" })).toBeTruthy());
    await chooseOption("Kind", "S3 compatible");
    await fill(textbox(/^Name/), "Archive");
    await fill(textbox(/^Endpoint/), "http://rustfs.lan:9000");
    await fill(textbox(/^Bucket/), "archive");
    await fill(textbox(/^Prefix/), "backups/");
    await fill(textbox(/^Access key ID/), "rustfs");
    const password = secret();
    if (password === null) throw new Error("no secret field");
    await fill(password, "s3cr3t");
    await userEvent.click(inDialog().getByRole("switch", { name: "Path-style addresses" }));
    await userEvent.click(inDialog().getByRole("button", { name: "Add backend" }));
    expect(await screen.findAllByText("Added backend “Archive”.")).not.toHaveLength(0);
    const posted = calls.find((call) => call.method === "POST");
    expect(await posted?.json()).toEqual({
      name: "Archive",
      kind: "s3",
      config: {
        endpoint: "http://rustfs.lan:9000",
        region: "",
        bucket: "archive",
        prefix: "backups/",
        forcePathStyle: false,
        accessKeyId: "rustfs",
      },
      secretKey: "s3cr3t",
    });
  });

  it("names each field that is wrong, and sends nothing", async () => {
    const { calls } = await renderPage(<Page />, { api: api() });
    await userEvent.click(await screen.findByRole("button", { name: "Add backend" }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Kind" })).toBeTruthy());
    await chooseOption("Kind", "S3 compatible");
    await fill(textbox(/^Name/), "Primary");
    await userEvent.click(inDialog().getByRole("button", { name: "Add backend" }));
    for (const problem of [
      "Another backend already has this name.",
      "Enter the endpoint's URL, such as https://s3.example.com.",
      "Use 3 to 63 lowercase letters, digits, dots and hyphens.",
      "Enter the access key ID.",
      "Enter the secret access key.",
    ]) {
      expect(await inDialog().findByText(problem)).toBeTruthy();
    }
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(0);
  });

  it("edits one, keeping the stored secret when the field stays empty", async () => {
    const { calls } = await renderPage(<Page />, {
      api: api({ "PATCH /api/backends/b2": () => json({ id: "b2" }) }),
    });
    await screen.findByRole("heading", { level: 3, name: "Photos" });
    await chooseFromMenu("Actions for backend Photos", "Edit");
    expect(await inDialog().findByRole("heading", { name: "Edit Photos" })).toBeTruthy();
    expect(textbox(/^Endpoint/)).toHaveProperty("value", "https://s3.example.com");
    expect(textbox(/^Bucket/)).toHaveProperty("value", "photos");
    expect(secret()?.value).toBe("");
    await userEvent.clear(textbox(/^Bucket/));
    await fill(textbox(/^Bucket/), "albums");
    await userEvent.click(inDialog().getByRole("button", { name: "Save" }));
    expect(await screen.findAllByText("Saved “Photos”.")).not.toHaveLength(0);
    const patched = calls.find((call) => call.method === "PATCH");
    expect(await patched?.json()).toEqual({
      name: "Photos",
      config: { ...S3_CONFIG, bucket: "albums" },
    });
  });

  it("renames a Durable Objects backend", async () => {
    const { calls } = await renderPage(<Page />, {
      api: api({ "PATCH /api/backends/b1": () => json({ id: "b1" }) }),
    });
    await screen.findByRole("heading", { level: 3, name: "Primary" });
    await chooseFromMenu("Actions for backend Primary", "Edit");
    await screen.findByRole("dialog");
    await userEvent.clear(textbox(/^Name/));
    await fill(textbox(/^Name/), "Main{Enter}");
    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    expect(await calls.find((call) => call.method === "PATCH")?.json()).toEqual({ name: "Main" });
  });

  it.each([
    {
      code: "invalid_input",
      status: 400,
      problem: "The server refused these values. Check each field.",
    },
    { code: "name_taken", status: 409, problem: "Another backend already has this name." },
    { code: "boom", status: 500, problem: "The server refused the request (500)." },
  ])("says why the server refused the change ($code)", async ({ code, status, problem }) => {
    await renderPage(<Page />, {
      api: api({ "PATCH /api/backends/b2": () => json({ error: { code } }, status) }),
    });
    await screen.findByRole("heading", { level: 3, name: "Photos" });
    await chooseFromMenu("Actions for backend Photos", "Edit");
    await screen.findByRole("dialog");
    await userEvent.click(inDialog().getByRole("button", { name: "Save" }));
    expect(await inDialog().findByText(problem)).toBeTruthy();
  });
});

describe("StoragePage, removing backends", () => {
  it.each([
    {
      name: "Photos",
      id: "b2",
      description:
        "Its objects stay in the bucket. Davloom forgets the backend and its WebDAV properties.",
      answer: { id: "b2", filesKept: true },
      toast: "Removed “Photos”. Its objects stay in the bucket.",
    },
    {
      name: "Primary",
      id: "b1",
      description:
        "Its storage is deleted with it. A backend that still holds files cannot be removed.",
      answer: { id: "b1", filesKept: false },
      toast: "Removed “Primary” and its storage.",
      mounts: [],
    },
  ])("removes $name and says what happens to its data", async (row) => {
    const { calls } = await renderPage(<Page />, {
      api: api(
        { [`DELETE /api/backends/${row.id}`]: () => json(row.answer) },
        [DURABLE, BUCKET],
        row.mounts ?? [FILES],
      ),
    });
    await screen.findByRole("heading", { level: 3, name: row.name });
    await chooseFromMenu(`Actions for backend ${row.name}`, "Remove");
    const confirmation = within(await screen.findByRole("alertdialog"));
    expect(confirmation.getByText(row.description)).toBeTruthy();
    await userEvent.click(confirmation.getByRole("button", { name: "Remove backend" }));
    expect(await screen.findAllByText(row.toast)).not.toHaveLength(0);
    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
  });

  it("names the mounts that use a backend, and the server's refusal", async () => {
    await renderPage(<Page />, {
      api: api({
        "DELETE /api/backends/b1": () => json({ error: { code: "backend_in_use" } }, 409),
      }),
    });
    await screen.findByRole("heading", { level: 3, name: "Primary" });
    await chooseFromMenu("Actions for backend Primary", "Remove");
    const confirmation = within(await screen.findByRole("alertdialog"));
    expect(
      confirmation.getByText("/files uses this backend. Move or remove it first."),
    ).toBeTruthy();
    await userEvent.click(confirmation.getByRole("button", { name: "Remove backend" }));
    expect(
      await screen.findAllByText("A mount uses this backend. Move or remove the mount first."),
    ).not.toHaveLength(0);
  });
});

describe("StoragePage, default backend", () => {
  it("starts a new mount on the default backend", async () => {
    await renderPage(<Page />, { api: api() });
    await screen.findByRole("heading", { level: 3, name: "Photos" });
    await waitFor(() => expect(cardOf("Photos").textContent).toContain("Default"));
    await userEvent.click(screen.getByRole("button", { name: "Add mount" }));
    await screen.findByRole("dialog");
    expect(
      within(inDialog().getByRole("combobox", { name: "Backend" })).getByText("Photos"),
    ).toBeTruthy();
  });
});
