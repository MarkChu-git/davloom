import { S3ServiceException } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createS3Client,
  createS3Driver,
  CREATED_METADATA,
  decodeKey,
  failureOfError,
  sizeOfRange,
  unquote,
} from "./s3";

// The S3 driver's own rules, and its requests and their answers through a stubbed fetch, so these
// run without a store. s3/rustfs.test.ts runs the driver against RustFS.

const exception = (name: string, status = 400) =>
  new S3ServiceException({ name, $fault: "client", $metadata: { httpStatusCode: status } });

describe("error mapping", () => {
  it.each([
    ["NoSuchKey", 404, "not-found"],
    ["NotFound", 404, "not-found"],
    ["EntityTooLarge", 400, "too-large"],
    ["QuotaExceeded", 403, "insufficient-storage"],
    ["XMinioStorageFull", 507, "insufficient-storage"],
    ["StorageFull", 500, "insufficient-storage"],
    ["InsufficientStorage", 507, "insufficient-storage"],
    ["NotEnoughSpace", 500, "insufficient-storage"],
    ["SomethingNew", 507, "insufficient-storage"],
    ["NoSuchBucket", 404, "unavailable"],
    ["AccessDenied", 403, "unavailable"],
    ["SignatureDoesNotMatch", 403, "unavailable"],
    ["InvalidAccessKeyId", 403, "unavailable"],
    ["SlowDown", 503, "unavailable"],
    ["InternalError", 500, "unavailable"],
    ["InvalidArgument", 400, "unavailable"],
    ["KeyTooLongError", 400, "unavailable"],
  ])("maps %s (%i) to %s", (name, status, failure) => {
    expect(failureOfError(exception(name, status))).toBe(failure);
  });

  it.each([
    ["a network error", new TypeError("fetch failed")],
    ["an error of another kind", new Error("ECONNREFUSED")],
    ["a value that is not an error", "nope"],
  ])("maps %s to unavailable", (_, error) => {
    expect(failureOfError(error)).toBe("unavailable");
  });
});

describe("values from the store", () => {
  it.each([
    ['"abc"', "abc"],
    ['W/"abc"', "abc"],
    ['"abc-3"', "abc-3"],
    ["abc", "abc"],
    [undefined, ""],
  ])("unquotes the ETag %j", (etag, expected) => {
    expect(unquote(etag)).toBe(expected);
  });

  it.each([
    // AWS S3 encodes a space as "+", and a "+" as "%2B".
    ["a+b.txt", "a b.txt"],
    ["a%2Bb.txt", "a+b.txt"],
    // RustFS encodes a space as "%20".
    ["a%20b.txt", "a b.txt"],
    ["100%25", "100%"],
    ["%23tag", "#tag"],
    ["%E4%B8%AD%E6%96%87", "中文"],
    ["%F0%9F%98%80", "😀"],
    ["dir/sub/", "dir/sub/"],
    ["%26%3C%3E%22%27", "&<>\"'"],
    ["%01", "\u0001"],
    ["%E4%B8", null],
    ["%zz", null],
  ])("decodes the listed key %j", (key, expected) => {
    expect(decodeKey(key)).toBe(expected);
  });

  it.each([
    ["bytes 2-4/10", 10],
    ["bytes 0-0/1", 1],
    ["bytes */10", 10],
    [undefined, null],
    ["", null],
    ["bytes 0-4/*", null],
  ])("reads the size from the range %j", (range, expected) => {
    expect(sizeOfRange(range)).toBe(expected);
  });
});

// --- Requests through a stubbed fetch ------------------------------------------------------------

interface Seen {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly body: string;
}

let seen: Seen[] = [];
let answer: (request: Seen) => Response = () => new Response(null, { status: 500 });

