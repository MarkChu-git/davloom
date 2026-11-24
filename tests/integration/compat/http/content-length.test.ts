import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDavloom, type Davloom } from "./davloom";
import { S3_TARGETS } from "./s3-targets";

// A file's content says its length, and the length is right, on every deployment: GET of a whole
// file, HEAD and GET of a range. workerd once sent GET bodies chunked and dropped the Content-Length
// the WebDAV engine set, so clients could not tell the size of a file they downloaded. Other
// bodies, a range that cannot be satisfied and the XML of PROPFIND, LOCK and an error, may come
// chunked (workerd sends them so), but a Content-Length they carry is their length.

interface Deployment {
  readonly davloom: Davloom;
  readonly mount: string;
  stop(): Promise<void>;
}

const TARGETS: readonly (readonly [
  name: string,
  skip: boolean,
  start: () => Promise<Deployment>,
])[] = [
  [
    "Workers with D1 and Durable Objects",
    false,
    async () => {
      const davloom = await startDavloom();
      return { davloom, mount: "/files", stop: () => davloom.server.stop() };
    },
  ],
  ...S3_TARGETS.map((target) => [target.name, target.skip, () => target.start()] as const),
];

const SIZES = [0, 1, 4_999, 300_000];

const bytesOf = (size: number) =>
  Uint8Array.from({ length: size }, (_, index) => (index * 31 + 7) % 251);

/** The ranges asked for, and the bytes of a file of `size` each selects, or null for none. */
const RANGES: readonly (readonly [
  header: string,
  select: (size: number) => [number, number] | null,
])[] = [
  ["bytes=0-0", (size) => (size > 0 ? [0, 0] : null)],
  ["bytes=10-19", (size) => (size > 10 ? [10, Math.min(19, size - 1)] : null)],
  ["bytes=-5", (size) => (size > 0 ? [Math.max(0, size - 5), size - 1] : null)],
  ["bytes=100-", (size) => (size > 100 ? [100, size - 1] : null)],
  ["bytes=0-", (size) => (size > 0 ? [0, size - 1] : null)],
];

/**
 * Reads a whole answer and checks that its Content-Length is the length of its body; a body that
 * is not `required` to carry one may come without.
 */
const bodyOf = async (response: Response, required = true) => {
  const body = new Uint8Array(await response.arrayBuffer());
  const length = response.headers.get("content-length");
  if ((required && body.byteLength > 0) || length !== null) {
    expect(length, `Content-Length of a ${response.status} answer`).toBe(String(body.byteLength));
  }
  return body;
};

/**
 * Known product bug: Bun.serve (Bun 1.4.4) drops the Content-Length of an answer whose body is a
 * stream of more than a few bytes and sends it chunked, as workerd did, so on the self-hosted
 * deployment GET of a file of some kilobytes tells the client no size. The cases of a Bun target
 * whose body is this long fail until the Bun entry passes the length on (as the Workers entry's
 * FixedLengthStream does); bodies of up to 23 bytes keep it.
 */
const BUN_DROPS_LENGTH_FROM = 4_000;
/** The length of the bytes a range selects, or of the whole file when it selects none. */
const lengthOf = (selected: readonly [number, number] | null, size: number) =>
  selected === null ? size : selected[1] - selected[0] + 1;

const dropsLength = (target: string, length: number) =>
  target.startsWith("Bun") && length >= BUN_DROPS_LENGTH_FROM;

