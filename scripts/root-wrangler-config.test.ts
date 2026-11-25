import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The repository root's wrangler.jsonc is what the Deploy to Cloudflare button deploys, and
// apps/api/wrangler.jsonc is what the project's own deploy uses. They describe the same Worker:
// only the project's custom domain (`routes`) and its D1 database id may differ, and every path
// in one must name the same file as in the other.

const ROOT = resolve(import.meta.dirname, "..");
const ROOT_CONFIG = resolve(ROOT, "wrangler.jsonc");
const API_CONFIG = resolve(ROOT, "apps/api/wrangler.jsonc");

type Config = Record<string, unknown>;

/** An object or an array, whose members are read by key or index. */
const isRecord = (value: unknown): value is Config => typeof value === "object" && value !== null;

const read = (path: string, parse: (text: string) => unknown = Bun.JSONC.parse): Config => {
  const parsed = parse(readFileSync(path, "utf8"));
  if (!isRecord(parsed)) throw new Error(`${path} holds no object`);
  return parsed;
};

const root = read(ROOT_CONFIG);
const api = read(API_CONFIG);

/** The value at a path of keys and array indexes. */
const at = (config: Config, path: readonly (string | number)[]): unknown =>
  path.reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), config);

/** The keys of the object at a path, sorted. */
const keysAt = (config: Config, path: readonly (string | number)[]) => {
  const value = at(config, path);
  return isRecord(value) ? Object.keys(value).toSorted() : [];
};

/** Drops the keys allowed to differ, or that hold paths, so that what is left must be equal. */
const without = (value: unknown, keys: readonly string[]): unknown => {
  if (Array.isArray(value)) return value.map((entry) => without(entry, keys));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
};

// Settings that must be equal in both files, less the keys named, which hold paths or the id.
const SAME: [name: string, key: string, ignore: string[]][] = [
  ["Worker name", "name", []],
  ["compatibility date", "compatibility_date", []],
  ["compatibility flags", "compatibility_flags", []],
  ["keep_vars", "keep_vars", []],
  ["assets settings", "assets", ["directory"]],
  ["D1 bindings and database names", "d1_databases", ["database_id", "migrations_dir"]],
  ["Durable Object bindings", "durable_objects", []],
  ["Durable Object migrations", "migrations", []],
  ["vars", "vars", []],
];

// Paths, each resolved against its own config's directory.
const PATHS: [name: string, path: (string | number)[], mustExist: boolean][] = [
  ["$schema", ["$schema"], true],
  ["entry", ["main"], true],
  ["assets directory", ["assets", "directory"], false],
  ["D1 migrations", ["d1_databases", 0, "migrations_dir"], true],
  ["@aws-sdk/xml-builder alias", ["alias", "@aws-sdk/xml-builder"], true],
];

const resolved = (configPath: string, config: Config, path: (string | number)[]) => {
  const value = at(config, path);
  if (typeof value !== "string") throw new Error(`${configPath} has no ${path.join(".")}`);
  return resolve(dirname(configPath), value);
};

describe("the root wrangler.jsonc", () => {
  it("has the same top-level settings as apps/api/wrangler.jsonc, without routes", () => {
    expect(Object.keys(root).toSorted()).toEqual(
      Object.keys(api)
        .filter((key) => key !== "routes")
        .toSorted(),
    );
    expect(root.routes).toBeUndefined();
  });

  it.each(SAME)("keeps the %s", (_name, key, ignore) => {
    expect(without(root[key], ignore)).toEqual(without(api[key], ignore));
  });

  it("aliases the same modules", () => {
    expect(keysAt(root, ["alias"])).toEqual(keysAt(api, ["alias"]));
    expect(keysAt(root, ["alias"])).not.toEqual([]);
  });

  it.each(PATHS)("points its %s at the same file", (_name, path, mustExist) => {
    const fromRoot = resolved(ROOT_CONFIG, root, path);
    expect(fromRoot).toBe(resolved(API_CONFIG, api, path));
    if (mustExist) expect(existsSync(fromRoot)).toBe(true);
  });

  it("names a D1 database id of its own, not the project's", () => {
    const id = at(root, ["d1_databases", 0, "database_id"]);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(id).not.toBe(at(api, ["d1_databases", 0, "database_id"]));
  });
});

describe("the button's package.json and secrets", () => {
  const manifest = read(resolve(ROOT, "package.json"), JSON.parse);
  const examples = new Map(
    readFileSync(resolve(ROOT, ".dev.vars.example"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
  const secrets = [...examples.keys()];

  it.each([
    [
      "applies the D1 migrations by binding",
      "db:migrations:apply",
      "d1 migrations apply DB --remote",
    ],
    ["applies them with the root config", "db:migrations:apply", "--config wrangler.jsonc"],
    ["migrates before it deploys", "deploy", "bun run db:migrations:apply && "],
    ["deploys with the root config", "deploy", "wrangler deploy --config wrangler.jsonc"],
  ])("deploy %s", (_name, script, text) => {
    expect(at(manifest, ["scripts", script])).toContain(text);
  });

  it("asks for the instance secret and describes every secret it asks for", () => {
    expect(secrets).toContain("DAVLOOM_SECRET");
    for (const name of secrets) {
      expect(at(manifest, ["cloudflare", "bindings", name, "description"])).toBeTruthy();
    }
  });

  it("suggests no usable instance secret, so accepting the example fails instead of running", () => {
    // apps/api/src/instance.workers.ts refuses a DAVLOOM_SECRET shorter than 32 bytes.
    const example = examples.get("DAVLOOM_SECRET") ?? "";
    expect(new TextEncoder().encode(example).length).toBeLessThan(32);
  });
});
