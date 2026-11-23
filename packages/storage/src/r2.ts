import { fail, ok, type StorageResult } from "@davloom/core";
import type { ObjectInfo, ObjectStoreDriver } from "./object-store";

/** The metadata entry that keeps a file's creation time, the same as the S3 driver's. */
export const CREATED_METADATA = "davloom-created";

// The object-store driver for Cloudflare R2 through its Workers binding (PRD §9, optional backend).
// R2 bills beyond its free allowance, so the default deployment does not use it; a deployment that
// adds an R2 binding can open backends of the kind "r2". Each call counts toward the 1,000 internal
// subrequests of an invocation.

/** Bytes per part of an upload whose length is not known; R2 asks at least 5 MiB of each but the last. */
export const R2_PART_BYTES = 8 * 1024 * 1024;

const unquote = (etag: string): string => etag.replace(/^W\//, "").replace(/^"|"$/g, "");

const infoOf = (object: R2Object): ObjectInfo => {
  const created = Number(object.customMetadata?.[CREATED_METADATA]);
  return {
    key: object.key,
    size: object.size,
    etag: unquote(object.etag),
    modified: object.uploaded.getTime(),
    created: Number.isFinite(created) ? created : undefined,
    contentType: object.httpMetadata?.contentType ?? null,
  };
};

const call = async <T>(run: () => Promise<StorageResult<T>>): Promise<StorageResult<T>> => {
  try {
    return await run();
  } catch (error) {
    console.error("R2 call failed:", error instanceof Error ? error.message : error);
    return fail("unavailable");
  }
};

/** Reads a stream into parts of `size` bytes, the last one shorter. */
async function* partsOf(
  body: ReadableStream<Uint8Array>,
  size: number,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let part = new Uint8Array(size);
  let filled = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let offset = 0;
    while (offset < value.length) {
      const take = Math.min(size - filled, value.length - offset);
      part.set(value.subarray(offset, offset + take), filled);
      filled += take;
      offset += take;
      if (filled === size) {
        yield part;
        part = new Uint8Array(size);
        filled = 0;
      }
    }
  }
  if (filled > 0) yield part.slice(0, filled);
}

export interface R2DriverOptions {
  readonly bucket: R2Bucket;
  readonly partSize?: number;
}

export const createR2Driver = ({
  bucket,
  partSize = R2_PART_BYTES,
}: R2DriverOptions): ObjectStoreDriver => ({
  head: (key) =>
    call(async () => {
      const object = await bucket.head(key);
      return ok(object ? infoOf(object) : null);
    }),

  get: (key, range) =>
    call(async () => {
      const object = await bucket.get(
        key,
        range ? { range: { offset: range.start, length: range.stop - range.start } } : undefined,
      );
      return ok(object ? { info: infoOf(object), body: object.body } : null);
    }),

  put: (key, body, { length, contentType, created, ifNoneMatch }) =>
    call(async () => {
      const options: R2PutOptions = {
        httpMetadata: contentType ? { contentType } : undefined,
        customMetadata: { [CREATED_METADATA]: String(created) },
        // R2 answers null instead of storing when an object already has the key.
        ...(ifNoneMatch ? { onlyIf: new Headers({ "if-none-match": "*" }) } : {}),
      };
      if (body === null || length !== undefined) {
        // A known length streams in one request; R2 needs the length up front.
        let value: ReadableStream<Uint8Array> | Uint8Array = new Uint8Array();
        if (body !== null) {
          const fixed = new FixedLengthStream(length ?? 0);
          void body.pipeTo(fixed.writable).catch(() => undefined);
          value = fixed.readable;
        }
        const stored = await bucket.put(key, value, options);
        return stored ? ok({ etag: unquote(stored.etag) }) : fail("exists");
      }
      if (ifNoneMatch && (await bucket.head(key))) {
        await body.cancel();
        return fail("exists");
      }
      // An unknown length goes up in parts, which R2 assembles only when every part arrived.
      const upload = await bucket.createMultipartUpload(key, options);
      try {
        const parts: R2UploadedPart[] = [];
        for await (const part of partsOf(body, partSize)) {
          parts.push(await upload.uploadPart(parts.length + 1, part));
        }
        if (parts.length === 0) parts.push(await upload.uploadPart(1, new Uint8Array()));
        const stored = await upload.complete(parts);
        return ok({ etag: unquote(stored.etag) });
      } catch (error) {
        await upload.abort().catch(() => undefined);
        throw error;
      }
    }),

  list: (prefix, { recursive, cursor, limit }) =>
    call(async () => {
      const page = await bucket.list({
        prefix,
        delimiter: recursive ? undefined : "/",
        cursor: cursor ?? undefined,
        limit,
      });
      return ok({
        objects: page.objects.map(infoOf),
        prefixes: page.delimitedPrefixes,
        cursor: page.truncated ? page.cursor : null,
      });
    }),

  delete: (keys) =>
    call(async () => {
      if (keys.length > 0) await bucket.delete([...keys]);
      return ok(null);
    }),

  // R2's binding has no copy, so a copy reads the object and writes it again with its metadata.
  copy: (from, to) =>
    call(async () => {
      const source = await bucket.get(from);
      if (!source) return ok(false);
      const fixed = new FixedLengthStream(source.size);
      void source.body.pipeTo(fixed.writable).catch(() => undefined);
      await bucket.put(to, fixed.readable, {
        httpMetadata: source.httpMetadata,
        customMetadata: source.customMetadata,
      });
      return ok(true);
    }),
});
