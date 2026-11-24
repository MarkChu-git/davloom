import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type _Object,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { fail, ok, type StorageFailure, type StorageResult } from "@davloom/core";
import { FetchHttpHandler } from "@smithy/fetch-http-handler";
import { DELETE_BATCH, type ObjectInfo, type ObjectStoreDriver } from "./object-store";

// The S3 driver of the object-store adapter, on the AWS SDK's S3Client (Decision 6 of
// add-phase-1-core). Requests go through the SDK's fetch handler on every runtime: Workers have
// only fetch, and on Bun the SDK's Node handler cannot stream a Web stream as a request body.
// The SDK's default checksums fail on several S3-compatible stores, so it computes them only when
// an operation requires one. Listings ask for URL-encoded keys, so keys can hold characters that
// XML 1.0 cannot carry, and the driver decodes them.

export interface S3Config {
  /** The endpoint URL, such as `https://s3.us-east-1.amazonaws.com` or `http://localhost:9000`. */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  /** Addresses the bucket in the path rather than in the host name. */
  readonly forcePathStyle: boolean;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface S3DriverOptions {
  readonly client: S3Client;
  readonly bucket: string;
  /** Bytes per part of an upload whose length is not known; at least 5 MiB. */
  readonly partSize?: number;
}

/** The metadata entry that keeps a file's creation time, in milliseconds as decimal text. */
export const CREATED_METADATA = "davloom-created";

export const createS3Client = (config: S3Config): S3Client =>
  new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: new FetchHttpHandler(),
  });

/** Error names of S3 and of S3-compatible stores that mean the store has no room. */
const FULL = new Set([
  "QuotaExceeded",
  "QuotaExceededError",
  "StorageFull",
  "XMinioStorageFull",
  "InsufficientStorage",
  "NotEnoughSpace",
]);

/**
 * Error names of a 400 with which S3 and S3-compatible stores refuse an object key. RustFS 1.0.6
 * refuses a key with a control character, a part that it trims to `.` or `..` (it splits at `\`
 * as well as `/`), a part of more than 255 bytes or a marker part of more than 246 with
 * `InvalidArgument`, and its answer to HEAD has no body, which the SDK names `Unknown`. AWS S3
 * names a key of more than 1,024 bytes `KeyTooLongError`, and MinIO an invalid one
 * `XMinioInvalidObjectName`. Davloom builds every other part of its requests, so a 400 of these
 * names is about the key, the only part a client chose. Other 400s, such as `RequestTimeout` or
 * `IncompleteBody`, say a request went wrong and stay unavailable.
 */
const REFUSED_KEY = new Set([
  "InvalidArgument",
  "Unknown",
  "KeyTooLongError",
  "InvalidObjectName",
  "XMinioInvalidObjectName",
]);

/**
 * RustFS writes the key into the message of its refusal, and when the key holds a control
 * character it cannot write that message as XML, so it answers 500 with this message instead.
 */
const UNWRITABLE_REFUSAL = "XML response contains a control character";

/** The Port failure for an error that a call of the SDK raised. */
export const failureOfError = (error: unknown): StorageFailure => {
  if (!(error instanceof S3ServiceException)) return "unavailable";
  if (error.name === "NoSuchKey" || error.name === "NotFound") return "not-found";
  if (error.name === "EntityTooLarge") return "too-large";
  if (error.$metadata.httpStatusCode === 400 && REFUSED_KEY.has(error.name)) return "name-refused";
  if (error.name === "InternalError" && error.message === UNWRITABLE_REFUSAL) {
    return "name-refused";
  }
  // A conditional put (If-None-Match: *) that found an object with its key.
  if (error.name === "PreconditionFailed" || error.$metadata.httpStatusCode === 412)
    return "exists";
  if (FULL.has(error.name) || error.$metadata.httpStatusCode === 507) {
    return "insufficient-storage";
  }
  return "unavailable";
};

