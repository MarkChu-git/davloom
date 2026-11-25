import { beforeAll, describe, expect, it } from "vitest";
import {
  BODIES,
  findProperty,
  FORMS,
  KINDS,
  PATHS,
  PROPERTIES,
  propfindOf,
  TABLE,
  type Get,
  type Kind,
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

// The rules of the oracle, written out (RFC 4918 §15, RFC 4331): for each property, its rule on a
// file, a collection, the root and a Mount root, and whether allprop returns it; then each value
// check against values that pass and values that do not. A change to a rule or to a check fails
// here, not only in the comparison with the handler.
describe("the PROPFIND oracle, written out", () => {
  const property = (name: string) => {
    const found = PROPERTIES[name];
    if (!found) throw new Error(name);
    return found;
  };

  it("has these rules", () => {
    expect(
      Object.entries(PROPERTIES).map(
        ([name, { rules, allprop }]) =>
          `${name}: ${KINDS.map((kind) => rules[kind]).join(" ")}${allprop ? ", in allprop" : ""}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "creationdate: required required optional required, in allprop",
        "displayname: optional optional optional optional, in allprop",
        "getcontentlanguage: absent absent absent absent, in allprop",
        "getcontentlength: required optional optional optional, in allprop",
        "getcontenttype: required optional optional optional, in allprop",
        "getetag: required optional optional optional, in allprop",
        "getlastmodified: required optional optional optional, in allprop",
        "lockdiscovery: required required required required, in allprop",
        "resourcetype: required required required required, in allprop",
        "supportedlock: required required required required, in allprop",
        "quota-available-bytes: optional optional optional optional",
        "quota-used-bytes: optional optional optional optional",
      ]
    `);
    expect(PATHS).toEqual({
      file: "/files/photos/a.jpg",
      collection: "/files/photos",
      root: "/",
      "mount root": "/files",
    });
    expect(FORMS).toEqual(["prop", "propname", "allprop", "include"]);
    expect(TABLE).toHaveLength(Object.keys(PROPERTIES).length * KINDS.length * FORMS.length);
  });

  const get: Get = {
    etag: '"e1"',
    lastModified: "Mon, 02 Nov 2026 00:00:00 GMT",
    length: "15",
    type: 'text/plain; x="<&>"',
  };

  // [property, value, kind, valid]
  const CHECKS: readonly (readonly [string, string, Kind, boolean])[] = [
    ["creationdate", "2026-11-02T00:00:00Z", "file", true],
    ["creationdate", "2026-11-02T00:00:00.125+01:00", "root", true],
    ["creationdate", "2026-11-02T00:00:00-12:30", "file", true],
    ["creationdate", "x2026-11-02T00:00:00Z", "file", false],
    ["creationdate", "2026-11-02T00:00:00Zx", "file", false],
    ["creationdate", "2026-11-02T00:00:00.Z", "file", false],
    ["creationdate", "2026-11-02T00:00:00.1aZ", "file", false],
    ["creationdate", "2026-11-02T00:00:00*01:00", "file", false],
    ["creationdate", "2026-11-02T00:00:00+1:00", "file", false],
    ["creationdate", "2026-11-02T00:00:00+01:0", "file", false],
    ["creationdate", "2026-11-02 00:00:00Z", "file", false],
    ["displayname", "anything", "file", true],
    ["getcontentlanguage", "en", "file", true],
    ["getcontentlength", "15", "file", true],
    ["getcontentlength", "16", "file", false],
    ["getcontentlength", "16", "collection", true],
    ["getcontentlength", "15", "root", true],
    ["getcontentlength", "x15", "collection", false],
    ["getcontentlength", "15x", "collection", false],
    ["getcontentlength", "", "collection", false],
    ["getcontenttype", "text/plain; x=&quot;&lt;&amp;&gt;&quot;", "file", false],
    ["getcontenttype", 'text/plain; x="&lt;&amp;&gt;"', "file", true],
    ["getcontenttype", "text/plain", "file", false],
    ["getcontenttype", "text/plain", "collection", true],
    ["getcontenttype", "text/plain;charset=utf-8", "mount root", true],
    ["getcontenttype", "text/plain ;q=&lt;", "collection", true],
    ["getcontenttype", "text/plain; charset=utf-8", "collection", true],
    ["getcontenttype", "(text/plain", "collection", false],
    ["getcontenttype", "text/plain(", "collection", false],
    ["getcontenttype", "text/", "collection", false],
    ["getcontenttype", "/plain", "collection", false],
    ["getcontenttype", "textplain", "collection", false],
    ["getetag", '"e1"', "file", true],
    ["getetag", '"e2"', "file", false],
    ["getetag", '"e2"', "collection", true],
    ["getetag", 'W/"e2"', "root", true],
    ["getetag", 'x"e2"', "collection", false],
    ["getetag", '"e2"x', "collection", false],
    ["getetag", "e2", "collection", false],
    ["getlastmodified", "Mon, 02 Nov 2026 00:00:00 GMT", "file", true],
    ["getlastmodified", "Tue, 03 Nov 2026 00:00:00 GMT", "file", false],
    ["getlastmodified", "Tue, 03 Nov 2026 00:00:00 GMT", "collection", true],
    ["getlastmodified", "xTue, 03 Nov 2026 00:00:00 GMT", "collection", false],
    ["getlastmodified", "Tue, 03 Nov 2026 00:00:00 GMTx", "collection", false],
    ["getlastmodified", "Tue, 3 Nov 2026 00:00:00 GMT", "collection", false],
    ["lockdiscovery", "", "file", true],
    ["lockdiscovery", "<D:activelock/>", "file", false],
    ["resourcetype", "", "file", true],
    ["resourcetype", "<D:collection/>", "file", false],
    ["resourcetype", "<D:collection/>", "collection", true],
    ["resourcetype", "", "collection", false],
    ["resourcetype", "<D:collection/>", "root", true],
    ["supportedlock", "<D:lockentry><D:exclusive/><D:write/></D:lockentry>", "file", true],
    ["supportedlock", "<D:exclusive/><D:write/>", "file", false],
    ["supportedlock", "<D:lockentry><D:write/>", "file", false],
    ["supportedlock", "<D:lockentry><D:exclusive/>", "file", false],
    ["supportedlock", "", "file", false],
    ["quota-available-bytes", "1024", "root", true],
    ["quota-available-bytes", "x1024", "root", false],
    ["quota-available-bytes", "1024x", "root", false],
    ["quota-used-bytes", "0", "file", true],
    ["quota-used-bytes", "10", "file", true],
    ["quota-used-bytes", "x10", "file", false],
    ["quota-used-bytes", "10x", "file", false],
    ["quota-used-bytes", "ten", "file", false],
  ];

  it.each(CHECKS)("checks %s %j on the %s as %s", (name, value, kind, valid) => {
    expect(property(name).valid(value, kind, get)).toBe(valid);
  });

  it("finds a property in each propstat, across lines", () => {
    const xml =
      "<D:multistatus><D:response><D:propstat><D:prop><D:a>x\ny</D:a><D:b/></D:prop>" +
      "<D:status>HTTP/1.1 200 OK</D:status></D:propstat><D:propstat><D:prop><D:c/></D:prop>" +
      "<D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response></D:multistatus>";
    expect(findProperty(xml, "a")).toEqual([{ status: 200, value: "x\ny" }]);
    expect(findProperty(xml, "b")).toEqual([{ status: 200, value: "" }]);
    expect(findProperty(xml, "c")).toEqual([{ status: 404, value: "" }]);
    expect(findProperty(xml, "d")).toEqual([]);
    expect(BODIES.prop("x")).toBe("<D:prop><D:x/></D:prop>");
    expect(BODIES.propname("x")).toBe("<D:propname/>");
    expect(BODIES.allprop("x")).toBe("<D:allprop/>");
    expect(BODIES.include("x")).toBe("<D:allprop/><D:include><D:x/></D:include>");
  });

  it("gets these answers from the handler", async () => {
    const answers: string[] = [];
    for (const [name, kind, form] of TABLE) {
      const found = findProperty(await propfind(PATHS[kind], BODIES[form](name)), name);
      const shown = found.map(({ status, value }) =>
        value.length > 40 ? `${status} (${value.length} characters)` : `${status} ${value}`,
      );
      answers.push(`${name} ${kind} ${form}: ${shown.join(", ") || "-"}`);
    }
    expect(answers).toMatchInlineSnapshot(`
      [
        "creationdate file prop: 200 2026-11-01T00:00:00Z",
        "creationdate file propname: 200 ",
        "creationdate file allprop: 200 2026-11-01T00:00:00Z",
        "creationdate file include: 200 2026-11-01T00:00:00Z",
        "creationdate collection prop: 200 2026-11-01T00:00:00Z",
        "creationdate collection propname: 200 ",
        "creationdate collection allprop: 200 2026-11-01T00:00:00Z",
        "creationdate collection include: 200 2026-11-01T00:00:00Z",
        "creationdate root prop: 200 2026-10-01T00:00:00Z",
        "creationdate root propname: 200 ",
        "creationdate root allprop: 200 2026-10-01T00:00:00Z",
        "creationdate root include: 200 2026-10-01T00:00:00Z",
        "creationdate mount root prop: 200 2026-11-01T00:00:00Z",
        "creationdate mount root propname: 200 ",
        "creationdate mount root allprop: 200 2026-11-01T00:00:00Z",
        "creationdate mount root include: 200 2026-11-01T00:00:00Z",
        "displayname file prop: 200 a.jpg",
        "displayname file propname: 200 ",
        "displayname file allprop: 200 a.jpg",
        "displayname file include: 200 a.jpg",
        "displayname collection prop: 200 photos",
        "displayname collection propname: 200 ",
        "displayname collection allprop: 200 photos",
        "displayname collection include: 200 photos",
        "displayname root prop: 200 ",
        "displayname root propname: 200 ",
        "displayname root allprop: 200 ",
        "displayname root include: 200 ",
        "displayname mount root prop: 200 files",
        "displayname mount root propname: 200 ",
        "displayname mount root allprop: 200 files",
        "displayname mount root include: 200 files",
        "getcontentlanguage file prop: 404 ",
        "getcontentlanguage file propname: -",
        "getcontentlanguage file allprop: -",
        "getcontentlanguage file include: -",
        "getcontentlanguage collection prop: 404 ",
        "getcontentlanguage collection propname: -",
        "getcontentlanguage collection allprop: -",
        "getcontentlanguage collection include: -",
        "getcontentlanguage root prop: 404 ",
        "getcontentlanguage root propname: -",
        "getcontentlanguage root allprop: -",
        "getcontentlanguage root include: -",
        "getcontentlanguage mount root prop: 404 ",
        "getcontentlanguage mount root propname: -",
        "getcontentlanguage mount root allprop: -",
        "getcontentlanguage mount root include: -",
        "getcontentlength file prop: 200 15",
        "getcontentlength file propname: 200 ",
        "getcontentlength file allprop: 200 15",
        "getcontentlength file include: 200 15",
        "getcontentlength collection prop: 404 ",
        "getcontentlength collection propname: -",
        "getcontentlength collection allprop: -",
        "getcontentlength collection include: -",
        "getcontentlength root prop: 404 ",
        "getcontentlength root propname: -",
        "getcontentlength root allprop: -",
        "getcontentlength root include: -",
        "getcontentlength mount root prop: 404 ",
        "getcontentlength mount root propname: -",
        "getcontentlength mount root allprop: -",
        "getcontentlength mount root include: -",
        "getcontenttype file prop: 200 image/jpeg",
        "getcontenttype file propname: 200 ",
        "getcontenttype file allprop: 200 image/jpeg",
        "getcontenttype file include: 200 image/jpeg",
        "getcontenttype collection prop: 404 ",
        "getcontenttype collection propname: -",
        "getcontenttype collection allprop: -",
        "getcontenttype collection include: -",
        "getcontenttype root prop: 404 ",
        "getcontenttype root propname: -",
        "getcontenttype root allprop: -",
        "getcontenttype root include: -",
        "getcontenttype mount root prop: 404 ",
        "getcontenttype mount root propname: -",
        "getcontenttype mount root allprop: -",
        "getcontenttype mount root include: -",
        "getetag file prop: 200 "m6"",
        "getetag file propname: 200 ",
        "getetag file allprop: 200 "m6"",
        "getetag file include: 200 "m6"",
        "getetag collection prop: 200 "m2"",
        "getetag collection propname: 200 ",
        "getetag collection allprop: 200 "m2"",
        "getetag collection include: 200 "m2"",
        "getetag root prop: 200 "root"",
        "getetag root propname: 200 ",
        "getetag root allprop: 200 "root"",
        "getetag root include: 200 "root"",
        "getetag mount root prop: 200 "m1"",
        "getetag mount root propname: 200 ",
        "getetag mount root allprop: 200 "m1"",
        "getetag mount root include: 200 "m1"",
        "getlastmodified file prop: 200 Sun, 01 Nov 2026 00:00:00 GMT",
        "getlastmodified file propname: 200 ",
        "getlastmodified file allprop: 200 Sun, 01 Nov 2026 00:00:00 GMT",
        "getlastmodified file include: 200 Sun, 01 Nov 2026 00:00:00 GMT",
        "getlastmodified collection prop: 200 Sun, 01 Nov 2026 00:00:00 GMT",
        "getlastmodified collection propname: 200 ",
        "getlastmodified collection allprop: 200 Sun, 01 Nov 2026 00:00:00 GMT",
        "getlastmodified collection include: 200 Sun, 01 Nov 2026 00:00:00 GMT",
        "getlastmodified root prop: 200 Thu, 01 Oct 2026 00:00:00 GMT",
        "getlastmodified root propname: 200 ",
        "getlastmodified root allprop: 200 Thu, 01 Oct 2026 00:00:00 GMT",
        "getlastmodified root include: 200 Thu, 01 Oct 2026 00:00:00 GMT",
        "getlastmodified mount root prop: 200 Sun, 01 Nov 2026 00:00:00 GMT",
        "getlastmodified mount root propname: 200 ",
        "getlastmodified mount root allprop: 200 Sun, 01 Nov 2026 00:00:00 GMT",
        "getlastmodified mount root include: 200 Sun, 01 Nov 2026 00:00:00 GMT",
        "lockdiscovery file prop: 200 ",
        "lockdiscovery file propname: 200 ",
        "lockdiscovery file allprop: 200 ",
        "lockdiscovery file include: 200 ",
        "lockdiscovery collection prop: 200 ",
        "lockdiscovery collection propname: 200 ",
        "lockdiscovery collection allprop: 200 ",
        "lockdiscovery collection include: 200 ",
        "lockdiscovery root prop: 200 ",
        "lockdiscovery root propname: 200 ",
        "lockdiscovery root allprop: 200 ",
        "lockdiscovery root include: 200 ",
        "lockdiscovery mount root prop: 200 ",
        "lockdiscovery mount root propname: 200 ",
        "lockdiscovery mount root allprop: 200 ",
        "lockdiscovery mount root include: 200 ",
        "resourcetype file prop: 200 ",
        "resourcetype file propname: 200 ",
        "resourcetype file allprop: 200 ",
        "resourcetype file include: 200 ",
        "resourcetype collection prop: 200 <D:collection/>",
        "resourcetype collection propname: 200 ",
        "resourcetype collection allprop: 200 <D:collection/>",
        "resourcetype collection include: 200 <D:collection/>",
        "resourcetype root prop: 200 <D:collection/>",
        "resourcetype root propname: 200 ",
        "resourcetype root allprop: 200 <D:collection/>",
        "resourcetype root include: 200 <D:collection/>",
        "resourcetype mount root prop: 200 <D:collection/>",
        "resourcetype mount root propname: 200 ",
        "resourcetype mount root allprop: 200 <D:collection/>",
        "resourcetype mount root include: 200 <D:collection/>",
        "supportedlock file prop: 200 (203 characters)",
        "supportedlock file propname: 200 ",
        "supportedlock file allprop: 200 (203 characters)",
        "supportedlock file include: 200 (203 characters)",
        "supportedlock collection prop: 200 (203 characters)",
        "supportedlock collection propname: 200 ",
        "supportedlock collection allprop: 200 (203 characters)",
        "supportedlock collection include: 200 (203 characters)",
        "supportedlock root prop: 200 (203 characters)",
        "supportedlock root propname: 200 ",
        "supportedlock root allprop: 200 (203 characters)",
        "supportedlock root include: 200 (203 characters)",
        "supportedlock mount root prop: 200 (203 characters)",
        "supportedlock mount root propname: 200 ",
        "supportedlock mount root allprop: 200 (203 characters)",
        "supportedlock mount root include: 200 (203 characters)",
        "quota-available-bytes file prop: 404 ",
        "quota-available-bytes file propname: -",
        "quota-available-bytes file allprop: -",
        "quota-available-bytes file include: -",
        "quota-available-bytes collection prop: 404 ",
        "quota-available-bytes collection propname: -",
        "quota-available-bytes collection allprop: -",
        "quota-available-bytes collection include: -",
        "quota-available-bytes root prop: 404 ",
        "quota-available-bytes root propname: -",
        "quota-available-bytes root allprop: -",
        "quota-available-bytes root include: -",
        "quota-available-bytes mount root prop: 404 ",
        "quota-available-bytes mount root propname: -",
        "quota-available-bytes mount root allprop: -",
        "quota-available-bytes mount root include: -",
        "quota-used-bytes file prop: 404 ",
        "quota-used-bytes file propname: -",
        "quota-used-bytes file allprop: -",
        "quota-used-bytes file include: -",
        "quota-used-bytes collection prop: 200 65",
        "quota-used-bytes collection propname: -",
        "quota-used-bytes collection allprop: -",
        "quota-used-bytes collection include: 200 65",
        "quota-used-bytes root prop: 404 ",
        "quota-used-bytes root propname: -",
        "quota-used-bytes root allprop: -",
        "quota-used-bytes root include: -",
        "quota-used-bytes mount root prop: 200 65",
        "quota-used-bytes mount root propname: -",
        "quota-used-bytes mount root allprop: -",
        "quota-used-bytes mount root include: 200 65",
      ]
    `);
  });
});
