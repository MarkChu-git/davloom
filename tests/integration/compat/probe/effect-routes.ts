import { makeHttpRunner } from "@davloom/core";
import { Context, Data, Effect, Layer } from "effect";
import { Elysia } from "elysia";

class ProbeFileNotFound extends Data.TaggedError("ProbeFileNotFound") {}

class ProbeRuntime extends Context.Service<ProbeRuntime, { readonly buildCount: () => number }>()(
  "ProbeRuntime",
) {}

let builds = 0;
const run = makeHttpRunner(
  Layer.effect(
    ProbeRuntime,
    Effect.sync(() => {
      builds += 1;
      return { buildCount: () => builds };
    }),
  ),
);

/** Exercises the mapping from Effect results to HTTP responses behind real Elysia routes. */
export const effectRoutes = new Elysia({ name: "probe-effect" })
  .get("/api/__probe/effect/success", () =>
    run(Effect.as(ProbeRuntime, { answer: 42 }), { errors: {}, successStatus: 201 }),
  )
  .get("/api/__probe/effect/declared", () =>
    run(Effect.fail(new ProbeFileNotFound()), {
      errors: { ProbeFileNotFound: { status: 404, code: "file_not_found" } },
    }),
  )
  .get("/api/__probe/effect/defect", () =>
    run(Effect.die(new Error("internal detail that must stay private")), { errors: {} }),
  )
  .get("/api/__probe/effect/runtime-builds", () =>
    run(
      Effect.map(ProbeRuntime, ({ buildCount }) => ({ builds: buildCount() })),
      { errors: {} },
    ),
  );
