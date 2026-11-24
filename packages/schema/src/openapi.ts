import { Schema } from "effect";
import { ApiErrorBody } from "./api";
import { ROUTES, type RouteContract } from "./routes";

// The OpenAPI 3.1 document of the management API, generated from the schemas of routes.ts: each
// schema becomes JSON Schema draft 2020-12, which OpenAPI 3.1 takes as it is, with its named parts
// under components/schemas.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const COMPONENTS = "#/components/schemas/";

/** Points every `$ref` of a generated schema at components/schemas instead of its own $defs. */
const relink = (value: unknown): Json => {
  if (Array.isArray(value)) return value.map(relink);
  if (typeof value === "object" && value !== null) {
    const out: JsonObject = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] =
        key === "$ref" && typeof inner === "string"
          ? inner.replace(/^#\/\$defs\//, COMPONENTS)
          : relink(inner);
    }
    return out;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON Schema holds only JSON
  return value as Json;
};

/** The JSON Schema of a schema, adding its named parts to `components`. */
const schemaOf = (schema: Schema.Top, components: JsonObject): JsonObject => {
  const document = Schema.toJsonSchemaDocument(schema);
  for (const [name, definition] of Object.entries(document.definitions)) {
    const relinked = relink(definition);
    const known = components[name];
    if (known !== undefined && JSON.stringify(known) !== JSON.stringify(relinked)) {
      throw new Error(`Two schemas are named ${name}`);
    }
    components[name] = relinked;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- relink keeps an object an object
  return relink(document.schema) as JsonObject;
};

/** The object schema behind a reference, for a query's parameters. */
const resolve = (schema: JsonObject, components: JsonObject): JsonObject => {
  const ref = schema["$ref"];
  if (typeof ref !== "string") return schema;
  const target = components[ref.slice(COMPONENTS.length)];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- components hold schema objects
  return (target ?? {}) as JsonObject;
};

const json = (schema: JsonObject): JsonObject => ({
  "application/json": { schema },
});

/** `/api/keys/:id` as OpenAPI writes it, `/api/keys/{id}`, and the names of its parameters. */
export const openApiPath = (pattern: string): { path: string; parameters: string[] } => {
  const parameters: string[] = [];
  const path = pattern.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
    parameters.push(name);
    return `{${name}}`;
  });
  return { path, parameters };
};

const operationId = (method: string, pattern: string) =>
  [
    method.toLowerCase(),
    ...pattern
      .replace(/^\/api\//, "")
      .split(/[^A-Za-z0-9]+/)
      .filter((part) => part !== ""),
  ]
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");

const operation = (
  method: string,
  pattern: string,
  contract: RouteContract,
  components: JsonObject,
): JsonObject => {
  const { parameters } = openApiPath(pattern);
  const error = { $ref: `${COMPONENTS}ApiError` };
  const responses: JsonObject = {
    [String(contract.status)]: {
      description: contract.summary,
      content: json(schemaOf(contract.response, components)),
    },
  };
  if (contract.body !== undefined) {
    responses["400"] = { description: "The body is not JSON (invalid_json)", content: json(error) };
    responses["422"] = {
      description: "The body does not match its schema (invalid_body)",
      content: json(error),
    };
  }
  if (contract.public !== true) {
    responses["401"] = { description: "No session (unauthorized)", content: json(error) };
  }
  responses["default"] = { description: "A refusal, with its code", content: json(error) };
  const query =
    contract.query === undefined ? null : resolve(schemaOf(contract.query, components), components);
  const properties = query?.["properties"];
  const required = query?.["required"];
  const queryParameters =
    typeof properties === "object" && properties !== null && !Array.isArray(properties)
      ? Object.entries(properties).map(([name, schema]) => ({
          name,
          in: "query",
          required: Array.isArray(required) && required.includes(name),
          schema,
        }))
      : [];
  const all = [
    ...parameters.map((name) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    })),
    ...queryParameters,
  ];
  return {
    operationId: operationId(method, pattern),
    summary: contract.summary,
    ...(all.length === 0 ? {} : { parameters: all }),
    ...(contract.body === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            content: json(schemaOf(contract.body, components)),
          },
        }),
    ...(contract.public === true ? { security: [] } : {}),
    responses,
  };
};

/** The OpenAPI 3.1 document of every route in ROUTES, or of the routes given. */
export const openApiDocument = (
  version: string,
  routes: Readonly<Record<string, RouteContract>> = ROUTES,
): JsonObject => {
  const components: JsonObject = {};
  schemaOf(ApiErrorBody, components);
  const paths: JsonObject = {};
  for (const [name, contract] of Object.entries(routes)) {
    const [method = "", pattern = ""] = name.split(" ");
    const { path } = openApiPath(pattern);
    const item = (paths[path] ??= {});
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      item[method.toLowerCase()] = operation(method, pattern, contract, components);
    }
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Davloom management API",
      version,
      description:
        "The API the Dashboard uses. Better Auth's own routes under /api/auth are not listed.",
    },
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    security: [{ session: [] }],
    paths,
    components: {
      schemas: components,
      securitySchemes: {
        session: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
          description: "The session cookie of a sign-in through /api/auth.",
        },
      },
    },
  };
};
