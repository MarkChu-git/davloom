import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Outcome } from "@davloom/client";
import { ApiError, api, apiCallOnce, authFetchOnce } from "./client";
import {
  createFolder,
  DavError,
  downloadFile,
  readText,
  removeEntry,
  transferEntry,
  uploadFile,
  webdavAddress,
} from "./dav";
import { register, signInWithPassword, signOut } from "./account";
import { createQueryClient, keys } from "./queries";
import { setStepUpHandler } from "./stepUp";

// The requests the Dashboard sends, read off a stand-in for fetch and XMLHttpRequest.

type Call = [string, RequestInit];

let calls: Call[];
let answer: () => Response;

beforeEach(() => {
  calls = [];
  answer = () => new Response(null, { status: 201 });
  vi.stubGlobal("location", { origin: "https://dav.example" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return answer();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const headersOf = (call: Call | undefined): Record<string, string> =>
  Object.fromEntries(new Headers(call?.[1].headers).entries());

describe("WebDAV requests", () => {
  it("every request carries the Dashboard's header and the session cookie", async () => {
    await createFolder(["files", "New folder"]);
    expect(calls[0]?.[0]).toBe("/dav/files/New%20folder/");
    expect(calls[0]?.[1].method).toBe("MKCOL");
    expect(calls[0]?.[1].credentials).toBe("same-origin");
    expect(headersOf(calls[0])["x-davloom-dashboard"]).toBe("1");
  });

  it("deletes a folder at its folder address and a file at its own", async () => {
    await removeEntry(["files", "a"], "folder");
    await removeEntry(["files", "b.txt"], "file");
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      "DELETE /dav/files/a/",
      "DELETE /dav/files/b.txt",
    ]);
  });

  it("moves and copies to a destination path without replacing anything", async () => {
    await transferEntry("move", ["files", "a b.txt"], ["files", "Archive", "a b.txt"], "file");
    await transferEntry("copy", ["files", "Drafts"], ["other", "Drafts"], "folder");
    expect(calls[0]?.[1].method).toBe("MOVE");
    expect(headersOf(calls[0])).toMatchObject({
      destination: "/dav/files/Archive/a%20b.txt",
      overwrite: "F",
    });
    expect(calls[1]?.[0]).toBe("/dav/files/Drafts/");
    expect(calls[1]?.[1].method).toBe("COPY");
    expect(headersOf(calls[1]).destination).toBe("/dav/other/Drafts/");
  });

  it("a refusal throws its status, and a dropped connection status 0", async () => {
    answer = () => new Response(null, { status: 412 });
    await expect(transferEntry("move", ["f", "a"], ["f", "b"], "file")).rejects.toEqual(
      new DavError(412),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(createFolder(["f", "x"])).rejects.toMatchObject({ status: 0 });
  });

  it("reads a file's text", async () => {
    answer = () => new Response("hello", { status: 200 });
    await expect(readText(["files", "a.txt"])).resolves.toBe("hello");
    expect(calls[0]?.[1].method).toBe("GET");
  });

  it("saves a download under the file's name", async () => {
    answer = () => new Response("bytes", { status: 200 });
    const clicked: string[] = [];
    const link = {
      href: "",
      download: "",
      style: { display: "" },
      click: () => clicked.push(link.download),
      remove: vi.fn(),
    };
    vi.stubGlobal("document", { createElement: () => link, body: { append: vi.fn() } });
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() }),
    );
    await downloadFile(["files", "report.pdf"]);
    expect(clicked).toEqual(["report.pdf"]);
    expect(link.remove).toHaveBeenCalled();
  });

  it("the WebDAV address is the origin's /dav/", () => {
    expect(webdavAddress()).toBe("https://dav.example/dav/");
  });
});

/**
 * A stand-in for XMLHttpRequest that answers each request with the next of `statuses` once the
 * body is sent, the last one again when they run out.
 */