/** S3 quotes its ETags. */
export const unquote = (etag: string | undefined): string =>
  (etag ?? "").replace(/^W\//, "").replace(/^"(.*)"$/, "$1");

/**
 * A key from a listing with `EncodingType: "url"`. AWS S3 writes a space as `+` and a `+` as
 * `%2B`, as in a form; RustFS writes a space as `%20`, and both write `%` as `%25`, so turning
 * `+` into a space first decodes either. Null when the text is not valid percent-encoding.
 */
export const decodeKey = (key: string): string | null => {
  try {
    return decodeURIComponent(key.replaceAll("+", " "));
  } catch {
    return null;
  }
};

/** The whole size of an object from a `Content-Range` of `bytes a-b/size`. */
export const sizeOfRange = (range: string | undefined): number | null => {
  const match = /\/(\d+)$/.exec(range ?? "");
  return match?.[1] === undefined ? null : Number(match[1]);
};

const createdOf = (metadata: Record<string, string> | undefined): number | undefined => {
  const text = metadata?.[CREATED_METADATA];
  const value = text === undefined ? Number.NaN : Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
};

/** Runs one SDK call, and turns what it raises into a failure. */
const call = async <T>(run: () => Promise<T>): Promise<StorageResult<T>> => {
  try {
    return ok(await run());
  } catch (error) {
    const failure = failureOfError(error);
    if (failure === "unavailable") console.error("S3 request failed", error);
    return fail(failure);
  }
};

/** A call that answers null rather than not found. */
const orNull = <T>(result: StorageResult<T>): StorageResult<T | null> =>
  !result.ok && result.failure === "not-found" ? ok(null) : result;

const listed = (object: _Object, encoded: boolean): ObjectInfo | null => {
  const key = encoded ? decodeKey(object.Key ?? "") : (object.Key ?? "");
  if (key === null) return null;
  return {
    key,
    size: object.Size ?? 0,
    etag: unquote(object.ETag),
    modified: object.LastModified?.getTime() ?? 0,
  };
};

export const createS3Driver = ({
  client,
  bucket,
  partSize,
}: S3DriverOptions): ObjectStoreDriver => {
  return {
    head: async (key) =>
      orNull(
        await call(async () => {
          const found = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
          return {
            key,
            size: found.ContentLength ?? 0,
            etag: unquote(found.ETag),
            modified: found.LastModified?.getTime() ?? 0,
            created: createdOf(found.Metadata),
            contentType: found.ContentType ?? null,
          };
        }),
      ),

    get: async (key, range) =>
      orNull(
        await call(async () => {
          const found = await client.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: key,
              Range: range ? `bytes=${range.start}-${range.stop - 1}` : undefined,
            }),
          );
          if (!found.Body) throw new Error("the store sent no body");
          return {
            info: {
              key,
              size: sizeOfRange(found.ContentRange) ?? found.ContentLength ?? 0,
              etag: unquote(found.ETag),
              modified: found.LastModified?.getTime() ?? 0,
              created: createdOf(found.Metadata),
              contentType: found.ContentType ?? null,
            },
            body: found.Body.transformToWebStream(),
          };
        }),
      ),

    put: (key, body, { length, contentType, created, ifNoneMatch }) =>
      call(async () => {
        const params = {
          Bucket: bucket,
          Key: key,
          ContentType: contentType ?? undefined,
          Metadata: { [CREATED_METADATA]: String(created) },
          ...(ifNoneMatch ? { IfNoneMatch: "*" } : {}),
        };
        if (length !== undefined || body === null) {
          // A known length streams the body in one request.
          const stored = await client.send(
            new PutObjectCommand({
              ...params,
              Body: body ?? new Uint8Array(),
              ContentLength: length ?? 0,
            }),
          );
          return { etag: unquote(stored.ETag) };
        }
        // An unknown length goes up in parts, which S3 assembles only when every part arrived.
        const upload = new Upload({ client, params: { ...params, Body: body }, partSize });
        const stored = await upload.done();
        return { etag: unquote("ETag" in stored ? stored.ETag : undefined) };
      }),

    list: (prefix, { recursive, cursor, limit }) =>
      call(async () => {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            Delimiter: recursive ? undefined : "/",
            EncodingType: "url",
            ContinuationToken: cursor ?? undefined,
            MaxKeys: limit,
          }),
        );
        // A store that ignores the encoding sends the keys as they are.
        const encoded = page.EncodingType === "url";
        const objects = (page.Contents ?? []).map((object) => listed(object, encoded));
        const prefixes = (page.CommonPrefixes ?? []).map((common) =>
          encoded ? decodeKey(common.Prefix ?? "") : (common.Prefix ?? ""),
        );
        if (objects.includes(null) || prefixes.includes(null)) {
          throw new Error("the store sent a key that is not valid URL encoding");
        }
        return {
          objects: objects.filter((object) => object !== null),
          prefixes: prefixes.filter((common) => common !== null),
          cursor: page.IsTruncated ? (page.NextContinuationToken ?? null) : null,
        };
      }),

    delete: (keys) =>
      call(async () => {
        for (let index = 0; index < keys.length; index += DELETE_BATCH) {
          const batch = keys.slice(index, index + DELETE_BATCH);
          const result = await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: batch.map((key) => ({ Key: key })), Quiet: true },
            }),
          );
          const refused = (result.Errors ?? []).filter((error) => error.Code !== "NoSuchKey");
          if (refused.length > 0) {
            throw new Error(`the store kept ${refused.length} of the keys it was to delete`);
          }
        }
        return null;
      }),

    copy: async (from, to) => {
      const copied = await call(async () => {
        await client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: to,
            CopySource: `${bucket}/${encodeURIComponent(from)}`,
          }),
        );
        return true;
      });
      return !copied.ok && copied.failure === "not-found" ? ok(false) : copied;
    },
  };
};
