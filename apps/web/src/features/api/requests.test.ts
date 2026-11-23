import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
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
import { completeSetup, createQueryClient, keys, signIn, signOut } from "./queries";

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

  it("moves and copies to an absolute destination without replacing anything", async () => {
    await transferEntry("move", ["files", "a b.txt"], ["files", "Archive", "a b.txt"], "file");
    await transferEntry("copy", ["files", "Drafts"], ["other", "Drafts"], "folder");
    expect(calls[0]?.[1].method).toBe("MOVE");
    expect(headersOf(calls[0])).toMatchObject({
      destination: "https://dav.example/dav/files/Archive/a%20b.txt",
      overwrite: "F",
    });
    expect(calls[1]?.[0]).toBe("/dav/files/Drafts/");
    expect(calls[1]?.[1].method).toBe("COPY");
    expect(headersOf(calls[1]).destination).toBe("https://dav.example/dav/other/Drafts/");
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

/** A stand-in for XMLHttpRequest that answers with `status` once the body is sent. */
const fakeRequest = (status: number, outcome: "load" | "error" = "load") => {
  const sent: { method: string; url: string; headers: Record<string, string>; body: unknown }[] =
    [];
  class FakeRequest {
    status = 0;
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
      this.status = status;
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
      headers: { "x-davloom-dashboard": "1", "content-type": file.type },
    });
    expect(progress).toEqual([5, 10]);
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
  it("signs in, signs out and completes setup with JSON", async () => {
    answer = () => Response.json({ ok: true });
    await signIn("a@example.com", "pw");
    await signOut();
    await completeSetup({ name: "A", email: "a@example.com", password: "p", token: "t" });
    expect(
      calls.map(
        ([url, init]) => `${init.method} ${url} ${typeof init.body === "string" ? init.body : ""}`,
      ),
    ).toEqual([
      'POST /api/auth/sign-in/email {"email":"a@example.com","password":"pw"}',
      "POST /api/auth/sign-out {}",
      'POST /api/setup {"name":"A","email":"a@example.com","password":"p","token":"t"}',
    ]);
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
});
