import {
  isWithin,
  parentOf,
  pathKey,
  type DeadProperty,
  type Entry,
  type Path,
  type StorageBackend,
  type Quota,
  type StorageFailure,
  type StorageResult,
} from "@davloom/core";
import { evaluatePreconditions, resolveRange, type Check } from "@davloom/laws";
import {
  parseDepth,
  parseEntityTags,
  parseHttpDate,
  parseOverwrite,
  parseRange,
  toSeconds,
  type EntityTag,
} from "./headers";
import { conflicts, parseIfHeader, type Lock, type LockScope, type LockStore } from "./locks";
import { contentTypeFor } from "./mime";
import { hrefOf, parseDavPath, parseDestination } from "./paths";
import {
  childElements,
  clark,
  DAV,
  escapeText,
  findChild,
  isElement,
  parseXml,
  serializeElement,
  XML_LIMITS,
  type XmlElement,
} from "./xml";

/** The WebDAV entry point. It depends on nothing but Web standard types, so it can run anywhere. */
export type WebDavHandler = (request: Request) => Response | Promise<Response>;

export interface AuthorizeRequest {
  readonly method: string;
  readonly target: Path;
  readonly destination: Path | null;
}

export interface WebDavOptions {
  /** The URL path under which the namespace is served, without a trailing slash, e.g. `/dav`. */
  readonly basePath: string;
  readonly storage: StorageBackend;
  /** Enables Class 2 (LOCK and UNLOCK). Without it the server advertises Class 1 only. */
  readonly locks?: LockStore;
  /** Decides whether the request's credential may make the request; denied requests get 403. */
  readonly authorize?: (request: AuthorizeRequest) => boolean;
  readonly now?: () => number;
  /** The longest lock timeout granted, in seconds. */
  readonly maxLockTimeout?: number;
  /** The largest file a PUT may write, in bytes. */
  readonly maxFileSize?: number;
}

const XML_TYPE = "application/xml; charset=utf-8";
const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  423: "Locked",
  424: "Failed Dependency",
};
const CLASS_1_METHODS = "OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE, PROPFIND, PROPPATCH";

const empty = (status: number, headers?: HeadersInit) => new Response(null, { status, headers });

const xmlDocument = (body: string) => `<?xml version="1.0" encoding="utf-8"?>\n${body}`;

const xmlResponse = (status: number, body: string, headers?: Record<string, string>) =>
  new Response(xmlDocument(body), {
    status,
    headers: { "content-type": XML_TYPE, ...headers },
  });

/** An RFC 4918 §16 precondition error body. */
const davError = (status: number, condition: string) =>
  xmlResponse(status, `<D:error xmlns:D="DAV:">${condition}</D:error>`);

const FAILURE_STATUS: Record<StorageFailure, number> = {
  "not-found": 404,
  "no-parent": 409,
  exists: 405,
  "is-collection": 405,
  "not-collection": 409,
  "into-itself": 403,
  root: 403,
  "insufficient-storage": 507,
  "too-large": 413,
  "size-mismatch": 400,
  unavailable: 503,
  "hidden-objects": 409,
  "cross-backend": 502,
};

const statusLine = (status: number) => `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? ""}`.trim();

const quoteTag = (etag: string) => `"${etag}"`;
const httpDate = (time: number) => new Date(time).toUTCString();

/** Whether two tags match: strongly when both are strong and equal, weakly when the text is equal. */
const tagMatches = (tags: "*" | EntityTag[], etag: string, weak: boolean) =>
  tags === "*" || tags.some((tag) => tag.tag === etag && (weak || !tag.weak));

const readBody = async (request: Request, limit: number): Promise<string | null> => {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
};

type ParsedBody =
  | { kind: "none" }
  | { kind: "xml"; root: XmlElement }
  | { kind: "bad"; status: number };

const readXmlBody = async (request: Request): Promise<ParsedBody> => {
  const text = await readBody(request, XML_LIMITS.bytes);
  if (text === null) return { kind: "bad", status: 413 };
  if (text.trim() === "") return { kind: "none" };
  try {
    return { kind: "xml", root: parseXml(text) };
  } catch {
    return { kind: "bad", status: 400 };
  }
};

