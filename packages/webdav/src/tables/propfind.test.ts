import { beforeAll, describe, expect, it } from "vitest";
import {
  BODIES,
  findProperty,
  PATHS,
  PROPERTIES,
  propfindOf,
  TABLE,
  type Get,
} from "./propfind-cases";
import { buildWorld, type World } from "./world";

// PROPFIND live properties (RFC 4918 §15, RFC 4331): the table and oracle of propfind-cases.ts,
// against the handler.

let world: World;
let get: Get;

const propfind = async (path: string, body: string) => {
  const response = await world.call("PROPFIND", path, {
    headers: { depth: "0" },
    body: propfindOf(body),
  });
  expect(response.status).toBe(207);
  return await response.text();
};

beforeAll(async () => {
  world = await buildWorld({ scope: null });
  const head = await world.call("HEAD", PATHS.file);
  get = {
    etag: head.headers.get("etag"),
    lastModified: head.headers.get("last-modified"),
    length: head.headers.get("content-length"),
    type: head.headers.get("content-type"),
  };
});

describe("PROPFIND live properties", () => {
  it.each(TABLE)("%s on the %s with %s", async (name, kind, form) => {
    const property = PROPERTIES[name];
    if (!property) throw new Error(name);
    const rule = property.rules[kind];
    const found = findProperty(await propfind(PATHS[kind], BODIES[form](name)), name);
    expect(found.length).toBeLessThanOrEqual(1);
    const [hit] = found;
    const present = hit?.status === 200;
    if (present) {
      expect(rule).not.toBe("absent");
      if (form === "propname") expect(hit.value).toBe("");
      else expect(property.valid(hit.value, kind, get)).toBe(true);
    } else {
      expect(rule).not.toBe("required");
    }
    if (form === "prop") {
      // §9.1: a property asked for by name is either returned or listed with 404.
      expect(hit?.status === 200 || hit?.status === 404).toBe(true);
    } else if (form === "propname" || form === "allprop") {
      // Nothing is listed as missing when no property was named.
      expect(hit === undefined || present).toBe(true);
      if (!property.allprop && form === "allprop") expect(hit).toBeUndefined();
    } else {
      // §14.8: include returns the named property whenever it is defined.
      const asked = findProperty(await propfind(PATHS[kind], BODIES.prop(name)), name);
      if (asked[0]?.status === 200) expect(present).toBe(true);
      else if (!property.allprop) expect(present).toBe(false);
    }
  });
});
