// A fault-injecting HTTP proxy that stands between a Davloom server and its S3-compatible store.
// It passes each request to the store, or answers it with a fault that a rule the test sets at
// runtime chooses: a status with an empty body or an S3 error document, an answer after a delay,
// or a connection closed before any answer. The store is another server (RustFS in Docker), or a
// small in-memory S3 that the proxy serves itself, with ListObjectsV2 paging down to a page size
// the test chooses, so that Workers and Bun reach an S3 backend locally without Docker.
//
// The in-memory S3 accepts any credentials and keeps every bucket it is asked for. It implements
// what the S3 driver of packages/storage sends: HeadBucket, CreateBucket, ListObjectsV2 (prefix,
// delimiter, url encoding, max-keys, continuation tokens), HeadObject, GetObject with a range,
// PutObject with If-None-Match: *, CopyObject, DeleteObject, DeleteObjects and multipart uploads.

/** What a rule answers instead of the store. */
export type Fault =
  /** A status; the body is empty, or an S3 error document with or without a Code. */
  | {
      readonly kind: "status";
      readonly status: number;
      readonly body: "empty" | "xml";
      /** The error document's Code; absent for a document without one. */
      readonly code?: string;
    }
  /** Waits, then passes the request to the store. */
  | { readonly kind: "slow"; readonly ms: number }
  /** Closes the connection before any answer. */
  | { readonly kind: "reset" };

export interface FaultRule {
  /** The HTTP method a request must have. */
  readonly method?: string;
  /** Query parameters a request must carry, such as `list-type` or `continuation-token`. */
  readonly query?: readonly string[];
  /** A header a request must carry, such as `x-amz-copy-source` for CopyObject. */
  readonly header?: string;
  /** What the object key (the decoded path after the bucket) must match. */
  readonly key?: RegExp;
  /** Faults only the nth request that matches the rest of the rule, counting from 1. */
  readonly nth?: number;
  /** Faults the requests that match the rest of the rule from the nth on, counting from 1. */
  readonly from?: number;
  /** Faults at most this many requests; every match when absent. */
  readonly times?: number;
  readonly fault: Fault;
}

export interface SeenRequest {
  readonly method: string;
  readonly key: string;
  readonly query: string;
  /** The fault that answered it, or null when the store did. */
  readonly fault: Fault["kind"] | null;
}

export interface StoredObject {
  readonly body: Uint8Array<ArrayBuffer>;
  readonly etag: string;
  readonly modified: Date;
  readonly contentType: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface MemoryS3 {
  /** The objects of a bucket by key; the test may read and change it directly. */
  bucket(name: string): Map<string, StoredObject>;
  /** Stores an object as a client's PutObject would. */
  put(
    bucket: string,
    key: string,
    body: string | Uint8Array<ArrayBuffer>,
    contentType?: string,
  ): void;
  /** The most keys and common prefixes one listing page holds. */
  pageSize: number;
}

export interface S3Proxy {
  readonly url: string;
  /** The in-memory store, when the proxy serves one. */
  readonly memory: MemoryS3 | null;
  /** Replaces the rules and starts their counts again. */
  setRules(rules: readonly FaultRule[]): void;
  /** Every request since the last `setRules` or `clearLog`. */
  readonly seen: readonly SeenRequest[];
  clearLog(): void;
  stop(): Promise<void>;
}

export interface S3ProxyOptions {
  /** The store to pass requests to; the proxy serves an in-memory S3 when absent. */
  readonly upstream?: string;
  /** The in-memory store's most keys per listing page; 1,000, as S3's, when absent. */
  readonly pageSize?: number;
}

const encoder = new TextEncoder();

const escapeXml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const unescapeXml = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll(/&#(x?)([0-9a-fA-F]+);/g, (_, hex: string, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, hex ? 16 : 10)),
    )
    .replaceAll("&amp;", "&");

const xml = (status: number, body: string, headers: Record<string, string> = {}) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    status,
    headers: { "content-type": "application/xml", ...headers },
  });

export const errorDocument = (code: string | undefined, message: string) =>
  `<Error>${code === undefined ? "" : `<Code>${escapeXml(code)}</Code>`}<Message>${escapeXml(message)}</Message><RequestId>proxy</RequestId></Error>`;

const s3Error = (status: number, code: string, message: string) =>
  xml(status, errorDocument(code, message));

/** S3 orders keys by their UTF-8 bytes, which differs from the order of UTF-16 strings. */
const compareKeys = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

const md5 = (body: Uint8Array) => new Bun.CryptoHasher("md5").update(body).digest("hex");

/** Percent-encodes a key as S3 does for `encoding-type=url`. */
const encodeKey = (key: string) => encodeURIComponent(key).replaceAll("%2F", "/");

