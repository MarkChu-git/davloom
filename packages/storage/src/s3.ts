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
import { classifyObjectError, type ObjectErrorCode } from "@davloom/laws";

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
 * Error codes of a 400 with which S3 and S3-compatible stores refuse an object key. RustFS 1.0.6
 * refuses a key with a control character, a part that it trims to `.` or `..` (it splits at `\`
 * as well as `/`), a part of more than 255 bytes or a marker part of more than 246 with
 * `InvalidArgument`. AWS S3 names a key of more than 1,024 bytes `KeyTooLongError`, and MinIO an
 * invalid one `XMinioInvalidObjectName`. Davloom builds every other part of its requests, so a
 * 400 with one of these codes is about the key, the only part a client chose. Other 400s, such as
 * `RequestTimeout` or `IncompleteBody`, say a request went wrong and stay unavailable.
 */
const REFUSED_KEY = new Set([
  "InvalidArgument",
  "KeyTooLongError",
  "InvalidObjectName",
  "XMinioInvalidObjectName",
]);

/**
 * The name the SDK gives an error whose answer had no code. A 400 without a body is RustFS's
 * refusal of a key only in answer to HEAD, which never has a body; to any other request it comes
 * from something that is not the store's judgement of the key, such as a wrong endpoint or a
 * proxy, and must not make the store look empty.
 */
const NO_CODE = "Unknown";

/** The request an error answered: HEAD, which has no body, or any other. */
export type RequestKind = "head" | "other";

/**
 * RustFS writes the key into the message of its refusal, and when the key holds a control
 * character it cannot write that message as XML, so it answers 500 with this message instead.
 */
const UNWRITABLE_REFUSAL = "XML response contains a control character";

/** The code of an SDK error, sorted into what the proven classification tells apart. */
const codeOf = (error: unknown): ObjectErrorCode => {
  if (!(error instanceof S3ServiceException)) return "not-store";
  if (error.name === "NoSuchKey" || error.name === "NotFound") return "no-such-key";
  if (error.name === "EntityTooLarge") return "too-large";
  if (REFUSED_KEY.has(error.name)) return "refused-key";
  if (error.name === NO_CODE) return "no-code";
  if (error.name === "InternalError" && error.message === UNWRITABLE_REFUSAL) {
    return "unwritable-refusal";
  }
  // A conditional put (If-None-Match: *) that found an object with its key.
  if (error.name === "PreconditionFailed") return "precondition";
  if (FULL.has(error.name)) return "full";
  return "other";
};

/** The Port failure for an error that a call of the SDK raised in answer to `request`. */
export const failureOfError = (error: unknown, request: RequestKind = "other"): StorageFailure =>
  classifyObjectError(
    codeOf(error),
    error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined,
    request === "head",
  );

/** What the owner of a backend can do something about, by the code S3 answered with. */
const CHECK_REASONS: ReadonlyMap<string, string> = new Map([
  ["NoSuchBucket", "The bucket does not exist"],
  ["InvalidAccessKeyId", "The access key is not known"],
  ["SignatureDoesNotMatch", "The secret key does not match the access key"],
  ["AccessDenied", "The access key may not list the bucket"],
  ["AllAccessDisabled", "The access key may not list the bucket"],
  ["PermanentRedirect", "The bucket is in another region"],
  ["AuthorizationHeaderMalformed", "The bucket is in another region"],
  ["InvalidBucketName", "The bucket name is not valid"],
  ["RequestTimeTooSkewed", "The clocks of Davloom and the store differ"],
]);

const CHECK_STATUSES: ReadonlyMap<number, string> = new Map([
  [403, "The access key may not list the bucket"],
  [404, "The bucket does not exist"],
  [301, "The bucket is in another region"],
]);

/** Why a request to an S3-compatible store failed, in words, for a connection check. */
export const describeS3Error = (error: unknown): string => {
  if (error instanceof S3ServiceException) {
    const known = CHECK_REASONS.get(error.name);
    if (known !== undefined) return known;
    const status = error.$metadata.httpStatusCode;
    const byStatus = status === undefined ? undefined : CHECK_STATUSES.get(status);
    if (byStatus !== undefined) return byStatus;
    return status === undefined ? error.name : `${error.name} (${status})`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return `No answer from the endpoint: ${message}`;
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
const call = async <T>(
  run: () => Promise<T>,
  request: RequestKind = "other",
): Promise<StorageResult<T>> => {
  try {
    return ok(await run());
  } catch (error) {
    const failure = failureOfError(error, request);
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
        }, "head"),
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