const fakeRequest = (
  statuses: number | readonly (readonly [number, string?])[],
  outcome: "load" | "error" = "load",
) => {
  const answers = typeof statuses === "number" ? [[statuses] as const] : [...statuses];
  const sent: { method: string; url: string; headers: Record<string, string>; body: unknown }[] =
    [];
  class FakeRequest {
    status = 0;
    responseText = "";
    private method = "";
    private url = "";
    private readonly headers: Record<string, string> = {};
    private readonly listeners = new Map<string, () => void>();
    readonly upload = {
      listeners: [] as ((event: { loaded: number }) => void)[],
      addEventListener: (_: string, listener: (event: { loaded: number }) => void) => {
        this.upload.listeners.push(listener);
      },
    };
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, listener);
    }
    send(body: Blob) {
      sent.push({ method: this.method, url: this.url, headers: this.headers, body });
      for (const listener of this.upload.listeners) listener({ loaded: Math.floor(body.size / 2) });
      const [status, text = ""] = (answers.length > 1 ? answers.shift() : answers[0]) ?? [0];
      this.status = status;
      this.responseText = text;
      queueMicrotask(() => this.listeners.get(outcome)?.());
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
  return sent;
};

describe("uploads", () => {
  it("PUTs the file with its type and reports how much has gone", async () => {
    const sent = fakeRequest(201);
    const progress: number[] = [];
    const file = new Blob(["0123456789"], { type: "text/plain" });
    await uploadFile(["files", "a b.txt"], file, (bytes) => progress.push(bytes));
    expect(sent[0]).toMatchObject({
      method: "PUT",
      url: "/dav/files/a%20b.txt",
      headers: { "x-davloom-dashboard": "1", "if-none-match": "*", "content-type": file.type },
    });
    expect(sent).toHaveLength(1);
    expect(progress).toEqual([5, 10]);
  });

  it("replaces a file that is there with a second PUT, after step-up verification", async () => {
    const refused = JSON.stringify({ error: { code: "verification_required" } });
    const sent = fakeRequest([[412], [403, refused], [204]]);
    const handler = vi.fn(async () => true);
    const remove = setStepUpHandler(handler);
    try {
      await uploadFile(["files", "a.txt"], new Blob(["0123"]), () => undefined);
    } finally {
      remove();
    }
    expect(sent.map(({ headers }) => headers["if-none-match"] ?? "none")).toEqual([
      "*",
      "none",
      "none",
    ]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keeps a file that is there when the person does not verify", async () => {
    const refused = JSON.stringify({ error: { code: "verification_required" } });
    const sent = fakeRequest([[412], [403, refused]]);
    const remove = setStepUpHandler(async () => false);
    try {
      await expect(
        uploadFile(["files", "a.txt"], new Blob(["0123"]), () => undefined),
      ).rejects.toEqual(new DavError(403, "verification_required"));
    } finally {
      remove();
    }
    expect(sent).toHaveLength(2);
  });

  it("a refused upload throws its status, and a failed one status 0", async () => {
    fakeRequest(507);
    await expect(uploadFile(["f", "a"], new Blob(["x"]), () => undefined)).rejects.toEqual(
      new DavError(507),
    );
    fakeRequest(0, "error");
    await expect(uploadFile(["f", "a"], new Blob(["x"]), () => undefined)).rejects.toEqual(
      new DavError(0),
    );
  });
});

describe("management requests", () => {
  it("signs in, signs out and registers with JSON", async () => {
    answer = () => Response.json({ ok: true });
    expect(await signInWithPassword("a@example.com", "pw")).toBe("signed-in");
    expect(await signInWithPassword("owner", "pw")).toBe("signed-in");
    await signOut();
    await register({ username: "owner", name: "", email: "", password: "p" });
    expect(
      calls.map(
        ([url, init]) => `${init.method} ${url} ${typeof init.body === "string" ? init.body : ""}`,
      ),
    ).toEqual([
      'POST /api/auth/sign-in/email {"email":"a@example.com","password":"pw"}',
      'POST /api/auth/sign-in/username {"username":"owner","password":"pw"}',
      "POST /api/auth/sign-out {}",
      'POST /api/registration {"username":"owner","name":"","email":"","password":"p"}',
    ]);
  });

  it.each<[string, string, () => Promise<Outcome<unknown>>]>([
    ["POST", "/api/backends/check", () => api.backends.check.post()],
    ["PATCH", "/api/keys/k1", () => api.keys({ id: "k1" }).patch({})],
    ["PUT", "/api/settings/storage", () => api.settings.storage.put({})],
    ["DELETE", "/api/keys/k1", () => api.keys({ id: "k1" }).delete()],
  ])("sends JSON with every %s, which the API takes only as JSON", async (method, path, call) => {
    answer = () => Response.json({ ok: true });
    await apiCallOnce(call);
    expect(calls[0]?.[0]).toBe(path);
    expect(calls[0]?.[1].method).toBe(method);
    expect(headersOf(calls[0])["content-type"]).toBe("application/json");
    expect(calls[0]?.[1].body).toBe("{}");
  });

  it("sends a GET without a body or a type", async () => {
    answer = () => Response.json({ ok: true });
    await apiCallOnce(() => api.keys.get());
    await authFetchOnce("/api/auth/list-sessions");
    for (const call of calls) {
      expect(call[1].method).toBe("GET");
      expect(headersOf(call)["content-type"]).toBeUndefined();
      expect(call[1].body).toBeUndefined();
    }
    expect(calls).toHaveLength(2);
  });

  it("retries a dropped connection or a server error, but not a refusal", () => {
    const client = createQueryClient();
    const retry = client.getDefaultOptions().queries?.retry;
    if (typeof retry !== "function") throw new Error("no retry function");
    expect(retry(0, new ApiError(0, "network_error"))).toBe(true);
    expect(retry(1, new ApiError(503, "x"))).toBe(true);
    expect(retry(2, new ApiError(503, "x"))).toBe(false);
    expect(retry(0, new ApiError(404, "not_found"))).toBe(false);
    expect(retry(0, new ApiError(401, "unauthorized"))).toBe(false);
  });

  it("a 401 on any read but the session's reads the session again", async () => {
    const client = createQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await client
      .fetchQuery({
        queryKey: keys.apiKeys,
        queryFn: () => Promise.reject(new ApiError(401, "unauthorized")),
        retry: false,
      })
      .catch(() => undefined);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.me });
    invalidate.mockClear();
    await client
      .fetchQuery({
        queryKey: keys.me,
        queryFn: () => Promise.reject(new ApiError(401, "unauthorized")),
        retry: false,
      })
      .catch(() => undefined);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each([{ queryKey: keys.me }, { queryKey: keys.apiKeys }, { queryKey: keys.overview }])(
    "a 401 on $queryKey forgets a session the sign-in page read, so it shows the form",
    async ({ queryKey }) => {
      const client = createQueryClient();
      client.setQueryData(keys.session, { user: { id: "u" } });
      await client
        .fetchQuery({
          queryKey,
          queryFn: () => Promise.reject(new ApiError(401, "unauthorized")),
          retry: false,
        })
        .catch(() => undefined);
      expect(client.getQueryData(keys.session)).toBeNull();
    },
  );

  it("a refusal other than 401 keeps the session", async () => {
    const client = createQueryClient();
    client.setQueryData(keys.session, { user: { id: "u" } });
    await client
      .fetchQuery({
        queryKey: keys.apiKeys,
        queryFn: () => Promise.reject(new ApiError(403, "forbidden")),
        retry: false,
      })
      .catch(() => undefined);
    expect(client.getQueryData(keys.session)).toEqual({ user: { id: "u" } });
  });
});