beforeEach(() => {
  seen = [];
  vi.stubGlobal("fetch", async (input: Request) => {
    const request: Seen = {
      method: input.method,
      url: new URL(input.url),
      headers: input.headers,
      body: input.body ? await input.text() : "",
    };
    seen.push(request);
    return answer(request);
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const xml = (body: string, status = 200) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status,
    headers: { "content-type": "application/xml" },
  });

const s3Error = (code: string, status: number) =>
  xml(`<Error><Code>${code}</Code><Message>m</Message></Error>`, status);

const driver = (partSize?: number) =>
  createS3Driver({
    client: createS3Client({
      endpoint: "http://s3.test",
      region: "us-east-1",
      bucket: "b",
      forcePathStyle: true,
      accessKeyId: "test-access",
      secretAccessKey: "test-secret",
    }),
    bucket: "b",
    partSize,
  });

const listing = (contents: string, extra = "") =>
  xml(`<ListBucketResult><Name>b</Name>${extra}${contents}</ListBucketResult>`);

describe("S3 driver requests", () => {
  it("lists one level with URL-encoded keys and decodes them", async () => {
    answer = () =>
      listing(
        `<Contents><Key>p/a+b.txt</Key><Size>3</Size><ETag>"e1"</ETag><LastModified>2026-01-02T03:04:05.678Z</LastModified></Contents>
         <Contents><Key>p/%E4%B8%AD%2B%25</Key><Size>1</Size><ETag>"e2"</ETag></Contents>
         <CommonPrefixes><Prefix>p/sub%20dir/</Prefix></CommonPrefixes>`,
        "<EncodingType>url</EncodingType><IsTruncated>true</IsTruncated><NextContinuationToken>next+1</NextContinuationToken>",
      );
    const page = await driver().list("p/", { recursive: false, cursor: "c1", limit: 5 });
    expect(page).toEqual({
      ok: true,
      value: {
        objects: [
          {
            key: "p/a b.txt",
            size: 3,
            etag: "e1",
            modified: Date.parse("2026-01-02T03:04:05.678Z"),
          },
          { key: "p/中+%", size: 1, etag: "e2", modified: 0 },
        ],
        prefixes: ["p/sub dir/"],
        cursor: "next+1",
      },
    });
    const query = seen[0]?.url.searchParams;
    expect(query?.get("list-type")).toBe("2");
    expect(query?.get("prefix")).toBe("p/");
    expect(query?.get("delimiter")).toBe("/");
    expect(query?.get("encoding-type")).toBe("url");
    expect(query?.get("continuation-token")).toBe("c1");
    expect(query?.get("max-keys")).toBe("5");
    expect(seen[0]?.url.pathname).toBe("/b/");
  });

  it("lists recursively, and takes keys as they are from a store that ignores the encoding", async () => {
    answer = () =>
      listing(
        "<Contents><Key>p/a+b %</Key><Size>1</Size></Contents><Contents><Size>2</Size></Contents>",
        "<IsTruncated>false</IsTruncated>",
      );
    const page = await driver().list("p/", { recursive: true });
    expect(page.ok && page.value.objects.map((object) => object.key)).toEqual(["p/a+b %", ""]);
    expect(page.ok && page.value.cursor).toBeNull();
    expect(seen[0]?.url.searchParams.has("delimiter")).toBe(false);
  });

  it("fails a listing whose keys are not valid URL encoding", async () => {
    answer = () =>
      listing(
        "<CommonPrefixes><Prefix>p/%E4/</Prefix></CommonPrefixes>",
        "<EncodingType>url</EncodingType>",
      );
    expect(await driver().list("p/", { recursive: false })).toEqual({
      ok: false,
      failure: "unavailable",
    });
    answer = () =>
      listing(
        "<Contents><Key>%zz</Key></Contents><CommonPrefixes></CommonPrefixes>",
        "<EncodingType>url</EncodingType>",
      );
    expect(await driver().list("p/", { recursive: false })).toEqual({
      ok: false,
      failure: "unavailable",
    });
  });

  it("heads an object with its creation time, and answers null when there is none", async () => {
    answer = ({ url }) =>
      url.pathname.endsWith("/missing")
        ? new Response(null, { status: 404 })
        : new Response(null, {
            headers: {
              "content-length": "12",
              etag: '"tag"',
              "last-modified": "Fri, 02 Jan 2026 03:04:05 GMT",
              "content-type": "text/plain",
              [`x-amz-meta-${CREATED_METADATA}`]: "1234",
            },
          });
    expect(await driver().head("dir/a b")).toEqual({
      ok: true,
      value: {
        key: "dir/a b",
        size: 12,
        etag: "tag",
        modified: Date.parse("2026-01-02T03:04:05Z"),
        created: 1234,
        contentType: "text/plain",
      },
    });
    expect(seen[0]?.method).toBe("HEAD");
    expect(seen[0]?.url.pathname).toBe("/b/dir/a%20b");
    expect(await driver().head("missing")).toEqual({ ok: true, value: null });
  });

  it.each([
    ["no metadata", {}, undefined],
    ["metadata that is not a time", { [`x-amz-meta-${CREATED_METADATA}`]: "soon" }, undefined],
  ])("heads an object with %s", async (_, headers, created) => {
    answer = () => new Response(null, { headers });
    const found = await driver().head("f");
    expect(found).toEqual({
      ok: true,
      value: { key: "f", size: 0, etag: "", modified: 0, created, contentType: null },
    });
  });

  it("gets a range and reads the whole size from Content-Range", async () => {
    answer = () =>
      new Response("234", {
        status: 206,
        headers: { "content-range": "bytes 2-4/10", "content-length": "3", etag: '"t"' },
      });
    const read = await driver().get("f", { start: 2, stop: 5 });
    if (!read.ok || !read.value) throw new Error("the read failed");
    expect(read.value.info.size).toBe(10);
    expect(await new Response(read.value.body).text()).toBe("234");
    expect(seen[0]?.headers.get("range")).toBe("bytes=2-4");
  });

  it("gets a whole object, and answers null when there is none", async () => {
    answer = ({ url }) =>
      url.pathname.endsWith("/missing")
        ? s3Error("NoSuchKey", 404)
        : new Response("hello", { headers: { "content-length": "5" } });
    const read = await driver().get("f");
    expect(read.ok && read.value?.info.size).toBe(5);
    expect(seen[0]?.headers.has("range")).toBe(false);
    expect(await driver().get("missing")).toEqual({ ok: true, value: null });
  });

  it("puts a body of known length in one request, with its creation time", async () => {
    answer = () => new Response(null, { headers: { etag: '"put-tag"' } });
    const put = await driver().put("dir/f", new Blob(["hello"]).stream(), {
      length: 5,
      contentType: "text/plain",
      created: 99,
    });
    expect(put).toEqual({ ok: true, value: { etag: "put-tag" } });
    expect(seen[0]?.method).toBe("PUT");
    expect(seen[0]?.body).toBe("hello");
    expect(seen[0]?.headers.get("content-length")).toBe("5");
    expect(seen[0]?.headers.get("content-type")).toBe("text/plain");
    expect(seen[0]?.headers.get(`x-amz-meta-${CREATED_METADATA}`)).toBe("99");
  });

  it("puts an empty marker", async () => {
    answer = () => new Response(null, { headers: { etag: '"d41d8cd98f00b204e9800998ecf8427e"' } });
    const put = await driver().put("dir/", null, { length: 0, created: 1 });
    expect(put.ok && put.value.etag).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(seen[0]?.headers.get("content-length")).toBe("0");
  });

  it("uploads a small body of unknown length in one request", async () => {
    answer = () => new Response(null, { headers: { etag: '"small"' } });
    const put = await driver().put("f", new Blob(["abc"]).stream(), { created: 1 });
    expect(put).toEqual({ ok: true, value: { etag: "small" } });
    expect(seen.map((request) => request.method)).toEqual(["PUT"]);
    expect(seen[0]?.body).toBe("abc");
  });

  it("uploads a large body of unknown length in parts", async () => {
    answer = ({ method, url }) => {
      if (method === "POST" && url.searchParams.has("uploads")) {
        return xml(
          "<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>f</Key><UploadId>u1</UploadId></InitiateMultipartUploadResult>",
        );
      }
      if (method === "PUT")
        return new Response(null, {
          headers: { etag: `"part${url.searchParams.get("partNumber") ?? ""}"` },
        });
      return xml(
        '<CompleteMultipartUploadResult><ETag>"whole-2"</ETag></CompleteMultipartUploadResult>',
      );
    };
    const data = new Uint8Array(5 * 1024 * 1024 + 10);
    const put = await driver(5 * 1024 * 1024).put("f", new Blob([data]).stream(), { created: 1 });
    expect(put).toEqual({ ok: true, value: { etag: "whole-2" } });
    expect(seen.map((request) => request.method)).toEqual(["POST", "PUT", "PUT", "POST"]);
  });

  it("maps a refused put", async () => {
    answer = () => s3Error("EntityTooLarge", 400);
    expect(await driver().put("f", null, { length: 0, created: 1 })).toEqual({
      ok: false,
      failure: "too-large",
    });
  });

  it("deletes in batches and ignores keys that were already gone", async () => {
    answer = () =>
      xml(
        "<DeleteResult><Error><Key>gone</Key><Code>NoSuchKey</Code><Message>m</Message></Error></DeleteResult>",
      );
    const keys = Array.from({ length: 1500 }, (_, index) => `k${index}`);
    expect(await driver().delete(keys)).toEqual({ ok: true, value: null });
    expect(seen.length).toBe(2);
    expect(seen[0]?.url.searchParams.has("delete")).toBe(true);
    expect((seen[0]?.body.match(/<Key>/g) ?? []).length).toBe(1000);
    expect(seen[0]?.body).toContain("<Quiet>true</Quiet>");
  });

  it("fails a delete that kept keys", async () => {
    answer = () =>
      xml(
        "<DeleteResult><Error><Key>k</Key><Code>AccessDenied</Code><Message>m</Message></Error></DeleteResult>",
      );
    expect(await driver().delete(["k"])).toEqual({ ok: false, failure: "unavailable" });
  });

  it("copies with an encoded source, and answers false for a missing one", async () => {
    answer = ({ url }) =>
      url.pathname.endsWith("/missing-copy")
        ? s3Error("NoSuchKey", 404)
        : xml('<CopyObjectResult><ETag>"c"</ETag></CopyObjectResult>');
    expect(await driver().copy("dir/中 +#.txt", "to")).toEqual({ ok: true, value: true });
    expect(seen[0]?.headers.get("x-amz-copy-source")).toBe(
      `b/${encodeURIComponent("dir/中 +#.txt")}`,
    );
    expect(await driver().copy("nope", "missing-copy")).toEqual({ ok: true, value: false });
    answer = () => s3Error("AccessDenied", 403);
    expect(await driver().copy("a", "b")).toEqual({ ok: false, failure: "unavailable" });
  });

  it("answers unavailable when the store cannot be reached", async () => {
    answer = () => {
      throw new TypeError("fetch failed");
    };
    expect(await driver().head("f")).toEqual({ ok: false, failure: "unavailable" });
  });
});
