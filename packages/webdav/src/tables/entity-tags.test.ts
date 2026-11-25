import { describe, expect, it } from "vitest";
import { setup } from "../test/harness";
import {
  CURRENT,
  expected,
  ORDERS,
  TABLE,
  VALUES,
  type Resource,
  type Target,
} from "./entity-tags-cases";

// If-Match and If-None-Match (RFC 9110 §13.1.1, §13.1.2, §13.2.2): the table and oracle of
// entity-tags-cases.ts, against the handler.

const run = async (field: "if-match" | "if-none-match", value: string, target: Target) => {
  const world = setup();
  const put = await world.put("/f.txt", "content");
  const opaque = (put.headers.get("etag") ?? "").slice(1, -1);
  const missing = target.endsWith("missing");
  const resource: Resource = missing ? { exists: false } : { exists: true, opaque };
  const header = value.replaceAll(CURRENT, opaque);
  const path = missing ? "/new.txt" : "/f.txt";
  const response = target.startsWith("GET")
    ? await world.dav("GET", path, { headers: { [field]: header } })
    : await world.put(path, "replaced", { [field]: header });
  const body = await response.text();
  const statuses = expected(field, header, target, resource);
  expect(statuses).toContain(response.status);
  // Only a request whose conditions hold changes the resource.
  const after = await world.storage.stat(missing ? ["new.txt"] : ["f.txt"]);
  const wrote = response.status === 201 || response.status === 204;
  if (missing) expect(after.ok).toBe(wrote);
  else expect(after.ok && after.value.etag !== opaque).toBe(wrote);
  if (response.status === 304) {
    expect(body).toBe("");
    expect(response.headers.get("etag")).toBe(`"${opaque}"`);
  }
};

describe("If-Match and If-None-Match", () => {
  it.each(TABLE)("%s on %s: %j", async (field, target, value) => {
    await run(field, value, target);
  });

  it.each(["if-match", "if-none-match"] as const)(
    "%s on a missing resource for GET is 404",
    async (field) => {
      await run(field, "*", "GET missing");
    },
  );

  it.each(ORDERS)("GET: %s", async (_label, headers, status) => {
    const world = setup();
    const put = await world.put("/f.txt", "content");
    const tag = put.headers.get("etag") ?? "";
    const resolved = Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name, value.replaceAll(`"${CURRENT}"`, tag)]),
    );
    const response = await world.dav("GET", "/f.txt", { headers: resolved });
    await response.body?.cancel();
    expect(response.status).toBe(status);
  });
});

