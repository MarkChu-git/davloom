import { describe, expect, it } from "vitest";
import { withFixedLength } from "./fixed-length.workers";

// FixedLengthStream exists only in workerd, so the tests give a stand-in that records the length
// and passes the bytes through.
const recording = () => {
  const lengths: number[] = [];
  const fixed = (length: number) => {
    lengths.push(length);
    return new TransformStream<Uint8Array, Uint8Array>();
  };
  return { lengths, fixed };
};

const answer = (headers: Record<string, string>, body: BodyInit | null = "hello") =>
  new Response(body, { status: 200, statusText: "OK", headers });

const dav = (path = "/dav/files/a.txt") => new Request(`https://davloom.example${path}`);

describe("withFixedLength", () => {
  it("streams a WebDAV body through a stream of its Content-Length", async () => {
    const { lengths, fixed } = recording();
    const original = answer({ "content-length": "5", etag: '"x"' });
    const response = withFixedLength(dav(), original, fixed);
    expect(response).not.toBe(original);
    expect(lengths).toEqual([5]);
    expect(response.status).toBe(200);
    expect(response.statusText).toBe("OK");
    expect(response.headers.get("etag")).toBe('"x"');
    expect(await response.text()).toBe("hello");
  });

  it.each([
    ["/dav", "/dav"],
    ["a partial answer", "/dav/files/a.txt"],
  ])("keeps the status of %s", async (_name, path) => {
    const { lengths, fixed } = recording();
    const original = new Response("ell", {
      status: 206,
      headers: { "content-length": "3", "content-range": "bytes 1-3/5" },
    });
    const response = withFixedLength(dav(path), original, fixed);
    expect(lengths).toEqual([3]);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 1-3/5");
    expect(await response.text()).toBe("ell");
  });

  it.each([
    ["a body without Content-Length", dav(), answer({})],
    ["an empty answer", dav(), answer({ "content-length": "5" }, null)],
    ["an API answer", dav("/api/health"), answer({ "content-length": "5" })],
    ["a Dashboard page", dav("/"), answer({ "content-length": "5" })],
    ["a path that only starts like /dav", dav("/davx/a"), answer({ "content-length": "5" })],
    ["a compressed body", dav(), answer({ "content-length": "5", "content-encoding": "gzip" })],
    ["a length that is not a number", dav(), answer({ "content-length": "five" })],
    ["a negative length", dav(), answer({ "content-length": "-1" })],
    ["a length past the safe integers", dav(), answer({ "content-length": "9".repeat(20) })],
  ])("leaves %s alone", (_name, request, original) => {
    const { lengths, fixed } = recording();
    expect(withFixedLength(request, original, fixed)).toBe(original);
    expect(lengths).toEqual([]);
  });

  it("does not throw when the body fails part way", async () => {
    const { fixed } = recording();
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => controller.error(new Error("storage went away")),
    });
    const response = withFixedLength(dav(), answer({ "content-length": "5" }, body), fixed);
    await expect(response.text()).rejects.toThrow();
  });
});
