import { compareKeys } from "../src/testing/memory-driver";

// An R2 bucket held in memory, so the R2 driver runs with the unit tests on Bun as well as against
// Miniflare's R2 in workerd (test:storage). It holds the calls the driver makes: head, get with a
// range, put with `onlyIf: if-none-match *`, a listing with a delimiter in pages, delete and
// multipart uploads. Miniflare's R2 stays the reference for the platform's behavior.

interface Stored {
  readonly bytes: Uint8Array;
  readonly etag: string;
  readonly uploaded: Date;
  readonly httpMetadata: R2HTTPMetadata | undefined;
  readonly customMetadata: Record<string, string> | undefined;
}

const readAll = async (value: ReadableStream<Uint8Array> | Uint8Array | string | null) => {
  if (value === null) return new Uint8Array();
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value.slice();
  return new Uint8Array(await new Response(value).arrayBuffer());
};

let etags = 0;
const nextEtag = () => {
  etags += 1;
  return `etag-${etags}`;
};

const objectOf = (key: string, stored: Stored) => ({
  key,
  size: stored.bytes.length,
  etag: stored.etag,
  httpEtag: `"${stored.etag}"`,
  uploaded: stored.uploaded,
  httpMetadata: stored.httpMetadata,
  customMetadata: stored.customMetadata,
});

export interface MemoryR2 {
  readonly bucket: R2Bucket;
  readonly objects: Map<string, Stored>;
  /** Uploads started and not yet completed or aborted. */
  readonly openUploads: () => number;
}

export const createMemoryR2 = (pageSize = 1000): MemoryR2 => {
  const objects = new Map<string, Stored>();
  const uploads = new Set<string>();
  let uploadIds = 0;

  const store = (key: string, bytes: Uint8Array, options: R2PutOptions | undefined) => {
    const stored: Stored = {
      bytes,
      etag: nextEtag(),
      uploaded: new Date(),
      httpMetadata: options?.httpMetadata instanceof Headers ? undefined : options?.httpMetadata,
      customMetadata: options?.customMetadata,
    };
    objects.set(key, stored);
    return objectOf(key, stored);
  };

  const bucket = {
    head: (key: string) => {
      const stored = objects.get(key);
      return Promise.resolve(stored ? objectOf(key, stored) : null);
    },
    get: (key: string, options?: { range?: { offset: number; length: number } }) => {
      const stored = objects.get(key);
      if (!stored) return Promise.resolve(null);
      const range = options?.range;
      const bytes = range
        ? stored.bytes.slice(range.offset, range.offset + range.length)
        : stored.bytes;
      return Promise.resolve({ ...objectOf(key, stored), body: new Blob([bytes]).stream() });
    },
    put: async (
      key: string,
      value: ReadableStream<Uint8Array> | Uint8Array | string | null,
      options?: R2PutOptions,
    ) => {
      const bytes = await readAll(value);
      const onlyIf = options?.onlyIf;
      if (onlyIf instanceof Headers && onlyIf.get("if-none-match") === "*" && objects.has(key)) {
        return null;
      }
      return store(key, bytes, options);
    },
    list: (options: R2ListOptions = {}) => {
      const prefix = options.prefix ?? "";
      const items: { key: string; prefix: boolean }[] = [];
      const seen = new Set<string>();
      for (const key of [...objects.keys()].toSorted(compareKeys)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const cut = options.delimiter ? rest.indexOf(options.delimiter) : -1;
        if (cut === -1) {
          items.push({ key, prefix: false });
        } else {
          const rolled = prefix + rest.slice(0, cut + 1);
          if (!seen.has(rolled)) {
            seen.add(rolled);
            items.push({ key: rolled, prefix: true });
          }
        }
      }
      const start = Number(options.cursor ?? 0);
      const limit = Math.min(options.limit ?? pageSize, pageSize);
      const page = items.slice(start, start + limit);
      const truncated = start + limit < items.length;
      return Promise.resolve({
        objects: page.flatMap((item) => {
          const stored = item.prefix ? undefined : objects.get(item.key);
          return stored ? [objectOf(item.key, stored)] : [];
        }),
        delimitedPrefixes: page.filter((item) => item.prefix).map((item) => item.key),
        truncated,
        cursor: truncated ? String(start + limit) : undefined,
      });
    },
    delete: (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
      return Promise.resolve();
    },
    createMultipartUpload: (key: string, options?: R2PutOptions) => {
      uploadIds += 1;
      const uploadId = `upload-${uploadIds}`;
      uploads.add(uploadId);
      const parts = new Map<number, Uint8Array>();
      return Promise.resolve({
        key,
        uploadId,
        uploadPart: async (partNumber: number, value: Uint8Array) => {
          parts.set(partNumber, await readAll(value));
          return { partNumber, etag: `${uploadId}-${partNumber}` };
        },
        complete: (uploaded: R2UploadedPart[]) => {
          if (!uploads.delete(uploadId)) throw new Error("the upload is not open");
          const chunks = uploaded.map(
            ({ partNumber }) => parts.get(partNumber) ?? new Uint8Array(),
          );
          const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          return Promise.resolve(store(key, bytes, options));
        },
        abort: () => {
          uploads.delete(uploadId);
          return Promise.resolve();
        },
      });
    },
  };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the part of R2Bucket the driver uses
    bucket: bucket as unknown as R2Bucket,
    objects,
    openUploads: () => uploads.size,
  };
};

/**
 * workerd's FixedLengthStream, for a runtime without it: passes the bytes through and fails when
 * they do not add up to the length.
 */
export class LocalFixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(length: number | bigint) {
    let seen = 0;
    super({
      transform: (chunk, controller) => {
        seen += chunk.length;
        if (seen > Number(length)) throw new Error("the body is longer than its length");
        controller.enqueue(chunk);
      },
      flush: () => {
        if (seen !== Number(length)) throw new Error("the body is shorter than its length");
      },
    });
  }
}
