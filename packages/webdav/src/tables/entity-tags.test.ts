import { describe, expect, it } from "vitest";
import { setup } from "../test/harness";

// If-Match and If-None-Match (RFC 9110 §13.1.1, §13.1.2, §13.2.2). The oracle reads the field
// with the grammar of §8.8.3 written here (`*` or a list of entity tags, `W/` case-sensitive,
// empty list elements ignored as §5.6.1 requires) and decides with the comparison functions of
// §8.8.3.2: If-Match compares strongly, If-None-Match weakly. A false If-Match is 412; a false
// If-None-Match is 304 for GET and HEAD and 412 otherwise.

const CURRENT = "@current";

interface Tag {
  readonly weak: boolean;
  readonly opaque: string;
}

/** §8.8.3: `*`, a list of tags, or null when the field is not valid. */
const parseTags = (value: string): "*" | Tag[] | null => {
  const text = value.trim();
  if (text === "*") return "*";
  const tags: Tag[] = [];
  for (const raw of text.split(",")) {
    const element = raw.trim();
    if (element === "") continue;
    const match = /^(W\/)?"([\x21\x23-\x7e\x80-\xff]*)"$/.exec(element);
    if (!match) return null;
    tags.push({ weak: match[1] !== undefined, opaque: match[2] ?? "" });
  }
  return tags.length > 0 ? tags : null;
};

type Resource = { readonly exists: false } | { readonly exists: true; readonly opaque: string };

const ifMatchHolds = (value: string, resource: Resource): boolean | null => {
  const tags = parseTags(value);
  if (tags === null) return null;
  if (!resource.exists) return false;
  return tags === "*" || tags.some((tag) => !tag.weak && tag.opaque === resource.opaque);
};

const ifNoneMatchHolds = (value: string, resource: Resource): boolean | null => {
  const tags = parseTags(value);
  if (tags === null) return null;
  if (!resource.exists) return true;
  return tags !== "*" && !tags.some((tag) => tag.opaque === resource.opaque);
};

type Target = "GET existing" | "PUT existing" | "PUT missing" | "GET missing";

const success = (target: Target) =>
  target === "GET existing"
    ? 200
    : target === "PUT existing"
      ? 204
      : target === "PUT missing"
        ? 201
        : 404;

/** The statuses the oracle allows; an invalid field may be ignored or count as false. */
const expected = (
  field: "if-match" | "if-none-match",
  value: string,
  target: Target,
  resource: Resource,
) => {
  const read = target.startsWith("GET");
  if (target === "GET missing") return [404];
  if (field === "if-match") {
    const holds = ifMatchHolds(value, resource);
    return holds === true ? [success(target)] : [412];
  }
  const holds = ifNoneMatchHolds(value, resource);
  const failed = read ? 304 : 412;
  if (holds === null) return [success(target), failed];
  return holds ? [success(target)] : [failed];
};

const VALUES: readonly string[] = [
  `"${CURRENT}"`,
  `W/"${CURRENT}"`,
  '"other"',
  'W/"other"',
  '""',
  "*",
  `"other", "${CURRENT}"`,
  `"${CURRENT}", "other"`,
  `W/"${CURRENT}", "other"`,
  `"other", W/"other"`,
  `W/"other", W/"${CURRENT}"`,
  `"${CURRENT}", W/"${CURRENT}"`,
  `"a", "b", "c", "${CURRENT}"`,
  `   "${CURRENT}"   `,
  `"${CURRENT}" , "other"`,
  // §5.6.1 empty list elements, which a recipient ignores.
  `"${CURRENT}",`,
  `, "${CURRENT}"`,
  `,"${CURRENT}"`,
  `"other",, "${CURRENT}"`,
  `"other" , , W/"${CURRENT}"`,
  `, , "${CURRENT}", ,`,
  `"other",,`,
  ",",
  " , , ",
  // Not valid fields.
  CURRENT,
  `"${CURRENT}`,
  `w/"${CURRENT}"`,
  `W/ "${CURRENT}"`,
  `"${CURRENT}" "other"`,
  `*, "${CURRENT}"`,
  `"${CURRENT}"x`,
  `""${CURRENT}""`,
  "**",
  "",
];

const TARGETS: readonly Target[] = ["GET existing", "PUT existing", "PUT missing"];

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

const TABLE = (["if-match", "if-none-match"] as const).flatMap((field) =>
  TARGETS.flatMap((target) => VALUES.map((value) => [field, target, value] as const)),
);

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

  // §13.2.2: the order of evaluation decides which condition answers.
  it.each([
    [
      "If-Match false beats If-None-Match true",
      { "if-match": '"other"', "if-none-match": '"other"' },
      412,
    ],
    [
      "If-Match true, If-None-Match false",
      { "if-match": `"${CURRENT}"`, "if-none-match": `"${CURRENT}"` },
      304,
    ],
    [
      "If-Match true ignores If-Unmodified-Since",
      { "if-match": "*", "if-unmodified-since": "Thu, 01 Jan 1970 00:00:00 GMT" },
      200,
    ],
    [
      "If-Unmodified-Since in the past alone",
      { "if-unmodified-since": "Thu, 01 Jan 1970 00:00:00 GMT" },
      412,
    ],
    [
      "If-Unmodified-Since in the future alone",
      { "if-unmodified-since": "Fri, 01 Jan 2100 00:00:00 GMT" },
      200,
    ],
    [
      "If-Modified-Since in the future",
      { "if-modified-since": "Fri, 01 Jan 2100 00:00:00 GMT" },
      304,
    ],
    [
      "If-Modified-Since in the past",
      { "if-modified-since": "Thu, 01 Jan 1970 00:00:00 GMT" },
      200,
    ],
    [
      "If-None-Match true ignores If-Modified-Since",
      { "if-none-match": '"other"', "if-modified-since": "Fri, 01 Jan 2100 00:00:00 GMT" },
      200,
    ],
    ["an invalid If-Modified-Since is ignored", { "if-modified-since": "not a date" }, 200],
    ["an invalid If-Unmodified-Since is ignored", { "if-unmodified-since": "not a date" }, 200],
  ] as const)("GET: %s", async (_label, headers, status) => {
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
