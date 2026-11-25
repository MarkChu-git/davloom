import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import worker from "./entry.workers";

// The Worker's entry, with `cloudflare:workers` replaced by the stand-in of the unit tests. The
// production Worker itself runs in workerd (tests/integration/compat).
describe("the Workers entry", () => {
  it("answers through the app", async () => {
    const response = await worker.fetch(new Request("https://davloom.example/api/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("hands GET / to the static assets, and 404 without them", async () => {
    expect((await worker.fetch(new Request("https://davloom.example/"))).status).toBe(404);
    env.ASSETS = { fetch: (request: Request) => new Response(`assets ${request.method}`) };
    try {
      const response = await worker.fetch(new Request("https://davloom.example/"));
      expect(await response.text()).toBe("assets GET");
    } finally {
      delete env.ASSETS;
    }
  });

  it("sends PROPFIND / on to /dav/", async () => {
    const response = await worker.fetch(
      new Request("https://davloom.example/", { method: "PROPFIND" }),
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://davloom.example/dav/");
  });
});
