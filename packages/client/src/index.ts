import type { App } from "@davloom/api/contract";
import { treaty, type Treaty } from "@elysiajs/eden/treaty2";

// The typed client of Davloom's management API: Eden Treaty over the type of the app in
// apps/api (apps/api/src/contract.ts), so each call's path, parameters, body and answer come from
// the server's routes and their contracts in packages/schema. Better Auth's routes under
// /api/auth are not part of it: the app serves them through one wildcard route.

export type { Answer } from "@davloom/api/contract";

/** The routes under /api, as `client.keys({ id }).patch({ name })`. */
export type ApiClient = Treaty.Create<App>["api"];

/** Sends one request the client built; the caller decides the transport, such as cookies. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  /** Where the API answers; "" for the origin of the page, as the Dashboard calls it. */
  readonly origin?: string;
  readonly fetcher: Fetcher;
}

/** What a call settles to: the answer, or the refusal with its status and parsed body. */
export type Outcome<Data> =
  | { readonly data: Data; readonly error: null }
  | {
      readonly data: null;
      readonly error: { readonly status: unknown; readonly value: unknown };
      readonly status: number;
      /** Absent when no answer came: the fetcher threw, and `error.value` is what it threw. */
      readonly response?: Response | undefined;
    };

/**
 * The method, headers and body a request to the API is sent with. The API takes a request that
 * changes something only as JSON, which no cross-site form can send (apps/api same-origin.ts), so
 * every such request carries JSON, `{}` when it has no body; a GET carries neither.
 */
export const jsonRequest = ({
  method = "GET",
  body,
}: RequestInit): {
  method: string;
  headers: Record<string, string>;
  body: BodyInit | null | undefined;
} => {
  const changes = method !== "GET" && method !== "HEAD";
  return {
    method,
    headers: changes || body != null ? { "content-type": "application/json" } : {},
    body: body ?? (changes ? "{}" : undefined),
  };
};

/** The names Eden Treaty reads as a request's method rather than as a segment of its path. */
const METHODS = new Set([
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "options",
  "head",
  "connect",
  "subscribe",
]);

type Node = (...args: unknown[]) => unknown;

/**
 * Eden Treaty's proxy, with every path parameter encoded as one segment. Eden puts a parameter
 * such as `keys({ id })` into the path as it is, so an id holding `/`, `?` or `#` would reach
 * another route. Eden reads a call of one object with one property as a parameter unless the
 * last name is a method, and so does this.
 */
const encodingParams = (node: Node, last: string): Node =>
  new Proxy(node, {
    get: (target, key) => {
      const next: unknown = Reflect.get(target, key);
      return typeof key === "string" && typeof next === "function"
        ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every node of Eden's tree is a function
          encodingParams(next as Node, key)
        : next;
    },
    apply: (target, self, args: unknown[]) => {
      const [first] = args;
      const entries =
        !METHODS.has(last) && args.length === 1 && typeof first === "object" && first !== null
          ? Object.entries(first)
          : [];
      const [entry] = entries;
      if (entries.length !== 1 || entry === undefined) return Reflect.apply(target, self, args);
      const [name, value] = entry;
      const next: unknown = Reflect.apply(target, self, [
        { [name]: encodeURIComponent(String(value)) },
      ]);
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a parameter leads to the next node
      return encodingParams(next as Node, last);
    },
  });

/**
 * A client of the API at `origin`. Every request goes through `fetcher`. Dates stay the ISO
 * strings the contracts describe instead of becoming Date objects.
 */
export const createApiClient = ({ origin = "", fetcher }: ApiClientOptions): ApiClient => {
  const root = treaty<App>(origin, {
    keepDomain: true,
    parseDate: false,
    // Eden calls its fetcher with the URL it built and a RequestInit.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Eden passes a string URL
    fetcher: fetcher as typeof fetch,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the same client, its parameters encoded
  return encodingParams(root.api as unknown as Node, "api") as unknown as ApiClient;
};
