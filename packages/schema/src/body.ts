import { Data, Effect, Schema, SchemaIssue } from "effect";

// Decoding at the HTTP boundary: a request body is JSON text that must match its route's schema,
// a query is a set of strings, and an answer is encoded through its schema before it is sent.

/** The body is not JSON. */
export class BodyNotJson extends Data.TaggedError("BodyNotJson")<{}> {}

/** One place where a body does not match its schema. */
export interface BodyIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/** The body is JSON, but not of its route's shape; `issues` says where. */
export class BodyInvalid extends Data.TaggedError("BodyInvalid")<{
  readonly reason: string;
  readonly issues: readonly BodyIssue[];
}> {}

const formatter = SchemaIssue.makeFormatterStandardSchemaV1();

/** The issues of a failed decode, with each path as keys and indexes. */
export const issuesOf = (issue: SchemaIssue.Issue): BodyIssue[] =>
  formatter(issue).issues.map((found) => ({
    path: (found.path ?? []).map((segment) => {
      const key = typeof segment === "object" && segment !== null ? segment.key : segment;
      return typeof key === "number" ? key : String(key);
    }),
    message: found.message,
  }));

const reasonOf = (issues: readonly BodyIssue[]): string =>
  issues
    .map(({ path, message }) => (path.length === 0 ? message : `${path.join(".")}: ${message}`))
    .join("; ");

/** Parses JSON text; an empty body reads as an empty object, as the API always read it. */
export const parseJson = (text: string): Effect.Effect<unknown, BodyNotJson> =>
  text.trim() === ""
    ? Effect.succeed({})
    : Effect.try({ try: (): unknown => JSON.parse(text), catch: () => new BodyNotJson() });

/** Decodes a value with a schema, or fails with where it does not match. */
export const decodeWith =
  <A, I>(schema: Schema.Codec<A, I>) =>
  (value: unknown): Effect.Effect<A, BodyInvalid> =>
    Schema.decodeUnknownEffect(schema)(value, { errors: "all" }).pipe(
      Effect.mapError((error) => {
        const issues = issuesOf(error.issue);
        return new BodyInvalid({ reason: reasonOf(issues), issues });
      }),
    );

/** Reads a request's body as JSON and decodes it with its route's schema. */
export const decodeBody = <A, I>(
  schema: Schema.Codec<A, I>,
  request: Request,
): Effect.Effect<A, BodyNotJson | BodyInvalid> =>
  Effect.promise(() => request.text().catch(() => "")).pipe(
    Effect.flatMap(parseJson),
    Effect.flatMap(decodeWith(schema)),
  );

/** Decodes a request URL's query parameters with a schema; a repeated parameter keeps its first. */
export const decodeQuery = <A, I>(
  schema: Schema.Codec<A, I>,
  url: string,
): Effect.Effect<A, BodyInvalid> => {
  const query: Record<string, string> = {};
  for (const [name, value] of new URL(url).searchParams) query[name] ??= value;
  return decodeWith(schema)(query);
};

/**
 * Encodes an answer through its schema. An answer that does not match is a defect of the server,
 * never the client's fault, so it dies rather than fail.
 */
export const encodeWith =
  <A, I>(schema: Schema.Codec<A, I>) =>
  (value: unknown): Effect.Effect<I> =>
    Schema.encodeUnknownEffect(schema)(value).pipe(Effect.orDie);
