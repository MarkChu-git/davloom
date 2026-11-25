import { Cause, Context, Data, Effect, Exit, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { makeHttpRunner, responseFromExit } from "./http";

class FileNotFound extends Data.TaggedError("FileNotFound")<{ readonly path: string }> {}
class Refused extends Data.TaggedError("Refused")<{ readonly reason: unknown }> {}
class FieldRefused extends Data.TaggedError("FieldRefused")<{
  readonly reason: string;
  readonly reasonCode: unknown;
}> {}

const errors = {
  FileNotFound: { status: 404, code: "file_not_found" },
  Refused: { status: 422, code: "refused" },
  FieldRefused: { status: 400, code: "password_refused" },
};

describe("responseFromExit", () => {
  it("returns a success value as JSON with the default status", async () => {
    const response = responseFromExit(Exit.succeed({ size: 3 }), { errors });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ size: 3 });
  });

  it("uses the requested success status", () => {
    const response = responseFromExit(Exit.succeed({}), { errors, successStatus: 201 });

    expect(response.status).toBe(201);
  });

  it("passes a Response through unchanged", async () => {
    const original = new Response("raw", { status: 207 });
    const response = responseFromExit(Exit.succeed(original), { errors });

    expect(response).toBe(original);
  });

  it("maps a declared error to its status and code", async () => {
    const exit = Exit.fail(new FileNotFound({ path: "/secret/a.txt" }));
    const response = responseFromExit(exit, { errors });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('{"error":{"code":"file_not_found"}}');
  });

  it.each([
    [
      "a text reason as its message",
      "The key does not open this file.",
      '{"error":{"code":"refused","message":"The key does not open this file."}}',
    ],
    ["no message for a reason that is not text", 42, '{"error":{"code":"refused"}}'],
  ])("sends %s", async (_, reason, body) => {
    const response = responseFromExit(Exit.fail(new Refused({ reason })), { errors });
    expect(response.status).toBe(422);
    expect(await response.text()).toBe(body);
  });

  it.each([
    [
      "a reason code as its reason",
      "too_short",
      '{"error":{"code":"password_refused","message":"Password too short","reason":"too_short"}}',
    ],
    [
      "no reason for a code that is not text",
      7,
      '{"error":{"code":"password_refused","message":"Password too short"}}',
    ],
  ])("sends %s", async (_, reasonCode, body) => {
    const exit = Exit.fail(new FieldRefused({ reason: "Password too short", reasonCode }));
    const response = responseFromExit(exit, { errors });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe(body);
  });

  it("hides a defect behind a 500 and reports it to the caller only", async () => {
    const onDefect = vi.fn();
    const exit = Exit.die(new Error("database password is hunter2"));
    const response = responseFromExit(exit, { errors, onDefect });
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toBe('{"error":{"code":"internal_error"}}');
    expect(onDefect).toHaveBeenCalledOnce();
    expect(Cause.pretty(onDefect.mock.calls[0]?.[0])).toContain("hunter2");
  });

  it("treats an error with no declared mapping as a defect", async () => {
    // The error is outside the declared union on purpose, which only an assertion can express.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const exit = Exit.fail({ _tag: "Unmapped" }) as unknown as Exit.Exit<never, FileNotFound>;
    const response = responseFromExit(exit, { errors });

    expect(response.status).toBe(500);
  });
});

describe("makeHttpRunner", () => {
  class Counter extends Context.Service<Counter, { readonly value: number }>()("Counter") {}

  it("builds its layer once across requests", async () => {
    let builds = 0;
    const layer = Layer.effect(
      Counter,
      Effect.sync(() => {
        builds += 1;
        return { value: builds };
      }),
    );
    const run = makeHttpRunner(layer);
    const program = Effect.map(Counter, ({ value }) => ({ value }));

    await run(program, { errors: {} });
    const response = await run(program, { errors: {} });

    expect(await response.json()).toEqual({ value: 1 });
    expect(builds).toBe(1);
  });
});
