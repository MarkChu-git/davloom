import type { Server } from "node:http";
import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEASURED_BODY_BYTES, serveNode, urlOf, type FetchHandler } from "./node-server.bun";

// The self-hosted HTTP server: what a client receives from node:http for each kind of answer the
// app gives, and what the app receives of each request.

const streamOf = (chunks: readonly Uint8Array[], delayMs = 1) =>
  new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        await Bun.sleep(delayMs);
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

const bytes = (length: number, seed = 0) =>
  Uint8Array.from({ length }, (_, index) => (index + seed) % 251);

let handle: FetchHandler = () => new Response(null);
let server: Server;
let base = "";

beforeAll(async () => {
  const served = await serveNode((request) => handle(request), { hostname: "127.0.0.1", port: 0 });
  server = served.server;
  base = served.url.replace(/\/$/, "");
});
afterAll(async () => {
  await new Promise((closed) => server.close(closed));
});

/** Sends raw bytes and returns the raw answer, for what fetch would hide. */
const raw = (text: string) =>
  new Promise<string>((done, failed) => {
    const socket = connect(Number(new URL(base).port), "127.0.0.1");
    let answer = "";
    socket.on("data", (data) => {
      answer += data.toString("latin1");
    });
    socket.on("end", () => done(answer));
    socket.on("error", failed);
    socket.write(text);
  });

