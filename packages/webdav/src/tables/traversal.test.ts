import { describe, expect, it } from "vitest";
import { REFUSED, refusedByFileStore, type Refuses } from "./names-cases";
import {
  ENTRIES,
  expected,
  OUTSIDE_CONTENT,
  outside,
  PAYLOADS,
  prefixOf,
  requestOf,
  resolve,
  SCOPE,
  TABLE,
} from "./traversal-cases";
import { buildWorld, ORIGIN, snapshotAll } from "./world";

// Path traversal and encoding (PRD §11, §12): the table and oracle of traversal-cases.ts, for a
// Read / Write key limited to /files/photos, against the handler: on a store that keeps every
// valid name, and on one that refuses names as RustFS does on the self-hosted target.

const STORES: readonly (readonly [string, Refuses | undefined])[] = [
  ["a store that keeps every name", undefined],
  ["a store that refuses names as RustFS does", refusedByFileStore],
];

describe("path traversal and encoding", () => {
  it("has 80 or more distinct payloads", () => {
    expect(new Set(PAYLOADS.map(([, payload]) => payload)).size).toBe(PAYLOADS.length);
    expect(PAYLOADS.length).toBeGreaterThanOrEqual(80);
  });

  it("refuses only on a store that refuses the name, where the answer would create it", () => {
    const backslashes = resolve(`${prefixOf(ORIGIN)}..%5cdocs%5csecret.txt`);
    expect(expected("PUT", backslashes)).toEqual([201]);
    expect(expected("PUT", backslashes, refusedByFileStore)).toEqual([201, REFUSED]);
    expect(expected("GET", backslashes, refusedByFileStore)).toEqual([404]);
    const long = resolve(`${prefixOf(ORIGIN)}${"a".repeat(255)}`);
    expect(expected("PUT", long, refusedByFileStore)).toEqual([201]);
    expect(expected("MKCOL", long, refusedByFileStore)).toEqual([201, REFUSED]);
    expect(expected("MKCOL", resolve(`${prefixOf(ORIGIN)}..`), refusedByFileStore)).toEqual([403]);
  });

  describe.each(STORES)("on %s", (_store, refuses) => {
    it.each(TABLE)("%s with %s", async (entry, _label, payload) => {
      const world = await buildWorld({ scope: [SCOPE], access: "read-write", refuses });
      const request = requestOf(entry, payload, ORIGIN);
      const resolved = resolve(`${prefixOf(ORIGIN)}${payload}`);
      const before = await snapshotAll(world);
      const handlerRequest = new Request(request.url, { method: request.method, ...request.init });
      const response = await world.handler(handlerRequest);
      const text = await response.text();
      const allowed = expected(entry, resolved, refuses);
      expect(allowed).toContain(response.status);
      // This store refuses whatever the oracle lets it refuse, so the refusal is seen to happen.
      if (allowed.length > expected(entry, resolved).length) expect(response.status).toBe(REFUSED);
      // Nothing outside the scope is read: no content and no name of a file outside it.
      for (const content of OUTSIDE_CONTENT) expect(text).not.toContain(content);
      expect(text).not.toContain("secret.txt");
      // Nothing outside the scope changes.
      const after = await snapshotAll(world);
      expect(outside(after)).toEqual(outside(before));
      if (response.status >= 400) expect(after).toEqual(before);
    });
  });
});

// What the oracle answers for each payload, written out: where the payload resolves to (RFC 3986
// §5.2.4 and the WHATWG URL parser, then the namespace's name rules) and the statuses each entry
// point may answer, on a store that keeps every name and, after "|", on one that refuses names as
// RustFS does where that differs. A change to a payload or to the oracle that moves an answer
// fails here, not only in the comparison with the handler.
const short = (text: string) =>
  text.length > 40 ? `${text.slice(0, 12)}…(${text.length} characters)` : text;

const where = (resolved: ReturnType<typeof resolve>) =>
  resolved.kind === "path" ? `/${short(resolved.names.join("/"))}` : resolved.kind;

const statuses = (resolved: ReturnType<typeof resolve>, refuses?: Refuses) =>
  ENTRIES.map((entry) => `${entry} ${expected(entry, resolved, refuses).join("/")}`).join(", ");

