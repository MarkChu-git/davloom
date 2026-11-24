import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { openApiDocument, openApiPath } from "./openapi";
import { routeContract, ROUTES, type RouteContract } from "./routes";

type Operation = Record<string, unknown>;

/** The document as plain JSON, to read with the shapes it is known to have. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the shape
const read = <T>(value: unknown): T =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the generated document's shape
  JSON.parse(JSON.stringify(value)) as T;

const document = openApiDocument("1.2.3");
const paths = read<Record<string, Record<string, Operation>>>(document["paths"]);
const schemas = read<{ schemas: Record<string, unknown> }>(document["components"]).schemas;

const operations = Object.entries(paths).flatMap(([path, item]) =>
  Object.entries(item).map(([method, operation]) => ({ path, method, operation })),
);

describe("openApiPath", () => {
  it.each([
    ["/api/keys", "/api/keys", []],
    ["/api/keys/:id", "/api/keys/{id}", ["id"]],
    ["/api/backends/:id/verify", "/api/backends/{id}/verify", ["id"]],
    ["/a/:one/b/:two_2", "/a/{one}/b/{two_2}", ["one", "two_2"]],
  ])("writes %s as %s", (pattern, path, parameters) => {
    expect(openApiPath(pattern)).toEqual({ path, parameters });
  });
});

describe("the OpenAPI document", () => {
  it("is OpenAPI 3.1 with the version it was given", () => {
    expect(document).toMatchObject({
      openapi: "3.1.0",
      info: { version: "1.2.3" },
      jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    });
  });

  it("has one operation for every route, and none more", () => {
    expect(operations).toHaveLength(Object.keys(ROUTES).length);
    for (const name of Object.keys(ROUTES)) {
      const [method = "", pattern = ""] = name.split(" ");
      expect(paths[openApiPath(pattern).path]?.[method.toLowerCase()], name).toBeDefined();
    }
  });

  it("gives every operation a distinct id", () => {
    const ids = operations.map(({ operation }) => operation["operationId"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(Object.entries(ROUTES) as [string, RouteContract][])(
    "describes %s from its contract",
    (name, contract) => {
      const [method = "", pattern = ""] = name.split(" ");
      const { path, parameters } = openApiPath(pattern);
      const operation = paths[path]?.[method.toLowerCase()] ?? {};
      expect(operation["summary"]).toBe(contract.summary);
      const responses = read<Record<string, unknown>>(operation["responses"]);
      expect(Object.keys(responses)).toContain(String(contract.status));
      expect(Object.keys(responses)).toContain("default");
      expect("requestBody" in operation).toBe(contract.body !== undefined);
      expect("400" in responses && "422" in responses).toBe(contract.body !== undefined);
      expect("401" in responses).toBe(contract.public !== true);
      expect(operation["security"]).toEqual(contract.public === true ? [] : undefined);
      const named = read<{ name: string; in: string }[]>(operation["parameters"] ?? [])
        .filter((parameter) => parameter.in === "path")
        .map((parameter) => parameter.name);
      expect(named).toEqual(parameters);
    },
  );

  it("lists the audit trail's query parameters", () => {
    expect(paths["/api/audit"]?.["get"]?.["parameters"]).toEqual([
      expect.objectContaining({ name: "before", in: "query", required: false }),
      expect.objectContaining({ name: "limit", in: "query", required: false }),
    ]);
  });

  it("keeps every named schema under components, and points every reference there", () => {
    const text = JSON.stringify(document);
    expect(text).not.toContain("$defs");
    for (const match of text.matchAll(/"\$ref":"([^"]+)"/g)) {
      const ref = match[1] ?? "";
      expect(ref.startsWith("#/components/schemas/"), ref).toBe(true);
      expect(schemas[ref.slice("#/components/schemas/".length)], ref).toBeDefined();
    }
  });

  it("is the same document each time", () => {
    expect(openApiDocument("1.2.3")).toEqual(document);
  });

  it("refuses two different schemas of one name", () => {
    const one = Schema.Struct({ a: Schema.String }).annotate({ identifier: "Same" });
    const other = Schema.Struct({ b: Schema.String }).annotate({ identifier: "Same" });
    const routes: Record<string, RouteContract> = {
      "GET /one": { summary: "one", response: one, status: 200 },
      "GET /other": { summary: "other", response: other, status: 200 },
    };
    expect(() => openApiDocument("0", routes)).toThrow("Two schemas are named Same");
  });

  it("takes a query without named properties", () => {
    const routes: Record<string, RouteContract> = {
      "GET /q": { summary: "q", query: Schema.Unknown, response: Schema.Unknown, status: 200 },
    };
    const built = read<{ paths: Record<string, Record<string, object>> }>(
      openApiDocument("0", routes),
    );
    expect(built.paths["/q"]?.["get"]).not.toHaveProperty("parameters");
  });
});

describe("routeContract", () => {
  it.each([
    ["GET", "/api/keys", ROUTES["GET /api/keys"]],
    ["get", "/api/keys", ROUTES["GET /api/keys"]],
    ["PATCH", "/api/keys/:id", ROUTES["PATCH /api/keys/:id"]],
    ["GET", "/api/nothing", undefined],
    ["GET", "/api/auth/*", undefined],
    ["TOSTRING", "", undefined],
  ])("finds %s %s", (method, pattern, contract) => {
    expect(routeContract(method, pattern)).toBe(contract);
  });
});
