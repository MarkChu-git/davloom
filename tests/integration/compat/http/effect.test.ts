import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeRuntimes, type Server } from "./servers";

describe.each(probeRuntimes)("Effect programs behind Elysia on $name", ({ start }) => {
  let server: Server;

  beforeAll(async () => {
    server = await start();
  });
  afterAll(() => server?.stop());

  it("returns the result and success status of a program that succeeds", async () => {
    const response = await server.fetch("/api/__probe/effect/success");

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ answer: 42 });
  });

  it("maps a declared error to its status and code", async () => {
    const response = await server.fetch("/api/__probe/effect/declared");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "file_not_found" } });
  });

  it("returns a bare 500 for a defect", async () => {
    const response = await server.fetch("/api/__probe/effect/defect");
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toBe('{"error":{"code":"internal_error"}}');
  });

  it("builds the Effect runtime once for all requests", async () => {
    await server.fetch("/api/__probe/effect/success");
    await server.fetch("/api/__probe/effect/success");
    const response = await server.fetch("/api/__probe/effect/runtime-builds");

    expect(await response.json()).toEqual({ builds: 1 });
  });
});
