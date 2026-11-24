import { describe, expect, it } from "vitest";
import { BASE, ORIGIN, setup } from "../test/harness";
import {
  destinationPath,
  rest,
  SOURCES,
  statusesOf,
  subtree,
  TABLE,
  WORLD,
} from "./transfer-cases";
import { snapshot } from "./world";

// COPY and MOVE (RFC 4918 §9.8, §9.9): the table and oracle of transfer-cases.ts, against the
// handler.

const world = async () => {
  const w = setup();
  for (const [path, content] of Object.entries(WORLD)) {
    if (path.endsWith("/")) await w.mkcol(path.slice(0, -1));
    else await w.put(path, content);
  }
  return w;
};

describe("COPY and MOVE", () => {
  it.each(TABLE)(
    "%s of %s onto %s, Overwrite %s",
    async (method, source, destination, overwrite) => {
      const w = await world();
      const from = SOURCES[source];
      const to = destinationPath(destination, from);
      const before = await snapshot(w.storage, "");
      const response = await w.dav(method, from, {
        headers: { destination: `${ORIGIN}${BASE}${to}`, overwrite: overwrite ? "T" : "F" },
      });
      await response.body?.cancel();
      expect(statusesOf(source, destination, overwrite)).toContain(response.status);
      const after = await snapshot(w.storage, "");
      if (response.status >= 400) return expect(after).toEqual(before);
      // The destination is exactly the source's tree; nothing of what it replaced remains.
      expect(subtree(after, to)).toEqual(subtree(before, from));
      if (method === "COPY") expect(subtree(after, from)).toEqual(subtree(before, from));
      else expect(subtree(after, from)).toEqual({});
      // Everything else is as it was.
      expect(rest(after, from, to)).toEqual(rest(before, from, to));
    },
  );
});
