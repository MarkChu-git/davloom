import { Schema } from "effect";

/**
 * Checks a parsed JSON value against a schema and returns it with the schema's type. Tests and
 * probes use it instead of a type assertion, so a body with the wrong shape fails with the mismatch.
 */
export const decodeJson = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  value: unknown,
): S["Type"] => Schema.decodeUnknownSync(schema)(value);

/** Reads a response body as JSON and checks it against a schema. */
export const readJson = async <S extends Schema.ConstraintDecoder<unknown>>(
  response: Response,
  schema: S,
): Promise<S["Type"]> => decodeJson(schema, await response.json());
