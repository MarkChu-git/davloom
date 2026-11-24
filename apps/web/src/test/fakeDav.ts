import { vi } from "vitest";
import { hrefParts, type EntryKind } from "../features/api/dav";
import type { Handler } from "./render";

// An in-memory WebDAV server for the Files page: PROPFIND, GET, MKCOL, MOVE, COPY, DELETE, LOCK
// and UNLOCK through `fetch`, and PUT through a stand-in for XMLHttpRequest, as the page sends them.

export interface FakeLock {
  token: string;
  owner: string;
  /** "0" or "infinity". */
  depth: string;
  /** Seconds left; null for an Infinite lock. */
  seconds: number | null;
  /** Whether lockdiscovery shows the token, as the server does for a credential that may unlock. */
  showsToken?: boolean;
}

export interface FakeNode {
  kind: EntryKind;
  body: string;
  contentType: string;
  modifiedAt: string;
}

export interface FakeFile {
  body?: string;
  contentType?: string;
  modifiedAt?: string;
  /** A size to report instead of the body's length. */
  sizeBytes?: number;
}

const escapeXml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const keyOf = (parts: readonly string[]): string => `/${parts.join("/")}`;

const parentOf = (key: string): string => key.slice(0, key.lastIndexOf("/")) || "/";

const encodedHref = (key: string, kind: EntryKind): string =>
  `/dav${key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}${kind === "folder" ? "/" : ""}`;

const status = (code: number) => new Response(null, { status: code });

type Put = (key: string, body: string, contentType: string) => Promise<number>;

/** A stand-in for XMLHttpRequest that sends each PUT to `put`, reporting half its bytes first. */
const requestInto = (put: Put) =>
  class FakeRequest {
    status = 0;
    private url = "";
    private contentType = "";
    private readonly listeners = new Map<string, () => void>();
    private progress?: (event: { loaded: number }) => void;
    readonly upload = {
      addEventListener: (_type: string, listener: (event: { loaded: number }) => void) => {
        this.progress = listener;
      },
    };

    open(_method: string, url: string) {
      this.url = url;
    }

    setRequestHeader(name: string, value: string) {
      if (name === "content-type") {
        this.contentType = value;
      }
    }

    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, listener);
    }

    send(file: Blob) {
      void this.deliver(file);
    }

    private async deliver(file: Blob) {
      const body = await file.text();
      this.progress?.({ loaded: Math.floor(file.size / 2) });
      // A refusal with status 0 stands for a connection that dropped.
      this.status = await put(keyOf(hrefParts(this.url) ?? []), body, this.contentType);
      this.listeners.get(this.status === 0 ? "error" : "load")?.();
    }
  };

export class FakeDav {
  readonly nodes = new Map<string, FakeNode>();
  /** Sizes that differ from a body's length, by path. */
  readonly sizes = new Map<string, number>();
  /** Answers given instead of the real one, by "METHOD /files/path". */
  readonly refusals = new Map<string, number>();
  /** Requests that wait for `release()` before they are answered, by "METHOD /files/path". */
  readonly held = new Set<string>();
  private readonly waiting: (() => void)[] = [];
  /** Write locks, by the path they are rooted at. */
  readonly locks = new Map<string, FakeLock>();
  /** Every LOCK and UNLOCK request, in order, for tests to read their headers. */
  readonly lockRequests: Request[] = [];
  private nextToken = 1;

  lock(path: string, lock: Partial<FakeLock> = {}): this {
    this.locks.set(path, {
      token: `urn:uuid:lock-${this.nextToken++}`,
      owner: "Finder",
      depth: "0",
      seconds: 600,
      ...lock,
    });
    return this;
  }

  /** The lock rooted at a path or, with Depth infinity, at a folder above it. */
  private lockOn(key: string): [string, FakeLock] | undefined {
    for (const [root, lock] of this.locks) {
      if (root === key || (lock.depth === "infinity" && key.startsWith(`${root}/`))) {
        return [root, lock];
      }
    }
    return undefined;
  }