/** Passes a body through, erroring it once it delivers more than `limit` bytes. */
const limitStream = (body: ReadableStream<Uint8Array> | null, limit: number) => {
  let exceeded = false;
  let total = 0;
  const limited =
    body?.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          total += chunk.length;
          if (total > limit) {
            exceeded = true;
            controller.error(new RangeError("body too large"));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    ) ?? null;
  return { body: limited, exceeded: () => exceeded };
};

/** A backend that cannot answer; the handler turns it into 503 Service Unavailable. */
class BackendUnavailable extends Error {}

const nameOf = (path: Path) => path.at(-1) ?? "";

// Live properties (RFC 4918 §15), each a function of the entry. null: not defined for it.
type LiveProperty = (entry: Entry, context: { lockDiscovery: string | null }) => string | null;

const LIVE: Record<string, LiveProperty> = {
  creationdate: (entry) => new Date(entry.created).toISOString().replace(/\.\d{3}Z$/, "Z"),
  displayname: (entry) => escapeText(nameOf(entry.path)),
  getcontentlength: (entry) => (entry.kind === "file" ? String(entry.size) : null),
  getcontenttype: (entry) =>
    entry.kind === "file"
      ? escapeText(contentTypeFor(nameOf(entry.path), entry.contentType))
      : null,
  getetag: (entry) => escapeText(quoteTag(entry.etag)),
  getlastmodified: (entry) => httpDate(entry.modified),
  resourcetype: (entry) => (entry.kind === "collection" ? "<D:collection/>" : ""),
  supportedlock: (_, { lockDiscovery }) =>
    lockDiscovery === null
      ? null
      : ["exclusive", "shared"]
          .map(
            (scope) =>
              `<D:lockentry><D:lockscope><D:${scope}/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>`,
          )
          .join(""),
  lockdiscovery: (_, { lockDiscovery }) => lockDiscovery,
};
const LIVE_NAMES = Object.keys(LIVE);

const QUOTA_NAMES = new Set(["quota-available-bytes", "quota-used-bytes"]);
const quotaValue = (local: string, quota: Quota): string | null =>
  local === "quota-used-bytes"
    ? String(quota.used)
    : quota.available === null
      ? null
      : String(quota.available);

const liveElement = (local: string, value: string) =>
  value === "" ? `<D:${local}/>` : `<D:${local}>${value}</D:${local}>`;

const emptyElement = (ns: string, local: string) =>
  ns === DAV ? `<D:${local}/>` : serializeElement({ ns, local, attributes: [], children: [] });

const propstat = (status: number, props: string[]) =>
  props.length === 0
    ? ""
    : `<D:propstat><D:prop>${props.join("")}</D:prop><D:status>${statusLine(status)}</D:status></D:propstat>`;

const activeLockXml = (lock: Lock, basePath: string, now: number, withToken = true) =>
  `<D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:${lock.scope}/></D:lockscope>` +
  `<D:depth>${lock.depth === "0" ? "0" : "infinity"}</D:depth>${lock.owner}` +
  `<D:timeout>Second-${Math.max(0, Math.ceil((lock.expires - now) / 1000))}</D:timeout>` +
  (withToken ? `<D:locktoken><D:href>${escapeText(lock.token)}</D:href></D:locktoken>` : "") +
  `<D:lockroot><D:href>${escapeText(hrefOf(basePath, lock.root, false))}</D:href></D:lockroot></D:activelock>`;

type PropfindRequest =
  | { kind: "allprop"; include: XmlElement[] }
  | { kind: "propname" }
  | { kind: "prop"; props: XmlElement[] };

const parsePropfind = (body: ParsedBody): PropfindRequest | null => {
  if (body.kind === "none") return { kind: "allprop", include: [] };
  if (body.kind !== "xml" || body.root.ns !== DAV || body.root.local !== "propfind") return null;
  const children = childElements(body.root).filter((child) => child.ns === DAV);
  if (children.some((child) => child.local === "propname")) return { kind: "propname" };
  const prop = children.find((child) => child.local === "prop");
  if (prop) return { kind: "prop", props: childElements(prop) };
  if (children.some((child) => child.local === "allprop")) {
    const include = children.find((child) => child.local === "include");
    return { kind: "allprop", include: include ? childElements(include) : [] };
  }
  return null;
};

