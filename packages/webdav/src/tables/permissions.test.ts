import { describe, expect, it } from "vitest";
import {
  ACCESS,
  destinationFor,
  expectationOf,
  LOCK_BODY,
  METHODS,
  namesOf,
  PROPPATCH_BODY,
  relation,
  RELATIONS,
  requestFor,
  ROWS,
  SCOPES,
  STATES,
} from "./permission-oracle";
import { buildWorld, snapshotAll } from "./world";

// The exhaustive permission table of PRD §11 (permission-oracle.ts), each case through the real
// handler and the proven policy, on memory backends.

const TABLE = ROWS.map(
  (row) => [row.access, row.scope.name, row.method, row.relation, row.state, row] as const,
);

describe("the permission table", () => {
  it("names each target relation correctly for every scoped key", () => {
    for (const scope of SCOPES.filter((s) => s.roots !== null)) {
      expect(relation(namesOf(scope.targets.root), scope.roots)).toBe("above");
      expect(relation(namesOf(scope.targets.above), scope.roots)).toBe("above");
      expect(relation(namesOf(scope.targets.inside), scope.roots)).toBe("inside");
      expect(relation(namesOf(scope.targets.outside), scope.roots)).toBe("outside");
      expect(relation(namesOf(scope.targets["missing inside"]), scope.roots)).toBe("inside");
    }
  });

  it.each(TABLE)(
    "%s key, %s, %s on the %s target, Mount %s",
    async (_access, _scope, _method, _relation, _state, row) => {
      const expected = expectationOf(row);
      const world = await buildWorld({
        files: row.state,
        scope: row.scope.roots,
        access: row.access,
      });
      const before = await snapshotAll(world);
      const response = await world.call(
        row.method,
        expected.url,
        requestFor(row.method, expected.target),
      );
      await response.body?.cancel();
      expect(expected.statuses).toContain(response.status);
      if (!expected.permitted) {
        // A refused request changes nothing: no file, property or lock.
        expect(await snapshotAll(world)).toEqual(before);
        expect(
          await world.locks.covering([], { descendants: true, now: Date.UTC(2026, 10, 2) }),
        ).toEqual([]);
      }
    },
  );
});