describe.each(TARGETS)("Content-Length on %s", (name, skip, start) => {
  let deployment: Deployment;
  const path = (size: number) => `${deployment.mount}/length/${size}.bin`;

  beforeAll(async () => {
    if (skip) return;
    deployment = await start();
    const { davloom, mount } = deployment;
    expect((await davloom.dav(`${mount}/length/`, { method: "MKCOL" })).status).toBe(201);
    for (const size of SIZES) {
      const put = await davloom.dav(path(size), { method: "PUT", body: bytesOf(size) });
      expect(put.status, `PUT ${size} bytes`).toBe(201);
    }
  }, 180_000);
  afterAll(async () => {
    await deployment?.stop();
  });

  const getWhole = async (size: number) => {
    const response = await deployment.davloom.dav(path(size));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(size));
    expect(await bodyOf(response)).toEqual(bytesOf(size));
  };
  it.skipIf(skip).each(SIZES.filter((size) => !dropsLength(name, size)))(
    "GET of a file of %i bytes",
    getWhole,
  );
  (skip ? it.skip : it.fails).each(SIZES.filter((size) => dropsLength(name, size)))(
    "GET of a file of %i bytes (known bug)",
    getWhole,
  );

  it.skipIf(skip).each(SIZES)("HEAD of a file of %i bytes", async (size) => {
    const response = await deployment.davloom.dav(path(size), { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(size));
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  const rangeRows = SIZES.flatMap((size) =>
    RANGES.map(([header, select]) => [header, size, select(size)] as const),
  );
  const drops = (row: (typeof rangeRows)[number]) => dropsLength(name, lengthOf(row[2], row[1]));
  const getRange = async (header: string, size: number, selected: [number, number] | null) => {
    const response = await deployment.davloom.dav(path(size), { headers: { range: header } });
    const body = await bodyOf(response);
    if (selected === null) {
      // Nothing to select: the whole (empty) file, or 416.
      expect([200, 416]).toContain(response.status);
      if (response.status === 200) expect(body).toEqual(bytesOf(size));
      return;
    }
    const [first, last] = selected;
    const expected = bytesOf(size).slice(first, last + 1);
    if (response.status === 200) {
      // A range of the whole file may come back as the whole file.
      expect(first === 0 && last === size - 1).toBe(true);
      expect(body).toEqual(bytesOf(size));
      return;
    }
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes ${first}-${last}/${size}`);
    expect(response.headers.get("content-length")).toBe(String(expected.byteLength));
    expect(body).toEqual(expected);
  };
  it.skipIf(skip).each(rangeRows.filter((row) => !drops(row)))(
    "GET with Range %s of a file of %i bytes",
    getRange,
  );
  (skip ? it.skip : it.fails).each(rangeRows.filter((row) => drops(row)))(
    "GET with Range %s of a file of %i bytes (known bug)",
    getRange,
  );

  it.skipIf(skip).each(SIZES.filter((size) => size > 0))(
    "GET with a Range past the end of a file of %i bytes",
    async (size) => {
      const response = await deployment.davloom.dav(path(size), {
        headers: { range: `bytes=${size + 10}-${size + 20}` },
      });
      expect(response.status).toBe(416);
      await bodyOf(response, false);
    },
  );

  it.skipIf(skip).each(["0", "1"])("PROPFIND with Depth %s", async (depth) => {
    const response = await deployment.davloom.dav(`${deployment.mount}/length/`, {
      method: "PROPFIND",
      headers: { depth },
    });
    expect(response.status).toBe(207);
    expect((await bodyOf(response, false)).byteLength).toBeGreaterThan(0);
  });

  it.skipIf(skip)("LOCK and its lock discovery", async () => {
    const { davloom } = deployment;
    const response = await davloom.dav(path(1), {
      method: "LOCK",
      headers: { depth: "0", timeout: "Second-60", "content-type": "application/xml" },
      body: '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>',
    });
    expect(response.status).toBe(200);
    expect((await bodyOf(response, false)).byteLength).toBeGreaterThan(0);
    const token = response.headers.get("lock-token") ?? "";
    expect(
      (await davloom.dav(path(1), { method: "UNLOCK", headers: { "lock-token": token } })).status,
    ).toBe(204);
  });

  it.skipIf(skip)("an error with a body", async () => {
    const response = await deployment.davloom.dav(`${deployment.mount}/length/`, {
      method: "PROPFIND",
      headers: { depth: "infinity" },
    });
    expect(response.status).toBe(403);
    await bodyOf(response, false);
  });
});