const parseTimeout = (header: string | null, max: number): number => {
  if (header === null) return max;
  for (const part of header.split(",")) {
    const value = part.trim();
    if (/^infinite$/i.test(value)) return max;
    const match = /^second-(\d+)$/i.exec(value);
    if (match) return Math.max(1, Math.min(Number(match[1]), max));
  }
  return max;
};

const preconditions = (request: Request, entry: Entry | null, read: boolean) => {
  const header = (name: string) => request.headers.get(name);
  const tags = (name: string, weak: boolean): Check => {
    const value = header(name);
    if (value === null) return "unset";
    const parsed = parseEntityTags(value);
    if (parsed === null) return "fails";
    // No tag matches a missing resource, `*` included.
    if (entry === null) return "fails";
    return tagMatches(parsed, entry.etag, weak) ? "holds" : "fails";
  };
  const date = (name: string, holds: (modified: number, since: number) => boolean): Check => {
    const since = parseHttpDate(header(name));
    if (since === null || entry === null) return "unset";
    return holds(toSeconds(entry.modified), toSeconds(since)) ? "holds" : "fails";
  };
  return evaluatePreconditions({
    read,
    ifMatch: tags("if-match", false),
    ifUnmodifiedSince: date("if-unmodified-since", (modified, since) => modified <= since),
    ifNoneMatch: tags("if-none-match", true),
    ifModifiedSince: date("if-modified-since", (modified, since) => modified > since),
  });
};

const preconditionResponse = (verdict: "failed" | "not-modified", entry: Entry | null) =>
  verdict === "failed"
    ? empty(412)
    : empty(
        304,
        entry
          ? { etag: quoteTag(entry.etag), "last-modified": httpDate(entry.modified) }
          : undefined,
      );

const failure = (reason: StorageFailure) => empty(FAILURE_STATUS[reason]);