describe("answers", () => {
  it.each([4_999, 300_000, 3_000_000])(
    "sends the Content-Length of a streamed body of %i bytes",
    async (size) => {
      const body = bytes(size);
      const third = Math.ceil(size / 3);
      handle = () =>
        new Response(
          streamOf([body.slice(0, third), body.slice(third, 2 * third), body.slice(2 * third)]),
          {
            headers: { "content-length": String(size) },
          },
        );
      const response = await fetch(`${base}/file`);
      expect(response.headers.get("content-length")).toBe(String(size));
      expect(response.headers.get("transfer-encoding")).toBeNull();
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(body);
    },
  );

  it.each([0, 1, 700, MEASURED_BODY_BYTES])(
    "measures a body of %i bytes without a Content-Length",
    async (size) => {
      handle = () => new Response(streamOf([bytes(size)]));
      const response = await fetch(`${base}/small`);
      expect(response.headers.get("content-length")).toBe(String(size));
      expect((await response.arrayBuffer()).byteLength).toBe(size);
    },
  );

  it("measures a text body, as an XML answer has", async () => {
    handle = () =>
      new Response("<multistatus/>", {
        status: 207,
        headers: { "content-type": "application/xml" },
      });
    const response = await fetch(`${base}/xml`);
    expect(response.status).toBe(207);
    expect(response.headers.get("content-type")).toBe("application/xml");
    expect(response.headers.get("content-length")).toBe("14");
    expect(await response.text()).toBe("<multistatus/>");
  });

  it("streams a long body without a Content-Length chunked", async () => {
    const chunks = [bytes(MEASURED_BODY_BYTES, 1), bytes(MEASURED_BODY_BYTES, 2), bytes(10, 3)];
    handle = () => new Response(streamOf(chunks));
    const response = await fetch(`${base}/long`);
    expect(response.headers.get("content-length")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array(await new Blob(chunks).arrayBuffer()),
    );
  });

  it("answers HEAD with the headers only", async () => {
    let cancelled = false;
    handle = () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-length": "1234", etag: '"e"' } },
      );
    const response = await fetch(`${base}/file`, { method: "HEAD" });
    expect(response.headers.get("content-length")).toBe("1234");
    expect(response.headers.get("etag")).toBe('"e"');
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect(cancelled).toBe(true);
  });

  it("answers a bodiless status", async () => {
    handle = () => new Response(null, { status: 204, headers: { dav: "1, 2" } });
    const response = await fetch(`${base}/x`, { method: "DELETE" });
    expect(response.status).toBe(204);
    expect(response.headers.get("dav")).toBe("1, 2");
  });

  it("sends each cookie in a header of its own", async () => {
    const headers = new Headers();
    headers.append("set-cookie", "a=1; Path=/");
    headers.append("set-cookie", "b=2; Path=/");
    handle = () => new Response(null, { headers });
    const response = await fetch(`${base}/cookies`);
    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });

  it("answers 500 when the handler throws", async () => {
    handle = () => {
      throw new Error("the handler failed on purpose");
    };
    expect((await fetch(`${base}/throws`)).status).toBe(500);
  });

  it("answers 500 when the body fails before anything is sent", async () => {
    handle = () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new Error("the body failed on purpose"));
          },
        }),
      );
    expect((await fetch(`${base}/fails`)).status).toBe(500);
  });

  it("breaks the connection when the body fails after the status line", async () => {
    let sent = 0;
    handle = () =>
      new Response(
        new ReadableStream({
          async pull(controller) {
            await Bun.sleep(1);
            sent += 1;
            if (sent > 2) controller.error(new Error("the body failed on purpose"));
            else controller.enqueue(bytes(1000));
          },
        }),
        { headers: { "content-length": "100000" } },
      );
    const response = await fetch(`${base}/broken`);
    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toThrow();
  });

  it("stops reading the body when the client goes away", async () => {
    let cancelled = false;
    let aborted = false;
    handle = (request) => {
      request.signal.addEventListener("abort", () => {
        aborted = true;
      });
      return new Response(
        new ReadableStream({
          async pull(controller) {
            await Bun.sleep(1);
            controller.enqueue(bytes(64 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-length": String(1024 ** 3) } },
      );
    };
    const controller = new AbortController();
    const response = await fetch(`${base}/endless`, { signal: controller.signal });
    const reader = response.body?.getReader();
    await reader?.read();
    controller.abort();
    for (let tries = 0; tries < 200; tries += 1) {
      if (cancelled && aborted) break;
      await Bun.sleep(5);
    }
    expect({ cancelled, aborted }).toEqual({ cancelled: true, aborted: true });
  });
});

describe("requests", () => {
  it("passes the method, URL, headers and streamed body on", async () => {
    let seen: { method: string; url: string; header: string | null; size: number } | null = null;
    handle = async (request) => {
      seen = {
        method: request.method,
        url: request.url,
        header: request.headers.get("x-test"),
        size: (await request.arrayBuffer()).byteLength,
      };
      return new Response(null, { status: 201 });
    };
    const body = bytes(2 * 1024 * 1024);
    const response = await fetch(`${base}/dav/a%20b.bin?x=1`, {
      method: "PUT",
      headers: { "x-test": "yes" },
      body,
    });
    expect(response.status).toBe(201);
    expect(seen).toEqual({
      method: "PUT",
      url: `${base}/dav/a%20b.bin?x=1`,
      header: "yes",
      size: body.byteLength,
    });
  });

  it("names no loopback host for a request without a Host", async () => {
    let url = "";
    handle = (request) => {
      url = request.url;
      return new Response("ok");
    };
    const answer = await raw("GET /dav/ HTTP/1.0\r\n\r\n");
    expect(answer).toMatch(/^HTTP\/1\.[01] 200/);
    expect(url).toBe("http://host.invalid/dav/");
  });

  it.each([
    ["/a?b", "example.com:8080", "http://example.com:8080/a?b"],
    ["/a", "127.0.0.1", "http://127.0.0.1/a"],
    ["/a", undefined, "http://host.invalid/a"],
    ["/a", "", "http://host.invalid/a"],
    ["/a", "evil.com/x", "http://host.invalid/a"],
    ["/a", "127.0.0.1@evil.com", "http://host.invalid/a"],
    ["/a", "bad host", "http://host.invalid/a"],
    ["/a", "[::1", "http://host.invalid/a"],
    ["http://example.com/abs", "other", "http://example.com/abs"],
    ["*", "example.com", "http://host.invalid/"],
  ])("takes the URL of %s with Host %s for %s", (target, host, url) => {
    expect(urlOf(target, host).href).toBe(url);
  });
});
