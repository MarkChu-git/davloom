import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Schema } from "effect";
import { decodeJson } from "../shared/json";

/** What `wrangler tail --format json` reports about one invocation, in milliseconds. */
export interface TailEvent {
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly outcome: string;
  readonly cpuTime: number | null;
  readonly wallTime: number | null;
  readonly executionModel: string | null;
  readonly exceptions: readonly string[];
}

export interface Tail {
  readonly events: readonly TailEvent[];
  /** Waits until `count` events match, and returns the matches found by the deadline. */
  waitFor(
    matches: (event: TailEvent) => boolean,
    count: number,
    timeoutMs?: number,
  ): Promise<TailEvent[]>;
  /** The end of what wrangler printed to stderr, to explain a tail that never attached. */
  errorOutput(): string;
  stop(): void;
}

/** Runs `check` every `intervalMs` until it passes, and says whether it passed by the deadline. */
export const pollUntil = async (
  check: () => boolean | Promise<boolean>,
  { timeoutMs, intervalMs }: { readonly timeoutMs: number; readonly intervalMs: number },
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await delay(intervalMs);
  }
};

// Every field may be missing or null, so an event of an unexpected kind still parses.
const RawTailEvent = Schema.Struct({
  outcome: Schema.optional(Schema.NullOr(Schema.String)),
  cpuTime: Schema.optional(Schema.NullOr(Schema.Number)),
  wallTime: Schema.optional(Schema.NullOr(Schema.Number)),
  executionModel: Schema.optional(Schema.NullOr(Schema.String)),
  exceptions: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          name: Schema.optional(Schema.NullOr(Schema.String)),
          message: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      ),
    ),
  ),
  event: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        request: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              url: Schema.optional(Schema.NullOr(Schema.String)),
              method: Schema.optional(Schema.NullOr(Schema.String)),
            }),
          ),
        ),
        response: Schema.optional(
          Schema.NullOr(Schema.Struct({ status: Schema.optional(Schema.NullOr(Schema.Number)) })),
        ),
      }),
    ),
  ),
});
type RawTailEvent = typeof RawTailEvent.Type;

const toTailEvent = (raw: RawTailEvent): TailEvent => ({
  method: raw.event?.request?.method ?? "",
  url: raw.event?.request?.url ?? "",
  status: raw.event?.response?.status ?? null,
  outcome: raw.outcome ?? "unknown",
  cpuTime: raw.cpuTime ?? null,
  wallTime: raw.wallTime ?? null,
  executionModel: raw.executionModel ?? null,
  exceptions: (raw.exceptions ?? []).map(({ name, message }) => `${name}: ${message}`),
});

/**
 * Splits a stream of concatenated JSON objects. Wrangler may print them on one line or over several,
 * so this tracks nesting instead of relying on line breaks.
 */
export const createJsonObjectSplitter = (onObject: (text: string) => void) => {
  let current = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  return (text: string) => {
    for (const character of text) {
      if (depth === 0 && character !== "{") {
        continue;
      }
      current += character;
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
      } else if (character === '"') {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          onObject(current);
          current = "";
        }
      }
    }
  };
};

/** Follows a deployed Worker's invocations, which is the only place its CPU time is reported. */
export const startTail = (workerName: string, config: string, cwd: string): Tail => {
  const events: TailEvent[] = [];
  let errorOutput = "";
  const split = createJsonObjectSplitter((text) => {
    events.push(toTailEvent(decodeJson(RawTailEvent, JSON.parse(text))));
  });
  const child = spawn(
    "bunx",
    ["wrangler", "tail", workerName, "--format", "json", "--config", config],
    {
      cwd,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", split);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text: string) => {
    errorOutput = (errorOutput + text).slice(-4000);
  });

  return {
    events,
    waitFor: async (matches, count, timeoutMs = 30_000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = events.filter(matches);
        if (found.length >= count || Date.now() > deadline) {
          return found;
        }
        await delay(250);
      }
    },
    errorOutput: () => errorOutput,
    stop: () => {
      child.kill();
    },
  };
};