export const createWebDavHandler = (options: WebDavOptions): WebDavHandler => {
  const { basePath, storage, locks } = options;
  const now = options.now ?? Date.now;
  const maxLockTimeout = options.maxLockTimeout ?? 3600;
  const maxFileSize = options.maxFileSize ?? Number.MAX_SAFE_INTEGER;
  const methods = locks ? `${CLASS_1_METHODS}, LOCK, UNLOCK` : CLASS_1_METHODS;

  /** The entry at a path, or null when there is none; a backend that cannot answer ends the request with 503. */
  const stat = async (path: Path): Promise<Entry | null> => {
    const result = await storage.stat(path);
    if (!result.ok && result.failure === "unavailable") throw new BackendUnavailable();
    return result.ok ? result.value : null;
  };

  /**
   * Whether the credential may read a resource itself: its content, its dead properties and its
   * locks. A scoped key may browse the folders above its roots but read none of them.
   */
  const mayRead = (path: Path): boolean =>
    !options.authorize || options.authorize({ method: "HEAD", target: path, destination: null });

  /** Whether the credential may change a lock rooted at `root`. */
  const mayLock = (root: Path): boolean =>
    !options.authorize || options.authorize({ method: "LOCK", target: root, destination: null });

  const lockDiscoveryOf = async (path: Path): Promise<string | null> => {
    if (!locks) return null;
    const time = now();
    const held = await locks.covering(path, { descendants: false, now: time });
    // A lock rooted where the credential may not lock still shows, without its token.
    return held.map((lock) => activeLockXml(lock, basePath, time, mayLock(lock.root))).join("");
  };

  /** Evaluates the If header; returns the tokens it submits, or a failure response. */
  const evaluateIf = async (
    request: Request,
    url: URL,
    target: Path,
  ): Promise<{ tokens: Set<string> } | { response: Response }> => {
    const header = request.headers.get("if");
    if (header === null) return { tokens: new Set() };
    const lists = parseIfHeader(header);
    if (!lists) return { response: empty(400) };
    const tokens = new Set<string>();
    let anyTrue = false;
    for (const list of lists) {
      let path: Path | null = target;
      if (list.resource !== null) {
        const destination = parseDestination(list.resource, url, basePath);
        path = destination?.kind === "path" ? destination.path : null;
      }
      // A tagged resource the credential may not read is never looked at: its list is false.
      if (path !== null && !mayRead(path)) path = null;
      let listTrue = path !== null;
      const entry = path ? await stat(path) : null;
      const held =
        path && locks ? await locks.covering(path, { descendants: false, now: now() }) : [];
      for (const condition of list.conditions) {
        // A token anywhere in the header is submitted, under Not too (RFC 4918 §10.4.1).
        if (condition.kind === "token") tokens.add(condition.value);
        const holds =
          condition.kind === "token"
            ? held.some((lock) => lock.token === condition.value)
            : entry !== null && condition.value.replace(/^W\//, "") === quoteTag(entry.etag);
        if (holds === condition.not) listTrue = false;
      }
      if (listTrue) anyTrue = true;
    }
    return anyTrue ? { tokens } : { response: empty(412) };
  };

  /** 423 unless every lock on the given paths is one whose token the request submitted. */
  const checkLocks = async (
    checks: readonly { path: Path; descendants: boolean }[],
    tokens: Set<string>,
  ): Promise<Response | null> => {
    if (!locks) return null;
    for (const { path, descendants } of checks) {
      const held = await locks.covering(path, { descendants, now: now() });
      const blocking = held.find((lock) => !tokens.has(lock.token));
      if (blocking) {
        return davError(
          423,
          `<D:lock-token-submitted><D:href>${escapeText(hrefOf(basePath, blocking.root, false))}</D:href></D:lock-token-submitted>`,
        );
      }
    }
    return null;
  };

  /** Applies If-Match, If-None-Match and the date conditions with the proven order. */

  // --- Methods -------------------------------------------------------------------------------

  const answerOptions = () =>
    empty(200, {
      dav: locks ? "1, 2" : "1",
      allow: methods,
      "ms-author-via": "DAV",
    });

  const get = async (request: Request, url: URL, path: Path, head: boolean) => {
    const entry = await stat(path);
    if (!entry) return empty(404);
    // An If header that is false fails every method, reads included (RFC 4918 §10.4.1).
    const ifResult = await evaluateIf(request, url, path);
    if ("response" in ifResult) return ifResult.response;
    if (entry.kind === "collection") return empty(405, { allow: methods });
    const verdict = preconditions(request, entry, true);
    if (verdict !== "pass") return preconditionResponse(verdict, entry);

    const headers: Record<string, string> = {
      etag: quoteTag(entry.etag),
      "last-modified": httpDate(entry.modified),
      "content-type": contentTypeFor(nameOf(path), entry.contentType),
      "accept-ranges": "bytes",
    };
    let range = parseRange(request.headers.get("range"));
    const ifRange = request.headers.get("if-range");
    if (range && ifRange !== null) {
      const tags =
        ifRange.trim().startsWith('"') || ifRange.trim().startsWith("W/")
          ? parseEntityTags(ifRange)
          : null;
      const valid = tags
        ? tags !== "*" && tags.length === 1 && !tags[0]?.weak && tags[0]?.tag === entry.etag
        : parseHttpDate(ifRange) === toSeconds(entry.modified) * 1000;
      if (!valid) range = null;
    }
    let status = 200;
    let byteRange: { start: number; stop: number } | undefined;
    if (range) {
      const resolved = resolveRange(range, entry.size);
      if (resolved === "unsatisfiable") {
        return empty(416, { "content-range": `bytes */${entry.size}`, etag: headers.etag ?? "" });
      }
      byteRange = resolved;
      status = 206;
      headers["content-range"] = `bytes ${resolved.start}-${resolved.stop - 1}/${entry.size}`;
    }
    headers["content-length"] = String(byteRange ? byteRange.stop - byteRange.start : entry.size);
    if (head) return empty(status, headers);
    const read = await storage.read(path, byteRange);
    if (!read.ok) return failure(read.failure);
    return new Response(read.value.body, { status, headers });
  };

  const put = async (request: Request, url: URL, path: Path) => {
    if (path.length === 0) return empty(405, { allow: methods });
    if (request.headers.has("content-range")) return empty(400);
    const lengthHeader = request.headers.get("content-length");
    const size = lengthHeader === null ? undefined : Number(lengthHeader);
    if (size !== undefined && (!Number.isSafeInteger(size) || size < 0)) return empty(400);
    if (size !== undefined && size > maxFileSize) return empty(413);
    const entry = await stat(path);
    const verdict = preconditions(request, entry, false);
    if (verdict !== "pass") return preconditionResponse(verdict, entry);
    const ifResult = await evaluateIf(request, url, path);
    if ("response" in ifResult) return ifResult.response;
    const blocked = await checkLocks(
      [
        { path, descendants: false },
        ...(entry ? [] : [{ path: parentOf(path), descendants: false }]),
      ],
      ifResult.tokens,
    );
    if (blocked) return blocked;
    if (entry?.kind === "collection") return empty(405, { allow: methods });
    const limited = limitStream(request.body, maxFileSize);
    const written = await storage.write(path, limited.body, {
      size,
      contentType: request.headers.get("content-type"),
    });
    if (limited.exceeded()) return empty(413);
    if (!written.ok) return failure(written.failure);
    return empty(written.value.created ? 201 : 204, {
      etag: quoteTag(written.value.entry.etag),
      "last-modified": httpDate(written.value.entry.modified),
    });
  };

  const mkcol = async (request: Request, url: URL, path: Path) => {
    const body = await readBody(request, 1);
    if (body === null || body !== "") return empty(415);
    const ifResult = await evaluateIf(request, url, path);
    if ("response" in ifResult) return ifResult.response;
    const blocked = await checkLocks(
      [
        { path, descendants: false },
        { path: parentOf(path), descendants: false },
      ],
      ifResult.tokens,
    );
    if (blocked) return blocked;
    const created = await storage.createCollection(path);
    if (!created.ok) return failure(created.failure);
    return empty(201);
  };

  const remove = async (request: Request, url: URL, path: Path) => {
    const depth = parseDepth(request.headers.get("depth"));
    const entry = await stat(path);
    if (!entry) return empty(404);
    if (entry.kind === "collection" && depth !== undefined && depth !== "infinity")
      return empty(400);
    const verdict = preconditions(request, entry, false);
    if (verdict !== "pass") return preconditionResponse(verdict, entry);
    const ifResult = await evaluateIf(request, url, path);
    if ("response" in ifResult) return ifResult.response;
    if (path.length > 0) {
      const blocked = await checkLocks(
        [
          { path, descendants: true },
          { path: parentOf(path), descendants: false },
        ],
        ifResult.tokens,
      );
      if (blocked) return blocked;
    }
    const removed = await storage.remove(path);
    if (!removed.ok) return failure(removed.failure);
    await locks?.removeTree(path);
    return empty(204);
  };

  const transfer = async (request: Request, url: URL, path: Path, move: boolean) => {
    const destination = parseDestination(request.headers.get("destination"), url, basePath);
    if (!destination || destination.kind === "invalid") return empty(400);
    if (destination.kind === "foreign") return empty(502);
    const overwrite = parseOverwrite(request.headers.get("overwrite"));
    if (overwrite === null) return empty(400);
    const depth = parseDepth(request.headers.get("depth"));
    if (depth === null || depth === "1" || (move && depth === "0")) return empty(400);
    const to = destination.path;
    if (
      options.authorize &&
      !options.authorize({ method: request.method, target: path, destination: to })
    ) {
      return empty(403);
    }
    const entry = await stat(path);
    if (!entry) return empty(404);
    const verdict = preconditions(request, entry, false);
    if (verdict !== "pass") return preconditionResponse(verdict, entry);
    const ifResult = await evaluateIf(request, url, path);
    if ("response" in ifResult) return ifResult.response;
    const checks = [
      { path: to, descendants: true },
      { path: parentOf(to), descendants: false },
    ];
    if (move)
      checks.unshift({ path, descendants: true }, { path: parentOf(path), descendants: false });
    if (pathKey(path) !== pathKey(to) && !isWithin(to, path)) {
      const blocked = await checkLocks(to.length === 0 ? [] : checks, ifResult.tokens);
      if (blocked) return blocked;
    }
    const result = move
      ? await storage.move(path, to, { overwrite })
      : await storage.copy(path, to, { overwrite, shallow: depth === "0" });
    if (!result.ok) {
      if (result.failure === "exists") return empty(412);
      if (result.failure === "root" || result.failure === "into-itself") return empty(403);
      return failure(result.failure);
    }
    if (move) await locks?.removeTree(path);
    return empty(result.value.replaced ? 204 : 201);
  };

  const propfind = async (request: Request, url: URL, path: Path) => {
    const parsedDepth = parseDepth(request.headers.get("depth"));
    if (parsedDepth === null) return empty(400);
    const depth = parsedDepth ?? "infinity";
    const body = await readXmlBody(request);
    if (body.kind === "bad") return empty(body.status);
    const query = parsePropfind(body);
    if (!query) return empty(400);
    const entry = await stat(path);
    if (!entry) return empty(404);
    const ifResult = await evaluateIf(request, url, path);
    if ("response" in ifResult) return ifResult.response;
    if (depth === "infinity" && entry.kind === "collection") {
      return davError(403, "<D:propfind-finite-depth/>");
    }
    const entries: Entry[] = [entry];
    if (depth === "1" && entry.kind === "collection") {
      const children = await storage.list(path);
      if (!children.ok) return failure(children.failure);
      entries.push(...children.value);
    }
    const deadResult =
      query.kind === "prop" &&
      query.props.every((prop) => prop.ns === DAV && Object.hasOwn(LIVE, prop.local))
        ? null
        : await storage.properties(entries.map((e) => e.path));
    const dead: Record<string, readonly DeadProperty[]> = deadResult?.ok ? deadResult.value : {};

    const responses: string[] = [];
    // RFC 4331 quota, computed once per request and only when asked for: allprop leaves it out.
    const quotas = new Map<string, StorageResult<Quota> | null>();
    for (const item of entries) {
      // Above a scoped key's roots a folder shows only what leads to them: no locks, no properties.
      const readable = mayRead(item.path);
      const lockDiscovery = readable ? await lockDiscoveryOf(item.path) : locks ? "" : null;
      const context = { lockDiscovery };
      const deadProps =
        readable && Object.hasOwn(dead, pathKey(item.path)) ? (dead[pathKey(item.path)] ?? []) : [];
      const found: string[] = [];
      const missing: string[] = [];
      if (query.kind === "propname") {
        for (const local of LIVE_NAMES) {
          if (LIVE[local]?.(item, context) !== null) found.push(`<D:${local}/>`);
        }
        for (const property of deadProps) {
          const { ns, local } = splitClark(property.name);
          found.push(emptyElement(ns, local));
        }
      } else if (query.kind === "allprop") {
        for (const local of LIVE_NAMES) {
          const value = LIVE[local]?.(item, context) ?? null;
          if (value !== null) found.push(liveElement(local, value));
        }
        for (const property of deadProps) found.push(property.xml);
        // DAV:include names properties that allprop leaves out, such as the quota (RFC 4918 §9.1).
        for (const prop of query.include) {
          if (prop.ns !== DAV || !QUOTA_NAMES.has(prop.local) || item.kind !== "collection")
            continue;
          const scope = item.path[0] ?? "";
          if (!quotas.has(scope))
            quotas.set(scope, storage.quota ? await storage.quota(item.path) : null);
          const quota = quotas.get(scope);
          const value = quota?.ok ? quotaValue(prop.local, quota.value) : null;
          if (value !== null) found.push(liveElement(prop.local, value));
        }
      } else {
        for (const prop of query.props) {
          if (prop.ns === DAV && QUOTA_NAMES.has(prop.local) && item.kind === "collection") {
            // One answer per top-level collection: each Mount has its own backend.
            const scope = item.path[0] ?? "";
            if (!quotas.has(scope))
              quotas.set(scope, storage.quota ? await storage.quota(item.path) : null);
            const quota = quotas.get(scope);
            const value = quota?.ok ? quotaValue(prop.local, quota.value) : null;
            if (value !== null) {
              found.push(liveElement(prop.local, value));
              continue;
            }
          }
          const live =
            prop.ns === DAV && Object.hasOwn(LIVE, prop.local) ? LIVE[prop.local] : undefined;
          const value = live ? live(item, context) : null;
          if (value !== null) {
            found.push(liveElement(prop.local, value));
            continue;
          }
          const property = deadProps.find((p) => p.name === clark(prop.ns, prop.local));
          if (property) found.push(property.xml);
          else missing.push(emptyElement(prop.ns, prop.local));
        }
      }
      responses.push(
        `<D:response><D:href>${escapeText(hrefOf(basePath, item.path, item.kind === "collection"))}</D:href>` +
          `${propstat(200, found)}${propstat(404, missing)}</D:response>`,
      );
    }
    return xmlResponse(207, `<D:multistatus xmlns:D="DAV:">${responses.join("")}</D:multistatus>`);
  };

  const proppatch = async (request: Request, url: URL, path: Path) => {
    const body = await readXmlBody(request);
    if (body.kind === "bad") return empty(body.status);
    if (body.kind !== "xml" || body.root.ns !== DAV || body.root.local !== "propertyupdate")
      return empty(400);
    const entry = await stat(path);
    if (!entry) return empty(404);
    const ifResult = await evaluateIf(request, url, path);
    if ("response" in ifResult) return ifResult.response;
    const blocked = await checkLocks([{ path, descendants: false }], ifResult.tokens);
    if (blocked) return blocked;

    // Instructions apply in document order; the last one for a name wins.
    const updates = new Map<string, { element: XmlElement; set: boolean }>();
    for (const instruction of childElements(body.root)) {
      if (instruction.ns !== DAV || (instruction.local !== "set" && instruction.local !== "remove"))
        continue;
      const prop = findChild(instruction, DAV, "prop");
      if (!prop) return empty(400);
      for (const element of childElements(prop)) {
        updates.set(clark(element.ns, element.local), {
          element,
          set: instruction.local === "set",
        });
      }
    }
    const protectedNames = [...updates.values()].filter(({ element }) => element.ns === DAV);
    const results: string[] = [];
    if (protectedNames.length > 0) {
      const forbidden = protectedNames.map(({ element }) =>
        emptyElement(element.ns, element.local),
      );
      const dependent = [...updates.values()]
        .filter(({ element }) => element.ns !== DAV)
        .map(({ element }) => emptyElement(element.ns, element.local));
      results.push(propstat(403, forbidden), propstat(424, dependent));
    } else {
      const set: DeadProperty[] = [];
      const removed: string[] = [];
      for (const [name, { element, set: isSet }] of updates) {
        if (isSet) set.push({ name, xml: serializeElement(element) });
        else removed.push(name);
      }
      const patched = await storage.patchProperties(path, set, removed);
      if (!patched.ok) return failure(patched.failure);
      results.push(
        propstat(
          200,
          [...updates.values()].map(({ element }) => emptyElement(element.ns, element.local)),
        ),
      );
    }
    return xmlResponse(
      207,
      `<D:multistatus xmlns:D="DAV:"><D:response><D:href>${escapeText(
        hrefOf(basePath, path, entry.kind === "collection"),
      )}</D:href>${results.join("")}</D:response></D:multistatus>`,
    );
  };

  const lock = async (request: Request, url: URL, path: Path, store: LockStore) => {
    const body = await readXmlBody(request);
    if (body.kind === "bad") return empty(body.status);
    const timeout = parseTimeout(request.headers.get("timeout"), maxLockTimeout);
    const time = now();

    if (body.kind === "none") {
      // A refresh: the If header names the lock.
      const header = request.headers.get("if");
      const lists = header === null ? null : parseIfHeader(header);
      const token = lists
        ?.flatMap((list) => list.conditions)
        .find((c) => c.kind === "token" && !c.not)?.value;
      if (!token) return empty(400);
      const held = await store.covering(path, { descendants: false, now: time });
      const named = held.find((l) => l.token === token);
      // A lock rooted where the credential may not lock, such as above a key's roots, stays as it is.
      if (!named || !mayLock(named.root)) return empty(412);
      const refreshed = await store.refresh(token, timeout, time + timeout * 1000, time);
      if (!refreshed) return empty(412);
      return xmlResponse(
        200,
        `<D:prop xmlns:D="DAV:"><D:lockdiscovery>${activeLockXml(refreshed, basePath, time)}</D:lockdiscovery></D:prop>`,
      );
    }

    const info = body.root;
    if (info.ns !== DAV || info.local !== "lockinfo") return empty(400);
    const scopeElement = findChild(info, DAV, "lockscope");
    const scopeChild = scopeElement ? childElements(scopeElement)[0] : undefined;
    const scope: LockScope | null =
      scopeChild?.ns === DAV && (scopeChild.local === "exclusive" || scopeChild.local === "shared")
        ? scopeChild.local
        : null;
    const typeElement = findChild(info, DAV, "locktype");
    const typeChild = typeElement ? childElements(typeElement)[0] : undefined;
    if (!scope || typeChild?.ns !== DAV || typeChild.local !== "write") return empty(400);
    const depthHeader = parseDepth(request.headers.get("depth"));
    if (depthHeader === null || depthHeader === "1") return empty(400);
    const depth = depthHeader === "0" ? "0" : "infinity";
    const ownerElement = findChild(info, DAV, "owner");
    const owner = ownerElement
      ? `<D:owner>${ownerElement.children
          .map((child) => (isElement(child) ? serializeElement(child) : escapeText(child)))
          .join("")}</D:owner>`
      : "";

    const ifResult = await evaluateIf(request, url, path);
    if ("response" in ifResult) return ifResult.response;
    const existing = await store.covering(path, { descendants: depth === "infinity", now: time });
    if (existing.some((held) => conflicts(held, scope))) {
      return davError(423, "<D:no-conflicting-lock/>");
    }
    let status = 200;
    const entry = await stat(path);
    if (!entry) {
      // Locking an unmapped URL creates an empty resource (RFC 4918 §7.3).
      if (path.length === 0) return empty(409);
      const parentBlocked = await checkLocks(
        [{ path: parentOf(path), descendants: false }],
        ifResult.tokens,
      );
      if (parentBlocked) return parentBlocked;
      const created = await storage.write(path, null, {
        size: 0,
        contentType: null,
        ifAbsent: true,
      });
      // Another client created the resource meanwhile: lock it as it now is, with its own locks checked.
      if (!created.ok && created.failure !== "exists") return failure(created.failure);
      if (created.ok) status = 201;
    }
    const granted: Lock = {
      token: `urn:uuid:${crypto.randomUUID()}`,
      root: path,
      depth,
      scope,
      owner,
      timeout,
      expires: time + timeout * 1000,
    };
    if (!(await store.create(granted, time))) return davError(423, "<D:no-conflicting-lock/>");
    return xmlResponse(
      status,
      `<D:prop xmlns:D="DAV:"><D:lockdiscovery>${activeLockXml(granted, basePath, time)}</D:lockdiscovery></D:prop>`,
      { "lock-token": `<${granted.token}>` },
    );
  };

  const unlock = async (request: Request, path: Path, store: LockStore) => {
    const header = request.headers.get("lock-token")?.trim();
    const token = header?.startsWith("<") && header.endsWith(">") ? header.slice(1, -1) : null;
    if (!token) return empty(400);
    const held = await store.covering(path, { descendants: false, now: now() });
    const named = held.find((l) => l.token === token);
    if (!named) return davError(409, "<D:lock-token-matches-request-uri/>");
    if (!mayLock(named.root)) return empty(403);
    await store.remove(token);
    return empty(204);
  };

  return async (request) => {
    try {
      return await dispatch(request);
    } catch (error) {
      if (error instanceof BackendUnavailable) return empty(503);
      throw error;
    }
  };

  async function dispatch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = parseDavPath(url.pathname, basePath);
    if (!path)
      return empty(
        url.pathname === basePath || url.pathname.startsWith(`${basePath}/`) ? 400 : 404,
      );
    const method = request.method.toUpperCase();
    if (
      options.authorize &&
      method !== "COPY" &&
      method !== "MOVE" &&
      !options.authorize({ method, target: path, destination: null })
    ) {
      return empty(403);
    }
    switch (method) {
      case "OPTIONS":
        return answerOptions();
      case "GET":
        return get(request, url, path, false);
      case "HEAD":
        return get(request, url, path, true);
      case "PUT":
        return put(request, url, path);
      case "MKCOL":
        return mkcol(request, url, path);
      case "DELETE":
        return remove(request, url, path);
      case "COPY":
        return transfer(request, url, path, false);
      case "MOVE":
        return transfer(request, url, path, true);
      case "PROPFIND":
        return propfind(request, url, path);
      case "PROPPATCH":
        return proppatch(request, url, path);
      case "LOCK":
        return locks ? lock(request, url, path, locks) : empty(405, { allow: methods });
      case "UNLOCK":
        return locks ? unlock(request, path, locks) : empty(405, { allow: methods });
      default:
        return empty(405, { allow: methods });
    }
  }
};

const splitClark = (name: string) => {
  const close = name.indexOf("}");
  return { ns: name.slice(1, close), local: name.slice(close + 1) };
};