  private lockDiscovery(key: string): string {
    const found = this.lockOn(key);
    if (found === undefined) {
      return "<lockdiscovery/>";
    }
    const [root, lock] = found;
    const rootKind = this.nodes.get(root)?.kind ?? "file";
    return `<lockdiscovery><activelock><locktype><write/></locktype><lockscope><exclusive/></lockscope><depth>${lock.depth}</depth><owner><href>${escapeXml(lock.owner)}</href></owner><timeout>${lock.seconds === null ? "Infinite" : `Second-${lock.seconds}`}</timeout>${
      lock.showsToken === false ? "" : `<locktoken><href>${lock.token}</href></locktoken>`
    }<lockroot><href>${escapeXml(encodedHref(root, rootKind))}</href></lockroot></activelock></lockdiscovery>`;
  }

  folder(path: string): this {
    this.nodes.set(path, { kind: "folder", body: "", contentType: "", modifiedAt: "" });
    return this;
  }

  file(path: string, { body = "", contentType = "", modifiedAt = "", sizeBytes }: FakeFile = {}) {
    this.nodes.set(path, { kind: "file", body, contentType, modifiedAt });
    if (sizeBytes !== undefined) {
      this.sizes.set(path, sizeBytes);
    }
    return this;
  }

  /** The paths stored, sorted. */
  paths(): string[] {
    return [...this.nodes.keys()].toSorted();
  }

  /** How many requests `held` keeps waiting. */
  holding(): number {
    return this.waiting.length;
  }

  /** Answers every request that `held` kept waiting, and holds no more. */
  release(): void {
    this.held.clear();
    for (const resume of this.waiting.splice(0)) {
      resume();
    }
  }

  private sizeOf(key: string, node: FakeNode): number {
    return this.sizes.get(key) ?? new TextEncoder().encode(node.body).length;
  }

  private childrenOf(key: string): string[] {
    return [...this.nodes.keys()].filter((path) => path !== key && parentOf(path) === key);
  }

  private within(key: string): string[] {
    return [...this.nodes.keys()].filter((path) => path === key || path.startsWith(`${key}/`));
  }

  private propstat(key: string, node: FakeNode): string {
    const props =
      node.kind === "folder"
        ? "<resourcetype><collection/></resourcetype>"
        : `<resourcetype/><getcontentlength>${this.sizeOf(key, node)}</getcontentlength>${
            node.contentType === ""
              ? ""
              : `<getcontenttype>${escapeXml(node.contentType)}</getcontenttype>`
          }`;
    const modified =
      node.modifiedAt === ""
        ? ""
        : `<getlastmodified>${new Date(node.modifiedAt).toUTCString()}</getlastmodified>`;
    return `<response><href>${escapeXml(encodedHref(key, node.kind))}</href><propstat><prop>${props}${modified}${this.lockDiscovery(key)}</prop><status>HTTP/1.1 200 OK</status></propstat></response>`;
  }

  private propfind(key: string, node: FakeNode): Response {
    if (node.kind !== "folder") {
      return status(404);
    }
    const body = [key, ...this.childrenOf(key)]
      .map((path) => {
        const found = this.nodes.get(path);
        return found === undefined ? "" : this.propstat(path, found);
      })
      .join("");
    // The default namespace: happy-dom's XML parser finds no prefixed element by its namespace.
    return new Response(`<?xml version="1.0"?><multistatus xmlns="DAV:">${body}</multistatus>`, {
      status: 207,
      headers: { "content-type": "application/xml" },
    });
  }