describe("the oracle's answers, written out", () => {
  it("resolves each payload and allows these statuses", () => {
    expect(
      PAYLOADS.map(([label, payload]) => {
        const resolved = resolve(`${prefixOf(ORIGIN)}${payload}`);
        const plain = statuses(resolved);
        const refusing = statuses(resolved, refusedByFileStore);
        return `${label}: ${short(payload)} -> ${where(resolved)}: ${plain}${refusing === plain ? "" : ` | ${refusing}`}`;
      }),
    ).toMatchInlineSnapshot(`
      [
        "parent segment: .. -> /files: GET 403, PUT 403, MKCOL 403, DELETE 403, PROPFIND 207, COPY 403, MOVE 403, If 412",
        "parent then sibling file: ../docs/secret.txt -> /files/docs/secret.txt: GET 403, PUT 403, MKCOL 403, DELETE 403, PROPFIND 403, COPY 403, MOVE 403, If 412",
        "encoded dots: %2e%2e/docs/secret.txt -> /files/docs/secret.txt: GET 403, PUT 403, MKCOL 403, DELETE 403, PROPFIND 403, COPY 403, MOVE 403, If 412",
        "encoded dots, upper case: %2E%2E/docs/secret.txt -> /files/docs/secret.txt: GET 403, PUT 403, MKCOL 403, DELETE 403, PROPFIND 403, COPY 403, MOVE 403, If 412",
        "encoded dots, mixed case: %2E%2e/docs/secret.txt -> /files/docs/secret.txt: GET 403, PUT 403, MKCOL 403, DELETE 403, PROPFIND 403, COPY 403, MOVE 403, If 412",
        "one dot encoded, first: %2e./docs/secret.txt -> /files/docs/secret.txt: GET 403, PUT 403, MKCOL 403, DELETE 403, PROPFIND 403, COPY 403, MOVE 403, If 412",
        "one dot encoded, second: .%2E/docs/secret.txt -> /files/docs/secret.txt: GET 403, PUT 403, MKCOL 403, DELETE 403, PROPFIND 403, COPY 403, MOVE 403, If 412",
        "two parents to the namespace root: ../../media/music/c.mp3 -> /media/music/c.mp3: GET 403, PUT 403, MKCOL 403, DELETE 403, PROPFIND 403, COPY 403, MOVE 403, If 412",
        "parents past the base path: ../../../etc/passwd -> foreign: GET 404, PUT 404, MKCOL 404, DELETE 404, PROPFIND 404, COPY 502/403, MOVE 502/403, If 412",
        "parents far past the URL root: ../../../../../../../../etc/passwd -> foreign: GET 404, PUT 404, MKCOL 404, DELETE 404, PROPFIND 404, COPY 502/403, MOVE 502/403, If 412",
        "parents back into the base path: ../../../dav/files/docs/secret.txt -> /files/docs/secret.txt: GET 403, PUT 403, MKCOL 403, DELETE 403, PROPFIND 403, COPY 403, MOVE 403, If 412",
        "parent into a name-prefix neighbour: ../photos2/z.txt -> /files/photos2/z.txt: GET 403, PUT 403, MKCOL 403, DELETE 403, PROPFIND 403, COPY 403, MOVE 403, If 412",
        "parent and back into the scope: ../photos/a.jpg -> /files/photos/a.jpg: GET 200, PUT 204, MKCOL 405, DELETE 204, PROPFIND 207, COPY 403, MOVE 403, If 204",
        "double-encoded dots: %252e%252e/docs/secret.txt -> /files/photos/%2e%2e/docs/secret.txt: GET 404, PUT 409, MKCOL 409, DELETE 404, PROPFIND 404, COPY 409, MOVE 409, If 204",
        "double-encoded dots and slashes: %252e%252e%252fdocs%252fsecret.txt -> /files/photos/%2e%2e%2fdocs%2fsecret.txt: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "double-encoded with percent split: %%32%65%%32%65/docs/secret.txt -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "encoded slash in a name: ..%2fdocs%2fsecret.txt -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "encoded slash, upper case: ..%2Fdocs%2Fsecret.txt -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "fully encoded parent and slash: %2e%2e%2fdocs%2fsecret.txt -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "encoded slashes to /etc: ..%2f..%2f..%2fetc%2fpasswd -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "double-encoded slash: ..%252f..%252fdocs -> /files/photos/..%2f..%2fdocs: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "backslashes: ..\\docs\\secret.txt -> /files/docs/secret.txt: GET 403, PUT 403, MKCOL 403, DELETE 403, PROPFIND 403, COPY 403, MOVE 403, If 412",
        "backslash before the parent: \\..\\docs\\secret.txt -> /files/photos/docs/secret.txt: GET 404, PUT 409, MKCOL 409, DELETE 404, PROPFIND 404, COPY 409, MOVE 409, If 204",
        "encoded backslashes: ..%5cdocs%5csecret.txt -> /files/photos/..\\docs\\secret.txt: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204 | GET 404, PUT 201/403, MKCOL 201/403, DELETE 404, PROPFIND 404, COPY 201/403, MOVE 201/403, If 204",
        "encoded backslash, upper case: %5C..%5Cdocs -> /files/photos/\\..\\docs: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204 | GET 404, PUT 201/403, MKCOL 201/403, DELETE 404, PROPFIND 404, COPY 201/403, MOVE 201/403, If 204",
        "encoded dots and backslashes: %2e%2e%5c%2e%2e%5c -> /files/photos/..\\..\\: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204 | GET 404, PUT 201/403, MKCOL 201/403, DELETE 404, PROPFIND 404, COPY 201/403, MOVE 201/403, If 204",
        "NUL alone: %00 -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "NUL after a name: a.jpg%00 -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "NUL inside a name: a.jpg%00.txt -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "NUL after the parent: ..%00/docs/secret.txt -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "NUL between dots: .%00. -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "overlong two-byte dots: %c0%ae%c0%ae/docs/secret.txt -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "overlong two-byte slash: ..%c0%afdocs -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "overlong three-byte dots: %e0%80%ae%e0%80%ae/docs -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "overlong backslash: ..%c1%9cdocs -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "overlong NUL: a%C0%80b -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "UTF-8 surrogate: %ed%a0%80 -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "invalid UTF-8 byte: %ff -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "lone percent: % -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "percent with no hex: %zz -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "truncated escape: %2 -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "IIS %u escape of dots: %u002e%u002e/docs -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "IIS %u escape of a slash: ..%u2215docs -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "current segment: ./a.jpg -> /files/photos/a.jpg: GET 200, PUT 204, MKCOL 405, DELETE 204, PROPFIND 207, COPY 403, MOVE 403, If 204",
        "encoded current segment: %2e/a.jpg -> /files/photos/a.jpg: GET 200, PUT 204, MKCOL 405, DELETE 204, PROPFIND 207, COPY 403, MOVE 403, If 204",
        "current segment alone: . -> /files/photos: GET 405, PUT 405, MKCOL 405, DELETE 204, PROPFIND 207, COPY 403, MOVE 403, If 204",
        "encoded current segment alone: %2e -> /files/photos: GET 405, PUT 405, MKCOL 405, DELETE 204, PROPFIND 207, COPY 403, MOVE 403, If 204",
        "three dots: ... -> /files/photos/...: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "four dots with doubled slashes: ....//....//docs -> /files/photos/..../..../docs: GET 404, PUT 409, MKCOL 409, DELETE 404, PROPFIND 404, COPY 409, MOVE 409, If 204",
        "trailing dot: a.jpg. -> /files/photos/a.jpg.: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "two trailing dots: a.jpg.. -> /files/photos/a.jpg..: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "trailing space: a.jpg%20 -> /files/photos/a.jpg : GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "parent with a trailing space: ..%20/docs/secret.txt -> /files/photos/.. /docs/secret.txt: GET 404, PUT 409, MKCOL 409, DELETE 404, PROPFIND 404, COPY 409, MOVE 409, If 204",
        "parent with a leading space: %20../docs -> /files/photos/ ../docs: GET 404, PUT 409, MKCOL 409, DELETE 404, PROPFIND 404, COPY 409, MOVE 409, If 204",
        "Tomcat path parameter: ..;/docs/secret.txt -> /files/photos/..;/docs/secret.txt: GET 404, PUT 409, MKCOL 409, DELETE 404, PROPFIND 404, COPY 409, MOVE 409, If 204",
        "path parameter before the parent: ;/../docs/secret.txt -> /files/photos/docs/secret.txt: GET 404, PUT 409, MKCOL 409, DELETE 404, PROPFIND 404, COPY 409, MOVE 409, If 204",
        "encoded semicolon: ..%3b/docs -> /files/photos/..;/docs: GET 404, PUT 409, MKCOL 409, DELETE 404, PROPFIND 404, COPY 409, MOVE 409, If 204",
        "fullwidth full stops: %EF%BC%8E%EF%BC%8E/docs/secret.txt -> /files/photos/．．/docs/secret.txt: GET 404, PUT 409, MKCOL 409, DELETE 404, PROPFIND 404, COPY 409, MOVE 409, If 204",
        "one dot leaders: %E2%80%A4%E2%80%A4/docs -> /files/photos/․․/docs: GET 404, PUT 409, MKCOL 409, DELETE 404, PROPFIND 404, COPY 409, MOVE 409, If 204",
        "division slash: ..%E2%88%95docs -> /files/photos/..∕docs: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "fullwidth solidus: ..%EF%BC%8Fdocs -> /files/photos/..／docs: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "fraction slash: ..%E2%81%84docs -> /files/photos/..⁄docs: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "byte order mark before the parent: %EF%BB%BF.. -> /files/photos/﻿..: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "zero-width space after the parent: ..%E2%80%8B -> /files/photos/..​: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "right-to-left override: %E2%80%AEgpj.a -> /files/photos/‮gpj.a: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "decomposed accent: e%CC%81.txt -> /files/photos/é.txt: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "line separator: a%E2%80%A8b -> /files/photos/a b: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "CR LF in a name: a%0d%0ab -> /files/photos/a
      b: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204 | GET 404, PUT 201/403, MKCOL 201/403, DELETE 404, PROPFIND 404, COPY 201/403, MOVE 201/403, If 204",
        "tab and DEL: a%09%7fb -> /files/photos/a	b: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "encoded question mark: a%3fb -> /files/photos/a?b: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "encoded number sign: a%23b -> /files/photos/a#b: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "query that names a parent: ?x=../../docs/secret.txt -> /files/photos: GET 405, PUT 405, MKCOL 405, DELETE 204, PROPFIND 207, COPY 403, MOVE 403, If 204",
        "fragment that names a parent: #../../docs/secret.txt -> /files/photos: GET 405, PUT 405, MKCOL 405, DELETE 204, PROPFIND 207, COPY 403, MOVE 403, If 204",
        "query after a name: a.jpg?/../../docs/secret.txt -> /files/photos/a.jpg: GET 200, PUT 204, MKCOL 405, DELETE 204, PROPFIND 207, COPY 403, MOVE 403, If 204",
        "Windows device name: CON -> /files/photos/CON: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "NTFS alternate stream: a.jpg::$DATA -> /files/photos/a.jpg::$DATA: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "tilde short name: PHOTOS~1 -> /files/photos/PHOTOS~1: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "empty segments: //sub//b.jpg -> /files/photos/sub/b.jpg: GET 200, PUT 204, MKCOL 405, DELETE 204, PROPFIND 207, COPY 204, MOVE 204, If 204",
        "empty segments around a parent: /../docs/secret.txt -> /files/photos/docs/secret.txt: GET 404, PUT 409, MKCOL 409, DELETE 404, PROPFIND 404, COPY 409, MOVE 409, If 204",
        "the scope root again: photos -> /files/photos/photos: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "parents back to the bare base path: ../../../dav -> /: GET 403, PUT 403, MKCOL 403, DELETE 403, PROPFIND 207, COPY 403, MOVE 403, If 412",
        "a collection inside the scope: sub -> /files/photos/sub: GET 405, PUT 405, MKCOL 405, DELETE 204, PROPFIND 207, COPY 204, MOVE 204, If 204",
        "a new file in a collection inside the scope: sub/new.txt -> /files/photos/sub/new.txt: GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "a name below a file: a.jpg/below.txt -> /files/photos/a.jpg/below.txt: GET 404, PUT 409, MKCOL 409, DELETE 404, PROPFIND 404, COPY 403/409, MOVE 403/409, If 204",
        "a name of 255 bytes: aaaaaaaaaaaa…(255 characters) -> /files/photos…(268 characters): GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204 | GET 404, PUT 201, MKCOL 201/403, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "a name of 256 bytes: aaaaaaaaaaaa…(256 characters) -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "a name of 254 bytes in two-byte characters: %C3%A9%C3%A9…(762 characters) -> /files/photos…(140 characters): GET 404, PUT 201, MKCOL 201, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204 | GET 404, PUT 201, MKCOL 201/403, DELETE 404, PROPFIND 404, COPY 201, MOVE 201, If 204",
        "a name of 256 bytes in two-byte characters: %C3%A9%C3%A9…(768 characters) -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "a path of exactly 900 bytes: abcd/abcd/ab…(886 characters) -> /files/photos…(899 characters): GET 404, PUT 409, MKCOL 409, DELETE 404, PROPFIND 404, COPY 409, MOVE 409, If 204",
        "a path of 901 bytes: abcd/abcd/ab…(887 characters) -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "a path of more than 900 bytes: abcd/abcd/ab…(1000 characters) -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "a path of more than 450 names: a/a/a/a/a/a/…(920 characters) -> invalid: GET 400, PUT 400, MKCOL 400, DELETE 400, PROPFIND 400, COPY 400, MOVE 400, If 412",
        "a deep path under a missing folder: x/x/x/x/x/x/…(60 characters) -> /files/photos…(72 characters): GET 404, PUT 409, MKCOL 409, DELETE 404, PROPFIND 404, COPY 409, MOVE 409, If 204",
      ]
    `);
  });

  it("sends each entry point's request", () => {
    expect(
      ENTRIES.map((entry) => {
        const { method, url, init } = requestOf(entry, "x/y", ORIGIN);
        return `${entry}: ${method} ${url} ${JSON.stringify(init)}`;
      }),
    ).toMatchInlineSnapshot(`
      [
        "GET: GET https://dav.example/dav/files/photos/x/y {}",
        "PUT: PUT https://dav.example/dav/files/photos/x/y {"body":"planted"}",
        "MKCOL: MKCOL https://dav.example/dav/files/photos/x/y {}",
        "DELETE: DELETE https://dav.example/dav/files/photos/x/y {}",
        "PROPFIND: PROPFIND https://dav.example/dav/files/photos/x/y {"headers":{"depth":"0"}}",
        "COPY: COPY https://dav.example/dav/files/photos/a.jpg {"headers":{"destination":"https://dav.example/dav/files/photos/x/y"}}",
        "MOVE: MOVE https://dav.example/dav/files/photos/a.jpg {"headers":{"destination":"https://dav.example/dav/files/photos/x/y"}}",
        "If: PUT https://dav.example/dav/files/photos/a.jpg {"body":"planted","headers":{"if":"<https://dav.example/dav/files/photos/x/y> (Not [\\"no-such-tag\\"])"}}",
      ]
    `);
  });

  it("knows the content outside the scope and the entries outside it", () => {
    expect(OUTSIDE_CONTENT).toEqual(["top-secret-content", "neighbour-content", "music-c-content"]);
    expect(
      outside({
        "files/photos/": "c",
        "files/photos/a.jpg": "f",
        "files/photos2/": "c",
        "files/docs/secret.txt": "f",
        "media/": "c",
      }),
    ).toEqual([
      ["files/photos2/", "c"],
      ["files/docs/secret.txt", "f"],
      ["media/", "c"],
    ]);
    expect(SCOPE).toEqual(["files", "photos"]);
    expect(prefixOf("https://h.example")).toBe("https://h.example/dav/files/photos/");
  });
});