const objectHeaders = (object: StoredObject): Record<string, string> => {
  const headers: Record<string, string> = {
    etag: `"${object.etag}"`,
    "last-modified": object.modified.toUTCString(),
    "accept-ranges": "bytes",
  };
  if (object.contentType !== null) headers["content-type"] = object.contentType;
  for (const [name, value] of Object.entries(object.metadata))
    headers[`x-amz-meta-${name}`] = value;
  return headers;
};

const metadataOf = (headers: Headers) => {
  const metadata: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (name.startsWith("x-amz-meta-")) metadata[name.slice("x-amz-meta-".length)] = value;
  });
  return metadata;
};

const stored = (
  body: Uint8Array<ArrayBuffer>,
  contentType: string | null,
  metadata: Record<string, string>,
) => ({
  body,
  etag: md5(body),
  modified: new Date(Math.floor(Date.now() / 1000) * 1000),
  contentType,
  metadata,
});

interface Upload {
  readonly bucket: string;
  readonly key: string;
  readonly contentType: string | null;
  readonly metadata: Record<string, string>;
  readonly parts: Map<number, Uint8Array<ArrayBuffer>>;
}

/** The bucket and the decoded key a path-style request names. */
export const bucketAndKey = (pathname: string) => {
  const rest = pathname.replace(/^\//, "");
  const slash = rest.indexOf("/");
  const bucket = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
  const key = slash === -1 ? "" : decodeURIComponent(rest.slice(slash + 1));
  return { bucket, key };
};

export const createMemoryS3 = (pageSize = 1000) => {
  const buckets = new Map<string, Map<string, StoredObject>>();
  const uploads = new Map<string, Upload>();
  const bucket = (name: string) => {
    let objects = buckets.get(name);
    if (!objects) {
      objects = new Map();
      buckets.set(name, objects);
    }
    return objects;
  };

  const list = (objects: Map<string, StoredObject>, query: URLSearchParams) => {
    const prefix = query.get("prefix") ?? "";
    const delimiter = query.get("delimiter") ?? "";
    const encoded = query.get("encoding-type") === "url";
    const asked = Number(query.get("max-keys") ?? "1000");
    const limit = Math.max(0, Math.min(Number.isFinite(asked) ? asked : 1000, memory.pageSize));
    const token = query.get("continuation-token");
    // A token names the last key or common prefix of the page before.
    const decoded = token === null ? null : Buffer.from(token, "base64").toString();
    const after = decoded === null ? (query.get("start-after") ?? "") : decoded.slice(1);
    const afterPrefix = decoded?.startsWith("p") ?? false;
    const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).toSorted(compareKeys);
    const contents: string[] = [];
    const prefixes: string[] = [];
    let last = "";
    let truncated = false;
    for (const key of keys) {
      if (after !== "" && compareKeys(key, after) <= 0) continue;
      // A page that ended at a common prefix starts after every key under it.
      if (afterPrefix && key.startsWith(after)) continue;
      const cut = delimiter === "" ? -1 : key.indexOf(delimiter, prefix.length);
      const common = cut === -1 ? null : key.slice(0, cut + delimiter.length);
      if (common !== null && prefixes.at(-1) === common) continue;
      if (contents.length + prefixes.length >= limit) {
        truncated = true;
        break;
      }
      if (common !== null) {
        prefixes.push(common);
        last = `p${common}`;
      } else {
        contents.push(key);
        last = `k${key}`;
      }
    }
    const name = (text: string) => escapeXml(encoded ? encodeKey(text) : text);
    const body = [
      `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">`,
      `<Name>bucket</Name><Prefix>${name(prefix)}</Prefix>`,
      delimiter === "" ? "" : `<Delimiter>${name(delimiter)}</Delimiter>`,
      encoded ? "<EncodingType>url</EncodingType>" : "",
      `<MaxKeys>${limit}</MaxKeys><KeyCount>${contents.length + prefixes.length}</KeyCount>`,
      `<IsTruncated>${truncated}</IsTruncated>`,
      token === null ? "" : `<ContinuationToken>${escapeXml(token)}</ContinuationToken>`,
      truncated
        ? `<NextContinuationToken>${Buffer.from(last).toString("base64")}</NextContinuationToken>`
        : "",
      ...contents.map((key) => {
        const object = objects.get(key);
        return `<Contents><Key>${name(key)}</Key><LastModified>${object?.modified.toISOString()}</LastModified><ETag>"${object?.etag}"</ETag><Size>${object?.body.byteLength}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
      }),
      ...prefixes.map(
        (common) => `<CommonPrefixes><Prefix>${name(common)}</Prefix></CommonPrefixes>`,
      ),
      "</ListBucketResult>",
    ].join("");
    return xml(200, body);
  };

  const get = (object: StoredObject, range: string | null, head: boolean) => {
    const size = object.body.byteLength;
    const match = /^bytes=(\d*)-(\d*)$/.exec(range ?? "");
    if (!match || (match[1] === "" && match[2] === "")) {
      return new Response(head ? null : object.body, {
        headers: { ...objectHeaders(object), "content-length": String(size) },
      });
    }
    let start = match[1] === "" ? size - Number(match[2]) : Number(match[1]);
    let end = match[1] === "" || match[2] === "" ? size - 1 : Number(match[2]);
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return s3Error(416, "InvalidRange", "The requested range is not satisfiable");
    }
    const part = object.body.slice(start, end + 1);
    return new Response(head ? null : part, {
      status: 206,
      headers: {
        ...objectHeaders(object),
        "content-length": String(part.byteLength),
        "content-range": `bytes ${start}-${end}/${size}`,
      },
    });
  };

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const query = url.searchParams;
    const { bucket: name, key } = bucketAndKey(url.pathname);
    if (name === "") return s3Error(400, "InvalidBucketName", "No bucket");
    const objects = bucket(name);
    const method = request.method;
    if (key === "") {
      if (method === "HEAD") return new Response(null, { status: 200 });
      if (method === "PUT")
        return new Response(null, { status: 200, headers: { location: `/${name}` } });
      if (method === "GET" && query.get("list-type") === "2") return list(objects, query);
      if (method === "POST" && query.has("delete")) {
        const text = await request.text();
        const keys = [...text.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((m) =>
          unescapeXml(m[1] ?? ""),
        );
        for (const deleted of keys) objects.delete(deleted);
        const quiet = /<Quiet>true<\/Quiet>/.test(text);
        return xml(
          200,
          `<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${quiet ? "" : keys.map((k) => `<Deleted><Key>${escapeXml(k)}</Key></Deleted>`).join("")}</DeleteResult>`,
        );
      }
      return s3Error(501, "NotImplemented", `${method} on a bucket`);
    }
    if (method === "POST" && query.has("uploads")) {
      const id = crypto.randomUUID();
      uploads.set(id, {
        bucket: name,
        key,
        contentType: request.headers.get("content-type"),
        metadata: metadataOf(request.headers),
        parts: new Map(),
      });
      return xml(
        200,
        `<InitiateMultipartUploadResult><Bucket>${escapeXml(name)}</Bucket><Key>${escapeXml(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,
      );
    }
    const uploadId = query.get("uploadId");
    if (uploadId !== null) {
      const upload = uploads.get(uploadId);
      if (!upload) return s3Error(404, "NoSuchUpload", "No such upload");
      if (method === "PUT") {
        const body = new Uint8Array(await request.arrayBuffer());
        upload.parts.set(Number(query.get("partNumber")), body);
        return new Response(null, { headers: { etag: `"${md5(body)}"` } });
      }
      if (method === "DELETE") {
        uploads.delete(uploadId);
        return new Response(null, { status: 204 });
      }
      if (method === "POST") {
        const numbers = [...upload.parts.keys()].toSorted((a, b) => a - b);
        const body = new Uint8Array(
          await new Blob(numbers.map((n) => upload.parts.get(n) ?? new Uint8Array())).arrayBuffer(),
        );
        objects.set(key, stored(body, upload.contentType, upload.metadata));
        uploads.delete(uploadId);
        return xml(
          200,
          `<CompleteMultipartUploadResult><Bucket>${escapeXml(name)}</Bucket><Key>${escapeXml(key)}</Key><ETag>"${objects.get(key)?.etag}"</ETag></CompleteMultipartUploadResult>`,
        );
      }
    }
    const found = objects.get(key);
    if (method === "HEAD") {
      return found
        ? get(found, request.headers.get("range"), true)
        : new Response(null, { status: 404 });
    }
    if (method === "GET") {
      return found
        ? get(found, request.headers.get("range"), false)
        : s3Error(404, "NoSuchKey", "The specified key does not exist.");
    }
    if (method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (method === "PUT") {
      const source = request.headers.get("x-amz-copy-source");
      if (source !== null) {
        const from = bucketAndKey(`/${source.replace(/^\//, "").split("?")[0] ?? ""}`);
        const original = bucket(from.bucket).get(from.key);
        if (!original) return s3Error(404, "NoSuchKey", "The specified key does not exist.");
        const replace = request.headers.get("x-amz-metadata-directive") === "REPLACE";
        const copy = stored(
          original.body,
          replace ? request.headers.get("content-type") : original.contentType,
          replace ? metadataOf(request.headers) : { ...original.metadata },
        );
        objects.set(key, copy);
        return xml(
          200,
          `<CopyObjectResult><LastModified>${copy.modified.toISOString()}</LastModified><ETag>"${copy.etag}"</ETag></CopyObjectResult>`,
        );
      }
      const body = new Uint8Array(await request.arrayBuffer());
      // Checked once the body is in, as S3 checks when it stores: of puts at once, one wins.
      if (request.headers.get("if-none-match") === "*" && objects.has(key)) {
        return s3Error(
          412,
          "PreconditionFailed",
          "At least one of the pre-conditions you specified did not hold",
        );
      }
      const object = stored(body, request.headers.get("content-type"), metadataOf(request.headers));
      objects.set(key, object);
      return new Response(null, { headers: { etag: `"${object.etag}"` } });
    }
    return s3Error(501, "NotImplemented", `${method} on an object`);
  };

  const memory: MemoryS3 & { handle: typeof handle } = {
    pageSize,
    bucket,
    put: (bucketName, key, body, contentType) => {
      const bytes = typeof body === "string" ? encoder.encode(body) : body;
      bucket(bucketName).set(key, stored(bytes, contentType ?? null, {}));
    },
    handle,
  };
  return memory;
};

/** Whether a rule other than its count matches a request. */
const matches = (rule: FaultRule, request: Request, url: URL, key: string) =>
  (rule.method === undefined || rule.method === request.method) &&
  (rule.query ?? []).every((name) => url.searchParams.has(name)) &&
  (rule.header === undefined || request.headers.has(rule.header)) &&
  (rule.key === undefined || rule.key.test(key));

/** Closes the connection before the status line, as a store that went away mid-request. */
const reset = () =>
  new Response(
    new ReadableStream({
      pull(controller) {
        controller.error("the proxy reset the connection");
      },
    }),
    { status: 500 },
  );

const answerFault = (fault: Exclude<Fault, { kind: "slow" }>, key: string): Response => {
  if (fault.kind === "reset") return reset();
  if (fault.body === "empty") return new Response(null, { status: fault.status });
  return xml(fault.status, errorDocument(fault.code, `the proxy refused ${key}`));
};

/** Headers that belong to one connection and are not passed on. */
const HOP_BY_HOP = ["connection", "keep-alive", "transfer-encoding", "upgrade", "content-length"];

const passOn = async (upstream: string, request: Request, url: URL) => {
  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP) headers.delete(name);
  // The request is signed for the proxy's host, which the store checks; the Host stays.
  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  const answer = await fetch(`${upstream}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
    decompress: false,
  });
  const answerHeaders = new Headers(answer.headers);
  for (const name of HOP_BY_HOP) {
    if (name !== "content-length") answerHeaders.delete(name);
  }
  // A Response with one of these statuses, or answering HEAD, cannot have a body.
  const bodiless = request.method === "HEAD" || [101, 103, 204, 205, 304].includes(answer.status);
  const answerBody = bodiless ? null : await answer.arrayBuffer();
  if (bodiless) await answer.body?.cancel();
  return new Response(answerBody, { status: answer.status, headers: answerHeaders });
};

export const startS3Proxy = (options: S3ProxyOptions = {}): S3Proxy => {
  const memory = options.upstream === undefined ? createMemoryS3(options.pageSize) : null;
  let rules: { rule: FaultRule; matched: number; faulted: number }[] = [];
  let seen: SeenRequest[] = [];

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    // A slow fault and a large body take longer than Bun's default of 10 s.
    idleTimeout: 120,
    fetch: async (request) => {
      const url = new URL(request.url);
      const { key } = bucketAndKey(url.pathname);
      let fault: Fault | null = null;
      for (const entry of rules) {
        if (!matches(entry.rule, request, url, key)) continue;
        entry.matched += 1;
        const { nth, from, times } = entry.rule;
        if (nth !== undefined && entry.matched !== nth) continue;
        if (from !== undefined && entry.matched < from) continue;
        if (times !== undefined && entry.faulted >= times) continue;
        entry.faulted += 1;
        fault = entry.rule.fault;
        break;
      }
      seen.push({ method: request.method, key, query: url.search, fault: fault?.kind ?? null });
      if (fault !== null && fault.kind !== "slow") {
        await request.body?.cancel().catch(() => undefined);
        return answerFault(fault, key);
      }
      if (fault?.kind === "slow") await Bun.sleep(fault.ms);
      if (memory) return await memory.handle(request);
      return await passOn(options.upstream ?? "", request, url);
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    memory,
    setRules: (next) => {
      rules = next.map((rule) => ({ rule, matched: 0, faulted: 0 }));
      seen = [];
    },
    get seen() {
      return seen;
    },
    clearLog: () => {
      seen = [];
    },
    stop: async () => {
      await server.stop(true);
    },
  };
};
