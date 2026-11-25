import { describe, expect, it } from "vitest";
import { DavError, expiryOf, parseMultistatus } from "./dav";

// The multistatus bodies of RFC 4918 §13, read with the browser's XML parser (happy-dom here): the
// shapes a server may send that the Files page must still read, or refuse as a bad gateway.

const NOW = Date.parse("2026-11-25T00:00:00Z");

const multistatus = (...responses: string[]) =>
  `<?xml version="1.0"?><multistatus xmlns="DAV:">${responses.join("")}</multistatus>`;

const ok = (props: string) =>
  `<propstat><prop>${props}</prop><status>HTTP/1.1 200 OK</status></propstat>`;

describe("parseMultistatus", () => {
  it("refuses a body that is not XML as a bad gateway", () => {
    expect(() => parseMultistatus("<multistatus", NOW)).toThrow(DavError);
    try {
      parseMultistatus("<multistatus", NOW);
    } catch (error) {
      expect(error).toMatchObject({ status: 502 });
    }
  });

  it.each([
    ["a response without an href", multistatus(`<response>${ok("")}</response>`), []],
    [
      "a response whose only propstat is not 200",
      multistatus(
        `<response><href>/dav/files/x</href><propstat><prop><getcontentlength>5</getcontentlength></prop><status>HTTP/1.1 404 Not Found</status></propstat></response>`,
      ),
      [
        {
          href: "/dav/files/x",
          isCollection: false,
          contentLength: null,
          lastModified: null,
          contentType: null,
        },
      ],
    ],
  ])("reads %s", (_case, xml, read) => {
    expect(parseMultistatus(xml, NOW)).toEqual(read);
  });

  it.each([
    [
      "with its token, owner, root and timeout",
      "<locktoken><href>urn:uuid:1</href></locktoken><owner><href>Finder</href></owner><timeout>Second-60</timeout><lockroot><href>/dav/files/x</href></lockroot>",
      {
        token: "urn:uuid:1",
        owner: "Finder",
        root: ["files", "x"],
        expiresAt: "2026-11-25T00:01:00.000Z",
      },
    ],
    [
      "without a token, an owner, a root or a timeout",
      "",
      { token: null, owner: "", root: undefined, expiresAt: "" },
    ],
    [
      "with a root that names no href, and an Infinite timeout",
      "<lockroot></lockroot><timeout>Infinite</timeout>",
      { token: null, owner: "", root: undefined, expiresAt: "" },
    ],
  ])("reads an active lock %s", (_case, inner, lock) => {
    const xml = multistatus(
      `<response><href>/dav/files/x</href>${ok(`<lockdiscovery><activelock><locktype><write/></locktype>${inner}</activelock></lockdiscovery>`)}</response>`,
    );
    expect(parseMultistatus(xml, NOW)[0]?.locks).toEqual([lock]);
  });
});

describe("expiryOf", () => {
  it.each([
    ["Second-1", "2026-11-25T00:00:01.000Z"],
    ["second-3600", "2026-11-25T01:00:00.000Z"],
    ["Infinite", ""],
    [null, ""],
    ["Second-", ""],
  ])("reads %j as %j", (timeout, expiry) => {
    expect(expiryOf(timeout, NOW)).toBe(expiry);
  });
});
