// The If header (RFC 4918 §10.4). The oracle is a reader of the grammar of §10.4.2 written here,
// with the implied LWS of RFC 4918: If = 1*No-tag-list / 1*Tagged-list, List = "(" 1*Condition ")",
// Condition = ["Not"] (Coded-URL / "[" entity-tag "]"), Resource-Tag = "<" Simple-ref ">". A list
// is true when every condition is; the header when any list is (§10.4.3). A state token holds when
// it names a lock on the resource, an entity tag when it is the resource's current one (§10.4.4). A
// malformed header is 400; a false one 412 (§10.4.1). A locked resource needs its lock token
// submitted, and a token is submitted when it appears in a header that evaluates to true (§10.4.1).
// if-header.test.ts runs the table in process, and
// tests/integration/compat/http/protocol-tables.test.ts over HTTP.

export const LOCK_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>';

const UNKNOWN = "urn:uuid:11111111-1111-4111-8111-111111111111";

interface Condition {
  readonly not: boolean;
  readonly kind: "token" | "etag";
  readonly value: string;
}
interface List {
  readonly resource: string | null;
  readonly conditions: readonly Condition[];
}

const ABSOLUTE_URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]*$/;
const ENTITY_TAG = /^(W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/;

/** §10.4.2; null when the header is malformed. */
const parseIf = (header: string): List[] | null => {
  let rest = header;
  const lws = () => {
    rest = rest.replace(/^[ \t]*/, "");
  };
  const lists: List[] = [];
  let tagged: boolean | null = null;
  let resource: string | null = null;
  lws();
  while (rest !== "") {
    if (rest.startsWith("<")) {
      if (tagged === false) return null;
      tagged = true;
      const end = rest.indexOf(">");
      if (end === -1) return null;
      resource = rest.slice(1, end);
      rest = rest.slice(end + 1);
      lws();
      if (!rest.startsWith("(")) return null;
      continue;
    }
    if (!rest.startsWith("(")) return null;
    tagged ??= false;
    rest = rest.slice(1);
    const conditions: Condition[] = [];
    for (;;) {
      lws();
      if (rest.startsWith(")")) break;
      const not = /^not/i.test(rest);
      if (not) {
        rest = rest.slice(3);
        lws();
      }
      if (rest.startsWith("<")) {
        const end = rest.indexOf(">");
        const value = end === -1 ? "" : rest.slice(1, end);
        if (!ABSOLUTE_URI.test(value)) return null;
        conditions.push({ not, kind: "token", value });
        rest = rest.slice(end + 1);
      } else if (rest.startsWith("[")) {
        const end = rest.indexOf("]");
        const value = end === -1 ? "" : rest.slice(1, end).trim();
        if (!ENTITY_TAG.test(value)) return null;
        conditions.push({ not, kind: "etag", value });
        rest = rest.slice(end + 1);
      } else {
        return null;
      }
    }
    rest = rest.slice(1);
    if (conditions.length === 0) return null;
    lists.push({ resource: tagged ? resource : null, conditions });
    lws();
  }
  return lists.length > 0 ? lists : null;
};

export interface State {
  readonly locks: ReadonlySet<string>;
  readonly etag: string | null;
}

export type Outcome = "malformed" | "false" | "true, token submitted" | "true, no token";

/**
 * Whether the header holds for a PUT of `target` in a world at `root`, the absolute URL of the
 * folder `target` names a file of.
 */
export const evaluate = (
  header: string,
  target: string,
  states: Readonly<Record<string, State>>,
  lockToken: string,
  root: string,
): Outcome => {
  const { origin, pathname: basePath } = new URL(root);
  const lists = parseIf(header);
  if (lists === null) return "malformed";
  const holds = lists.some((list) => {
    let state: State | undefined = states[target];
    if (list.resource !== null) {
      const url = new URL(list.resource, `${root}${target}`);
      state = url.origin === origin ? states[url.pathname.slice(basePath.length)] : undefined;
    }
    return list.conditions.every((condition) => {
      const matches =
        state !== undefined &&
        (condition.kind === "token"
          ? state.locks.has(condition.value)
          : state.etag !== null && condition.value === `"${state.etag}"`);
      return matches !== condition.not;
    });
  });
  if (!holds) return "false";
  const submitted = lists.some((list) =>
    list.conditions.some((c) => c.kind === "token" && c.value === lockToken),
  );
  return submitted ? "true, token submitted" : "true, no token";
};

const ATOMS: readonly string[] = [
  "<@T>",
  `<${UNKNOWN}>`,
  "Not <@T>",
  `Not <${UNKNOWN}>`,
  '["@A"]',
  '["wrong"]',
  'Not ["@A"]',
  'Not ["wrong"]',
  "<DAV:no-lock>",
  "Not <DAV:no-lock>",
];

const pairs = <T>(items: readonly T[]) =>
  items.flatMap((a, i) => items.slice(i + 1).map((b) => [a, b] as const));

export const CASES: readonly (readonly [target: "/a.txt" | "/b.txt", header: string])[] = [
  ...ATOMS.map((atom) => ["/a.txt", `(${atom})`] as const),
  ...ATOMS.map((atom) => ["/b.txt", `(${atom.replace("@A", "@B")})`] as const),
  ...pairs(ATOMS).map(([a, b]) => ["/a.txt", `(${a} ${b})`] as const),
  ...pairs(ATOMS).map(([a, b]) => ["/a.txt", `(${a}) (${b})`] as const),
  // Tagged lists.
  ["/a.txt", "<@URL/a.txt> (<@T>)"],
  ["/a.txt", '<@URL/a.txt> (["@A"])'],
  ["/a.txt", '<@URL/b.txt> (["@B"])'],
  ["/a.txt", '<@URL/b.txt> (["@B"]) <@URL/a.txt> (<@T>)'],
  ["/a.txt", '<@URL/a.txt> (["wrong"]) <@URL/b.txt> (["@B"])'],
  ["/a.txt", "<@URL/b.txt> (<@T>)"],
  ["/a.txt", "<https://other.example/dav/a.txt> (<@T>)"],
  ["/a.txt", "<@PATH/a.txt> (<@T>)"],
  ["/a.txt", '<@URL/a.txt> (<@T>) (["@A"])'],
  ["/a.txt", '<@URL/missing.txt> (Not ["wrong"])'],
  ["/b.txt", '<@URL/b.txt> (["@B"])'],
  ["/b.txt", '<@URL/a.txt> (["@A"])'],
  // Spacing and case.
  ["/a.txt", "(not <@T>)"],
  ["/a.txt", "(NOT <@T>) (<@T>)"],
  ["/a.txt", '(<@T>)(["@A"])'],
  ["/a.txt", "   (<@T>)   "],
  ["/a.txt", "(\t<@T>\t)"],
  ["/a.txt", "(Not<@T>) (<@T>)"],
  // Malformed.
  ["/a.txt", "<@T>"],
  ["/a.txt", "("],
  ["/a.txt", "()"],
  ["/a.txt", "(<@T>"],
  ["/a.txt", '["@A"]'],
  ["/a.txt", "(Not)"],
  ["/a.txt", "(Nott <@T>)"],
  ["/a.txt", "(<@T>) <@URL/a.txt> (<@T>)"],
  ["/a.txt", "<@URL/a.txt>"],
  ["/a.txt", "<@URL/a.txt> <@URL/b.txt> (<@T>)"],
  ["/a.txt", "(<@T>) x"],
  ["/a.txt", "(<@T> [)"],
  ["/a.txt", '(["@A")'],
  ["/a.txt", "(<@T)"],
  ["/a.txt", "@T"],
  ["/a.txt", "(@T)"],
];

/** Not valid by the grammar, but a server may read them and find them false; both refuse it. */
export const LENIENT: readonly string[] = [
  "(<not a uri>)",
  "(<>)",
  "([@A])",
  "([W/@A])",
  "(<@T> [@A])",
];

export const STATUS: Readonly<Record<Outcome, number>> = {
  malformed: 400,
  false: 412,
  "true, token submitted": 204,
  "true, no token": 423,
};

/** The status of a PUT of `target`; an unlocked resource needs no token. */
export const statusOf = (target: string, outcome: Outcome) =>
  target === "/b.txt" && outcome === "true, no token" ? 204 : STATUS[outcome];

export interface Fill {
  /** The absolute URL of the world's folder, and its path. */
  readonly root: string;
  readonly token: string;
  readonly etagA: string;
  readonly etagB: string;
}

/** A template of CASES or LENIENT with the world's URLs, lock token and entity tags. */
export const fillHeader = (template: string, fill: Fill) =>
  template
    .replaceAll("@URL", fill.root)
    .replaceAll("@PATH", new URL(fill.root).pathname)
    .replaceAll("@T", fill.token)
    .replaceAll("@A", fill.etagA)
    .replaceAll("@B", fill.etagB);

/** The world's resources: /a.txt is locked with `token`, /b.txt is not, /missing.txt is missing. */
export const statesOf = ({ token, etagA, etagB }: Omit<Fill, "root">): Record<string, State> => ({
  "/a.txt": { locks: new Set([token]), etag: etagA },
  "/b.txt": { locks: new Set(), etag: etagB },
  "/missing.txt": { locks: new Set(), etag: null },
});