// The oracle, written out (PRD §6, §11; RFC 4918; RFC 9110): for each scope, method and target,
// the URL it names and the statuses allowed to a Read Only key and then a Read / Write key, each
// with the files Mount existing, unavailable and missing in turn ("-" for a 403 refusal by the
// policy). A change to the table or to the oracle that moves an answer fails here, not only in the
// comparison with the handler.
describe("the permission oracle, written out", () => {
  it("allows these statuses", () => {
    const rows = new Map<string, string>();
    for (const row of ROWS) {
      const { url, permitted, statuses } = expectationOf(row);
      const key = `${row.scope.name}, ${row.method} ${row.relation} (${JSON.stringify(url)})`;
      const access = row.access === "read-only" ? "ro" : "; rw";
      const answer = permitted ? statuses.join("/") : "-";
      rows.set(key, `${rows.get(key) ?? ""}${row.state === "exists" ? access : ""} ${answer}`);
    }
    expect([...rows].map(([key, answers]) => `${key}: ${answers}`)).toMatchInlineSnapshot(`
      [
        "no scope, OPTIONS root ("/"): ro 200 200 200; rw 200 200 200",
        "no scope, OPTIONS above ("/files"): ro 200 200 200; rw 200 200 200",
        "no scope, OPTIONS inside ("/files/photos/a.jpg"): ro 200 200 200; rw 200 200 200",
        "no scope, OPTIONS outside ("/media/music/c.mp3"): ro 200 200 200; rw 200 200 200",
        "no scope, OPTIONS missing inside ("/files/photos/missing.txt"): ro 200 200 200; rw 200 200 200",
        "no scope, GET root ("/"): ro 405 405 405; rw 405 405 405",
        "no scope, GET above ("/files"): ro 405 405/503 404; rw 405 405/503 404",
        "no scope, GET inside ("/files/photos/a.jpg"): ro 200 503 404; rw 200 503 404",
        "no scope, GET outside ("/media/music/c.mp3"): ro 200 200 200; rw 200 200 200",
        "no scope, GET missing inside ("/files/photos/missing.txt"): ro 404 503 404; rw 404 503 404",
        "no scope, HEAD root ("/"): ro 405 405 405; rw 405 405 405",
        "no scope, HEAD above ("/files"): ro 405 405/503 404; rw 405 405/503 404",
        "no scope, HEAD inside ("/files/photos/a.jpg"): ro 200 503 404; rw 200 503 404",
        "no scope, HEAD outside ("/media/music/c.mp3"): ro 200 200 200; rw 200 200 200",
        "no scope, HEAD missing inside ("/files/photos/missing.txt"): ro 404 503 404; rw 404 503 404",
        "no scope, PROPFIND root ("/"): ro 207 207 207; rw 207 207 207",
        "no scope, PROPFIND above ("/files"): ro 207 503 404; rw 207 503 404",
        "no scope, PROPFIND inside ("/files/photos/a.jpg"): ro 207 503 404; rw 207 503 404",
        "no scope, PROPFIND outside ("/media/music/c.mp3"): ro 207 207 207; rw 207 207 207",
        "no scope, PROPFIND missing inside ("/files/photos/missing.txt"): ro 404 503 404; rw 404 503 404",
        "no scope, PUT root ("/"): ro - - -; rw 405 405 405",
        "no scope, PUT above ("/files"): ro - - -; rw 405 405/503 403",
        "no scope, PUT inside ("/files/photos/a.jpg"): ro - - -; rw 204 503 409",
        "no scope, PUT outside ("/media/music/c.mp3"): ro - - -; rw 204 204 204",
        "no scope, PUT missing inside ("/files/photos/missing.txt"): ro - - -; rw 201 503 409",
        "no scope, MKCOL root ("/"): ro - - -; rw 405 405 405",
        "no scope, MKCOL above ("/files"): ro - - -; rw 405 405 403",
        "no scope, MKCOL inside ("/files/photos/a.jpg"): ro - - -; rw 405 503 409",
        "no scope, MKCOL outside ("/media/music/c.mp3"): ro - - -; rw 405 405 405",
        "no scope, MKCOL missing inside ("/files/photos/missing.txt"): ro - - -; rw 201 503 409",
        "no scope, DELETE root ("/"): ro - - -; rw 403 403 403",
        "no scope, DELETE above ("/files"): ro - - -; rw 403 403/503 404",
        "no scope, DELETE inside ("/files/photos/a.jpg"): ro - - -; rw 204 503 404",
        "no scope, DELETE outside ("/media/music/c.mp3"): ro - - -; rw 204 204 204",
        "no scope, DELETE missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "no scope, PROPPATCH root ("/"): ro - - -; rw 403/207 403/207 403/207",
        "no scope, PROPPATCH above ("/files"): ro - - -; rw 207 207/503 404",
        "no scope, PROPPATCH inside ("/files/photos/a.jpg"): ro - - -; rw 207 503 404",
        "no scope, PROPPATCH outside ("/media/music/c.mp3"): ro - - -; rw 207 207 207",
        "no scope, PROPPATCH missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "no scope, COPY root ("/"): ro - - -; rw 403 403 403",
        "no scope, COPY above ("/files"): ro - - -; rw 403 403/503 404",
        "no scope, COPY inside ("/files/photos/a.jpg"): ro - - -; rw 201 503 404",
        "no scope, COPY outside ("/media/music/c.mp3"): ro - - -; rw 201 201 201",
        "no scope, COPY missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "no scope, MOVE root ("/"): ro - - -; rw 403 403 403",
        "no scope, MOVE above ("/files"): ro - - -; rw 403 403/503 404",
        "no scope, MOVE inside ("/files/photos/a.jpg"): ro - - -; rw 201 503 404",
        "no scope, MOVE outside ("/media/music/c.mp3"): ro - - -; rw 201 201 201",
        "no scope, MOVE missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "no scope, LOCK root ("/"): ro - - -; rw 200 200 200",
        "no scope, LOCK above ("/files"): ro - - -; rw 200 200/503 403",
        "no scope, LOCK inside ("/files/photos/a.jpg"): ro - - -; rw 200 503 409",
        "no scope, LOCK outside ("/media/music/c.mp3"): ro - - -; rw 200 200 200",
        "no scope, LOCK missing inside ("/files/photos/missing.txt"): ro - - -; rw 201 503 409",
        "no scope, UNLOCK root ("/"): ro - - -; rw 409 409 409",
        "no scope, UNLOCK above ("/files"): ro - - -; rw 409 409 409",
        "no scope, UNLOCK inside ("/files/photos/a.jpg"): ro - - -; rw 409 409 409",
        "no scope, UNLOCK outside ("/media/music/c.mp3"): ro - - -; rw 409 409 409",
        "no scope, UNLOCK missing inside ("/files/photos/missing.txt"): ro - - -; rw 409 409 409",
        "a Mount, OPTIONS root ("/"): ro 200 200 200; rw 200 200 200",
        "a Mount, OPTIONS above (""): ro 200 200 200; rw 200 200 200",
        "a Mount, OPTIONS inside ("/files/photos/a.jpg"): ro 200 200 200; rw 200 200 200",
        "a Mount, OPTIONS outside ("/media/music/c.mp3"): ro - - -; rw - - -",
        "a Mount, OPTIONS missing inside ("/files/photos/missing.txt"): ro 200 200 200; rw 200 200 200",
        "a Mount, GET root ("/"): ro - - -; rw - - -",
        "a Mount, GET above (""): ro - - -; rw - - -",
        "a Mount, GET inside ("/files/photos/a.jpg"): ro 200 503 404; rw 200 503 404",
        "a Mount, GET outside ("/media/music/c.mp3"): ro - - -; rw - - -",
        "a Mount, GET missing inside ("/files/photos/missing.txt"): ro 404 503 404; rw 404 503 404",
        "a Mount, HEAD root ("/"): ro - - -; rw - - -",
        "a Mount, HEAD above (""): ro - - -; rw - - -",
        "a Mount, HEAD inside ("/files/photos/a.jpg"): ro 200 503 404; rw 200 503 404",
        "a Mount, HEAD outside ("/media/music/c.mp3"): ro - - -; rw - - -",
        "a Mount, HEAD missing inside ("/files/photos/missing.txt"): ro 404 503 404; rw 404 503 404",
        "a Mount, PROPFIND root ("/"): ro 207 207 207; rw 207 207 207",
        "a Mount, PROPFIND above (""): ro 207 207 207; rw 207 207 207",
        "a Mount, PROPFIND inside ("/files/photos/a.jpg"): ro 207 503 404; rw 207 503 404",
        "a Mount, PROPFIND outside ("/media/music/c.mp3"): ro - - -; rw - - -",
        "a Mount, PROPFIND missing inside ("/files/photos/missing.txt"): ro 404 503 404; rw 404 503 404",
        "a Mount, PUT root ("/"): ro - - -; rw - - -",
        "a Mount, PUT above (""): ro - - -; rw - - -",
        "a Mount, PUT inside ("/files/photos/a.jpg"): ro - - -; rw 204 503 409",
        "a Mount, PUT outside ("/media/music/c.mp3"): ro - - -; rw - - -",
        "a Mount, PUT missing inside ("/files/photos/missing.txt"): ro - - -; rw 201 503 409",
        "a Mount, MKCOL root ("/"): ro - - -; rw - - -",
        "a Mount, MKCOL above (""): ro - - -; rw - - -",
        "a Mount, MKCOL inside ("/files/photos/a.jpg"): ro - - -; rw 405 503 409",
        "a Mount, MKCOL outside ("/media/music/c.mp3"): ro - - -; rw - - -",
        "a Mount, MKCOL missing inside ("/files/photos/missing.txt"): ro - - -; rw 201 503 409",
        "a Mount, DELETE root ("/"): ro - - -; rw - - -",
        "a Mount, DELETE above (""): ro - - -; rw - - -",
        "a Mount, DELETE inside ("/files/photos/a.jpg"): ro - - -; rw 204 503 404",
        "a Mount, DELETE outside ("/media/music/c.mp3"): ro - - -; rw - - -",
        "a Mount, DELETE missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "a Mount, PROPPATCH root ("/"): ro - - -; rw - - -",
        "a Mount, PROPPATCH above (""): ro - - -; rw - - -",
        "a Mount, PROPPATCH inside ("/files/photos/a.jpg"): ro - - -; rw 207 503 404",
        "a Mount, PROPPATCH outside ("/media/music/c.mp3"): ro - - -; rw - - -",
        "a Mount, PROPPATCH missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "a Mount, COPY root ("/"): ro - - -; rw - - -",
        "a Mount, COPY above (""): ro - - -; rw - - -",
        "a Mount, COPY inside ("/files/photos/a.jpg"): ro - - -; rw 201 503 404",
        "a Mount, COPY outside ("/media/music/c.mp3"): ro - - -; rw - - -",
        "a Mount, COPY missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "a Mount, MOVE root ("/"): ro - - -; rw - - -",
        "a Mount, MOVE above (""): ro - - -; rw - - -",
        "a Mount, MOVE inside ("/files/photos/a.jpg"): ro - - -; rw 201 503 404",
        "a Mount, MOVE outside ("/media/music/c.mp3"): ro - - -; rw - - -",
        "a Mount, MOVE missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "a Mount, LOCK root ("/"): ro - - -; rw - - -",
        "a Mount, LOCK above (""): ro - - -; rw - - -",
        "a Mount, LOCK inside ("/files/photos/a.jpg"): ro - - -; rw 200 503 409",
        "a Mount, LOCK outside ("/media/music/c.mp3"): ro - - -; rw - - -",
        "a Mount, LOCK missing inside ("/files/photos/missing.txt"): ro - - -; rw 201 503 409",
        "a Mount, UNLOCK root ("/"): ro - - -; rw - - -",
        "a Mount, UNLOCK above (""): ro - - -; rw - - -",
        "a Mount, UNLOCK inside ("/files/photos/a.jpg"): ro - - -; rw 409 409 409",
        "a Mount, UNLOCK outside ("/media/music/c.mp3"): ro - - -; rw - - -",
        "a Mount, UNLOCK missing inside ("/files/photos/missing.txt"): ro - - -; rw 409 409 409",
        "a folder inside a Mount, OPTIONS root ("/"): ro 200 200 200; rw 200 200 200",
        "a folder inside a Mount, OPTIONS above ("/files"): ro 200 200 200; rw 200 200 200",
        "a folder inside a Mount, OPTIONS inside ("/files/photos/a.jpg"): ro 200 200 200; rw 200 200 200",
        "a folder inside a Mount, OPTIONS outside ("/files/docs/secret.txt"): ro - - -; rw - - -",
        "a folder inside a Mount, OPTIONS missing inside ("/files/photos/missing.txt"): ro 200 200 200; rw 200 200 200",
        "a folder inside a Mount, GET root ("/"): ro - - -; rw - - -",
        "a folder inside a Mount, GET above ("/files"): ro - - -; rw - - -",
        "a folder inside a Mount, GET inside ("/files/photos/a.jpg"): ro 200 503 404; rw 200 503 404",
        "a folder inside a Mount, GET outside ("/files/docs/secret.txt"): ro - - -; rw - - -",
        "a folder inside a Mount, GET missing inside ("/files/photos/missing.txt"): ro 404 503 404; rw 404 503 404",
        "a folder inside a Mount, HEAD root ("/"): ro - - -; rw - - -",
        "a folder inside a Mount, HEAD above ("/files"): ro - - -; rw - - -",
        "a folder inside a Mount, HEAD inside ("/files/photos/a.jpg"): ro 200 503 404; rw 200 503 404",
        "a folder inside a Mount, HEAD outside ("/files/docs/secret.txt"): ro - - -; rw - - -",
        "a folder inside a Mount, HEAD missing inside ("/files/photos/missing.txt"): ro 404 503 404; rw 404 503 404",
        "a folder inside a Mount, PROPFIND root ("/"): ro 207 207 207; rw 207 207 207",
        "a folder inside a Mount, PROPFIND above ("/files"): ro 207 503 404; rw 207 503 404",
        "a folder inside a Mount, PROPFIND inside ("/files/photos/a.jpg"): ro 207 503 404; rw 207 503 404",
        "a folder inside a Mount, PROPFIND outside ("/files/docs/secret.txt"): ro - - -; rw - - -",
        "a folder inside a Mount, PROPFIND missing inside ("/files/photos/missing.txt"): ro 404 503 404; rw 404 503 404",
        "a folder inside a Mount, PUT root ("/"): ro - - -; rw - - -",
        "a folder inside a Mount, PUT above ("/files"): ro - - -; rw - - -",
        "a folder inside a Mount, PUT inside ("/files/photos/a.jpg"): ro - - -; rw 204 503 409",
        "a folder inside a Mount, PUT outside ("/files/docs/secret.txt"): ro - - -; rw - - -",
        "a folder inside a Mount, PUT missing inside ("/files/photos/missing.txt"): ro - - -; rw 201 503 409",
        "a folder inside a Mount, MKCOL root ("/"): ro - - -; rw - - -",
        "a folder inside a Mount, MKCOL above ("/files"): ro - - -; rw - - -",
        "a folder inside a Mount, MKCOL inside ("/files/photos/a.jpg"): ro - - -; rw 405 503 409",
        "a folder inside a Mount, MKCOL outside ("/files/docs/secret.txt"): ro - - -; rw - - -",
        "a folder inside a Mount, MKCOL missing inside ("/files/photos/missing.txt"): ro - - -; rw 201 503 409",
        "a folder inside a Mount, DELETE root ("/"): ro - - -; rw - - -",
        "a folder inside a Mount, DELETE above ("/files"): ro - - -; rw - - -",
        "a folder inside a Mount, DELETE inside ("/files/photos/a.jpg"): ro - - -; rw 204 503 404",
        "a folder inside a Mount, DELETE outside ("/files/docs/secret.txt"): ro - - -; rw - - -",
        "a folder inside a Mount, DELETE missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "a folder inside a Mount, PROPPATCH root ("/"): ro - - -; rw - - -",
        "a folder inside a Mount, PROPPATCH above ("/files"): ro - - -; rw - - -",
        "a folder inside a Mount, PROPPATCH inside ("/files/photos/a.jpg"): ro - - -; rw 207 503 404",
        "a folder inside a Mount, PROPPATCH outside ("/files/docs/secret.txt"): ro - - -; rw - - -",
        "a folder inside a Mount, PROPPATCH missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "a folder inside a Mount, COPY root ("/"): ro - - -; rw - - -",
        "a folder inside a Mount, COPY above ("/files"): ro - - -; rw - - -",
        "a folder inside a Mount, COPY inside ("/files/photos/a.jpg"): ro - - -; rw 201 503 404",
        "a folder inside a Mount, COPY outside ("/files/docs/secret.txt"): ro - - -; rw - - -",
        "a folder inside a Mount, COPY missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "a folder inside a Mount, MOVE root ("/"): ro - - -; rw - - -",
        "a folder inside a Mount, MOVE above ("/files"): ro - - -; rw - - -",
        "a folder inside a Mount, MOVE inside ("/files/photos/a.jpg"): ro - - -; rw 201 503 404",
        "a folder inside a Mount, MOVE outside ("/files/docs/secret.txt"): ro - - -; rw - - -",
        "a folder inside a Mount, MOVE missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "a folder inside a Mount, LOCK root ("/"): ro - - -; rw - - -",
        "a folder inside a Mount, LOCK above ("/files"): ro - - -; rw - - -",
        "a folder inside a Mount, LOCK inside ("/files/photos/a.jpg"): ro - - -; rw 200 503 409",
        "a folder inside a Mount, LOCK outside ("/files/docs/secret.txt"): ro - - -; rw - - -",
        "a folder inside a Mount, LOCK missing inside ("/files/photos/missing.txt"): ro - - -; rw 201 503 409",
        "a folder inside a Mount, UNLOCK root ("/"): ro - - -; rw - - -",
        "a folder inside a Mount, UNLOCK above ("/files"): ro - - -; rw - - -",
        "a folder inside a Mount, UNLOCK inside ("/files/photos/a.jpg"): ro - - -; rw 409 409 409",
        "a folder inside a Mount, UNLOCK outside ("/files/docs/secret.txt"): ro - - -; rw - - -",
        "a folder inside a Mount, UNLOCK missing inside ("/files/photos/missing.txt"): ro - - -; rw 409 409 409",
        "two roots, OPTIONS root ("/"): ro 200 200 200; rw 200 200 200",
        "two roots, OPTIONS above ("/media"): ro 200 200 200; rw 200 200 200",
        "two roots, OPTIONS inside ("/media/music/c.mp3"): ro 200 200 200; rw 200 200 200",
        "two roots, OPTIONS outside ("/files/photos2/z.txt"): ro - - -; rw - - -",
        "two roots, OPTIONS missing inside ("/files/photos/missing.txt"): ro 200 200 200; rw 200 200 200",
        "two roots, GET root ("/"): ro - - -; rw - - -",
        "two roots, GET above ("/media"): ro - - -; rw - - -",
        "two roots, GET inside ("/media/music/c.mp3"): ro 200 200 200; rw 200 200 200",
        "two roots, GET outside ("/files/photos2/z.txt"): ro - - -; rw - - -",
        "two roots, GET missing inside ("/files/photos/missing.txt"): ro 404 503 404; rw 404 503 404",
        "two roots, HEAD root ("/"): ro - - -; rw - - -",
        "two roots, HEAD above ("/media"): ro - - -; rw - - -",
        "two roots, HEAD inside ("/media/music/c.mp3"): ro 200 200 200; rw 200 200 200",
        "two roots, HEAD outside ("/files/photos2/z.txt"): ro - - -; rw - - -",
        "two roots, HEAD missing inside ("/files/photos/missing.txt"): ro 404 503 404; rw 404 503 404",
        "two roots, PROPFIND root ("/"): ro 207 207 207; rw 207 207 207",
        "two roots, PROPFIND above ("/media"): ro 207 207 207; rw 207 207 207",
        "two roots, PROPFIND inside ("/media/music/c.mp3"): ro 207 207 207; rw 207 207 207",
        "two roots, PROPFIND outside ("/files/photos2/z.txt"): ro - - -; rw - - -",
        "two roots, PROPFIND missing inside ("/files/photos/missing.txt"): ro 404 503 404; rw 404 503 404",
        "two roots, PUT root ("/"): ro - - -; rw - - -",
        "two roots, PUT above ("/media"): ro - - -; rw - - -",
        "two roots, PUT inside ("/media/music/c.mp3"): ro - - -; rw 204 204 204",
        "two roots, PUT outside ("/files/photos2/z.txt"): ro - - -; rw - - -",
        "two roots, PUT missing inside ("/files/photos/missing.txt"): ro - - -; rw 201 503 409",
        "two roots, MKCOL root ("/"): ro - - -; rw - - -",
        "two roots, MKCOL above ("/media"): ro - - -; rw - - -",
        "two roots, MKCOL inside ("/media/music/c.mp3"): ro - - -; rw 405 405 405",
        "two roots, MKCOL outside ("/files/photos2/z.txt"): ro - - -; rw - - -",
        "two roots, MKCOL missing inside ("/files/photos/missing.txt"): ro - - -; rw 201 503 409",
        "two roots, DELETE root ("/"): ro - - -; rw - - -",
        "two roots, DELETE above ("/media"): ro - - -; rw - - -",
        "two roots, DELETE inside ("/media/music/c.mp3"): ro - - -; rw 204 204 204",
        "two roots, DELETE outside ("/files/photos2/z.txt"): ro - - -; rw - - -",
        "two roots, DELETE missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "two roots, PROPPATCH root ("/"): ro - - -; rw - - -",
        "two roots, PROPPATCH above ("/media"): ro - - -; rw - - -",
        "two roots, PROPPATCH inside ("/media/music/c.mp3"): ro - - -; rw 207 207 207",
        "two roots, PROPPATCH outside ("/files/photos2/z.txt"): ro - - -; rw - - -",
        "two roots, PROPPATCH missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "two roots, COPY root ("/"): ro - - -; rw - - -",
        "two roots, COPY above ("/media"): ro - - -; rw - - -",
        "two roots, COPY inside ("/media/music/c.mp3"): ro - - -; rw 201 201 201",
        "two roots, COPY outside ("/files/photos2/z.txt"): ro - - -; rw - - -",
        "two roots, COPY missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "two roots, MOVE root ("/"): ro - - -; rw - - -",
        "two roots, MOVE above ("/media"): ro - - -; rw - - -",
        "two roots, MOVE inside ("/media/music/c.mp3"): ro - - -; rw 201 201 201",
        "two roots, MOVE outside ("/files/photos2/z.txt"): ro - - -; rw - - -",
        "two roots, MOVE missing inside ("/files/photos/missing.txt"): ro - - -; rw 404 503 404",
        "two roots, LOCK root ("/"): ro - - -; rw - - -",
        "two roots, LOCK above ("/media"): ro - - -; rw - - -",
        "two roots, LOCK inside ("/media/music/c.mp3"): ro - - -; rw 200 200 200",
        "two roots, LOCK outside ("/files/photos2/z.txt"): ro - - -; rw - - -",
        "two roots, LOCK missing inside ("/files/photos/missing.txt"): ro - - -; rw 201 503 409",
        "two roots, UNLOCK root ("/"): ro - - -; rw - - -",
        "two roots, UNLOCK above ("/media"): ro - - -; rw - - -",
        "two roots, UNLOCK inside ("/media/music/c.mp3"): ro - - -; rw 409 409 409",
        "two roots, UNLOCK outside ("/files/photos2/z.txt"): ro - - -; rw - - -",
        "two roots, UNLOCK missing inside ("/files/photos/missing.txt"): ro - - -; rw 409 409 409",
      ]
    `);
    expect(ROWS).toHaveLength(1440);
  });

  it("sends each method's request", () => {
    expect(
      METHODS.map(
        (method) =>
          `${method}: ${JSON.stringify(requestFor(method, ["media", "music", "c.mp3"]))} ${JSON.stringify(requestFor(method, ["files"]).headers ?? {})}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "OPTIONS: {} {}",
        "GET: {} {}",
        "HEAD: {} {}",
        "PROPFIND: {"headers":{"depth":"1"}} {"depth":"1"}",
        "PUT: {"body":"written"} {}",
        "MKCOL: {} {}",
        "DELETE: {} {}",
        "PROPPATCH: {"body":"<?xml version=\\"1.0\\" encoding=\\"utf-8\\"?><D:propertyupdate xmlns:D=\\"DAV:\\"><D:set><D:prop><Z:tag xmlns:Z=\\"urn:t\\">v</Z:tag></D:prop></D:set></D:propertyupdate>"} {}",
        "COPY: {"headers":{"destination":"/dav/media/music/new-copy"}} {"destination":"/dav/files/photos/new-copy"}",
        "MOVE: {"headers":{"destination":"/dav/media/music/new-copy"}} {"destination":"/dav/files/photos/new-copy"}",
        "LOCK: {"headers":{"depth":"0"},"body":"<?xml version=\\"1.0\\" encoding=\\"utf-8\\"?><D:lockinfo xmlns:D=\\"DAV:\\"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>"} {"depth":"0"}",
        "UNLOCK: {"headers":{"lock-token":"<urn:uuid:00000000-0000-4000-8000-000000000000>"}} {"lock-token":"<urn:uuid:00000000-0000-4000-8000-000000000000>"}",
      ]
    `);
    expect(LOCK_BODY).toBe(
      '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>',
    );
    expect(PROPPATCH_BODY).toBe(
      '<?xml version="1.0" encoding="utf-8"?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><Z:tag xmlns:Z="urn:t">v</Z:tag></D:prop></D:set></D:propertyupdate>',
    );
  });

  it.each([
    [["files", "photos"], [["files", "photos"]], "inside"],
    [["files", "photos", "a.jpg"], [["files", "photos"]], "inside"],
    [["files"], [["files", "photos"]], "above"],
    [[], [["files", "photos"]], "above"],
    [["files", "photos2"], [["files", "photos"]], "outside"],
    [["media"], [["files", "photos"]], "outside"],
    [["media", "x"], [["files"], ["media", "x"]], "inside"],
    [["anything"], null, "inside"],
  ] as const)("finds %j relative to the roots %j: %s", (path, roots, where) => {
    expect(relation(path, roots)).toBe(where);
  });

  it("names the destinations, the access levels and the Mount states", () => {
    expect(destinationFor(["media", "x"])).toEqual(["media", "music", "new-copy"]);
    expect(destinationFor(["files", "x"])).toEqual(["files", "photos", "new-copy"]);
    expect(destinationFor([])).toEqual(["files", "photos", "new-copy"]);
    expect(ACCESS).toEqual(["read-only", "read-write"]);
    expect(STATES).toEqual(["exists", "unavailable", "missing"]);
    expect(RELATIONS).toEqual(["root", "above", "inside", "outside", "missing inside"]);
    expect(namesOf("/a//b/")).toEqual(["a", "b"]);
  });
});