// What the oracle allows for each value, written out (RFC 9110 §13.1.1, §13.1.2): for If-Match and
// then If-None-Match, the statuses of a GET and a PUT of the existing resource, whose tag is
// "@current", and of a PUT of a missing one. A change to a value or to the oracle that moves an
// answer fails here, not only in the comparison with the handler.
describe("the entity-tag table, written out", () => {
  const existing: Resource = { exists: true, opaque: CURRENT };
  const answers = (field: "if-match" | "if-none-match", value: string) =>
    [
      expected(field, value, "GET existing", existing),
      expected(field, value, "PUT existing", existing),
      expected(field, value, "PUT missing", { exists: false }),
    ]
      .map((statuses) => statuses.join("/"))
      .join(" ");

  it("allows these statuses for each value", () => {
    expect(
      VALUES.map(
        (value) =>
          `[${value}]: If-Match ${answers("if-match", value)}; If-None-Match ${answers("if-none-match", value)}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "["@current"]: If-Match 200 204 412; If-None-Match 304 412 201",
        "[W/"@current"]: If-Match 412 412 412; If-None-Match 304 412 201",
        "["other"]: If-Match 412 412 412; If-None-Match 200 204 201",
        "[W/"other"]: If-Match 412 412 412; If-None-Match 200 204 201",
        "[""]: If-Match 412 412 412; If-None-Match 200 204 201",
        "[*]: If-Match 200 204 412; If-None-Match 304 412 201",
        "["other", "@current"]: If-Match 200 204 412; If-None-Match 304 412 201",
        "["@current", "other"]: If-Match 200 204 412; If-None-Match 304 412 201",
        "[W/"@current", "other"]: If-Match 412 412 412; If-None-Match 304 412 201",
        "["other", W/"other"]: If-Match 412 412 412; If-None-Match 200 204 201",
        "[W/"other", W/"@current"]: If-Match 412 412 412; If-None-Match 304 412 201",
        "["@current", W/"@current"]: If-Match 200 204 412; If-None-Match 304 412 201",
        "["a", "b", "c", "@current"]: If-Match 200 204 412; If-None-Match 304 412 201",
        "[   "@current"   ]: If-Match 200 204 412; If-None-Match 304 412 201",
        "["@current" , "other"]: If-Match 200 204 412; If-None-Match 304 412 201",
        "["@current",]: If-Match 200 204 412; If-None-Match 304 412 201",
        "[, "@current"]: If-Match 200 204 412; If-None-Match 304 412 201",
        "[,"@current"]: If-Match 200 204 412; If-None-Match 304 412 201",
        "["other",, "@current"]: If-Match 200 204 412; If-None-Match 304 412 201",
        "["other" , , W/"@current"]: If-Match 412 412 412; If-None-Match 304 412 201",
        "[, , "@current", ,]: If-Match 200 204 412; If-None-Match 304 412 201",
        "["other",,]: If-Match 412 412 412; If-None-Match 200 204 201",
        "[,]: If-Match 412 412 412; If-None-Match 200/304 204/412 201/412",
        "[ , , ]: If-Match 412 412 412; If-None-Match 200/304 204/412 201/412",
        "[@current]: If-Match 412 412 412; If-None-Match 200/304 204/412 201/412",
        "["@current]: If-Match 412 412 412; If-None-Match 200/304 204/412 201/412",
        "[w/"@current"]: If-Match 412 412 412; If-None-Match 200/304 204/412 201/412",
        "[W/ "@current"]: If-Match 412 412 412; If-None-Match 200/304 204/412 201/412",
        "["@current" "other"]: If-Match 412 412 412; If-None-Match 200/304 204/412 201/412",
        "[*, "@current"]: If-Match 412 412 412; If-None-Match 200/304 204/412 201/412",
        "["@current"x]: If-Match 412 412 412; If-None-Match 200/304 204/412 201/412",
        "[""@current""]: If-Match 412 412 412; If-None-Match 200/304 204/412 201/412",
        "[**]: If-Match 412 412 412; If-None-Match 200/304 204/412 201/412",
        "[]: If-Match 412 412 412; If-None-Match 200/304 204/412 201/412",
      ]
    `);
  });

  it("answers a GET of a missing resource with 404 and covers every pair", () => {
    expect(expected("if-match", "*", "GET missing", { exists: false })).toEqual([404]);
    expect(expected("if-none-match", '"x"', "GET missing", { exists: false })).toEqual([404]);
    expect(new Set(TABLE.map(([field, target]) => `${field} ${target}`))).toEqual(
      new Set(
        ["if-match", "if-none-match"].flatMap((field) =>
          ["GET existing", "PUT existing", "PUT missing"].map((target) => `${field} ${target}`),
        ),
      ),
    );
    expect(TABLE).toHaveLength(6 * VALUES.length);
  });

  it("orders the conditions", () => {
    expect(
      ORDERS.map(([label, headers, status]) => `${label}: ${JSON.stringify(headers)} -> ${status}`),
    ).toMatchInlineSnapshot(`
      [
        "If-Match false beats If-None-Match true: {"if-match":"\\"other\\"","if-none-match":"\\"other\\""} -> 412",
        "If-Match true, If-None-Match false: {"if-match":"\\"@current\\"","if-none-match":"\\"@current\\""} -> 304",
        "If-Match true ignores If-Unmodified-Since: {"if-match":"*","if-unmodified-since":"Thu, 01 Jan 1970 00:00:00 GMT"} -> 200",
        "If-Unmodified-Since in the past alone: {"if-unmodified-since":"Thu, 01 Jan 1970 00:00:00 GMT"} -> 412",
        "If-Unmodified-Since in the future alone: {"if-unmodified-since":"Fri, 01 Jan 2100 00:00:00 GMT"} -> 200",
        "If-Modified-Since in the future: {"if-modified-since":"Fri, 01 Jan 2100 00:00:00 GMT"} -> 304",
        "If-Modified-Since in the past: {"if-modified-since":"Thu, 01 Jan 1970 00:00:00 GMT"} -> 200",
        "If-None-Match true ignores If-Modified-Since: {"if-none-match":"\\"other\\"","if-modified-since":"Fri, 01 Jan 2100 00:00:00 GMT"} -> 200",
        "an invalid If-Modified-Since is ignored: {"if-modified-since":"not a date"} -> 200",
        "an invalid If-Unmodified-Since is ignored: {"if-unmodified-since":"not a date"} -> 200",
      ]
    `);
  });
});
