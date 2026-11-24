// A stand-in for the `cloudflare:workers` module in the unit tests, which run on Bun: the bindings
// of the Worker as a plain object the tests fill, and a Durable Object base class.

export const env: Record<string, unknown> = {};

export class DurableObject<Env = unknown> {
  protected ctx: unknown;
  protected env: Env;
  constructor(ctx: unknown, workerEnv: Env) {
    this.ctx = ctx;
    this.env = workerEnv;
  }
}