  private transfer(request: Request, key: string, isMove: boolean): Response {
    const destination = hrefParts(request.headers.get("destination") ?? "");
    if (destination === undefined) {
      return status(400);
    }
    const target = keyOf(destination);
    if (!this.nodes.has(parentOf(target))) {
      return status(409);
    }
    if (this.nodes.has(target)) {
      return status(412);
    }
    for (const path of this.within(key)) {
      const node = this.nodes.get(path);
      if (node !== undefined) {
        this.nodes.set(`${target}${path.slice(key.length)}`, { ...node });
        const size = this.sizes.get(path);
        if (size !== undefined) {
          this.sizes.set(`${target}${path.slice(key.length)}`, size);
        }
      }
      if (isMove) {
        this.nodes.delete(path);
      }
    }
    return status(201);
  }

  private answer(request: Request, key: string): Response {
    const node = this.nodes.get(key);
    switch (request.method) {
      case "PROPFIND":
        return node === undefined ? status(404) : this.propfind(key, node);
      case "GET":
        return node === undefined || node.kind === "folder"
          ? status(404)
          : new Response(node.body, { headers: { "content-type": node.contentType } });
      case "MKCOL":
        if (node !== undefined) {
          return status(405);
        }
        if (!this.nodes.has(parentOf(key))) {
          return status(409);
        }
        this.folder(key);
        return status(201);
      case "MOVE":
      case "COPY":
        return node === undefined
          ? status(404)
          : this.transfer(request, key, request.method === "MOVE");
      case "DELETE":
        if (node === undefined) {
          return status(404);
        }
        for (const path of this.within(key)) {
          this.nodes.delete(path);
        }
        return status(204);
      case "LOCK": {
        this.lockRequests.push(request);
        if (node === undefined) {
          return status(404);
        }
        if (this.lockOn(key) !== undefined) {
          return status(423);
        }
        const seconds = Number(/^Second-(\d+)$/i.exec(request.headers.get("timeout") ?? "")?.[1]);
        this.lock(key, {
          owner: "Davloom Dashboard",
          depth: request.headers.get("depth") ?? "infinity",
          seconds: Number.isFinite(seconds) ? seconds : null,
        });
        return new Response(null, {
          status: 200,
          headers: { "lock-token": `<${this.locks.get(key)?.token ?? ""}>` },
        });
      }
      case "UNLOCK": {
        this.lockRequests.push(request);
        const found = this.lockOn(key);
        if (found === undefined || `<${found[1].token}>` !== request.headers.get("lock-token")) {
          return status(409);
        }
        this.locks.delete(found[0]);
        return status(204);
      }
      default:
        return status(405);
    }
  }

  private async pause(name: string): Promise<void> {
    if (this.held.has(name)) {
      await new Promise<void>((resume) => this.waiting.push(resume));
    }
  }

  /** Answers one request to /dav. */
  readonly handle: Handler = async (request) => {
    const parts = hrefParts(request.url) ?? [];
    const key = keyOf(parts);
    const name = `${request.method} ${key}`;
    await this.pause(name);
    const refusal = this.refusals.get(name);
    return refusal === undefined ? this.answer(request, key) : status(refusal);
  };

  /** Stores a PUT, as the upload's XMLHttpRequest sends it, and answers its status. */
  async put(key: string, body: string, contentType: string): Promise<number> {
    await this.pause(`PUT ${key}`);
    const refusal = this.refusals.get(`PUT ${key}`);
    if (refusal !== undefined) {
      return refusal;
    }
    if (!this.nodes.has(parentOf(key))) {
      return 409;
    }
    if (this.nodes.get(key)?.kind === "folder") {
      return 405;
    }
    this.file(key, { body, contentType });
    return 201;
  }

  /** The handlers for renderPage: every request to /dav that `rest` does not answer goes here. */
  api(rest: Record<string, Handler> = {}): Record<string, Handler> {
    return new Proxy(rest, {
      get: (target, key) => {
        const name = String(key);
        return target[name] ?? (/ \/dav\//.test(name) ? this.handle : undefined);
      },
    });
  }

  /** Puts a stand-in for XMLHttpRequest in place that uploads into this server. */
  installUploads(): void {
    vi.stubGlobal(
      "XMLHttpRequest",
      requestInto((key, body, contentType) => this.put(key, body, contentType)),
    );
  }
}
