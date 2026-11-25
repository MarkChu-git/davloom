import { describe, expect, it } from "vitest";
import { entriesOf, expiryOf, parseMultistatus } from "./dav";

// Lock discovery in a PROPFIND answer (RFC 4918 §15.8), read with the browser's XML parser. The
// default namespace: happy-dom's XML parser finds no prefixed element by its namespace.

const multistatus = (lockdiscovery: string) =>
  `<?xml version="1.0"?><multistatus xmlns="DAV:"><response><href>/dav/files/a.txt</href><propstat><prop><resourcetype/>${lockdiscovery}</prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>`;

const NOW = Date.parse("2026-11-24T10:00:00.000Z");

describe("locks in a listing", () => {
  it("reads an active lock: its token, owner, root and expiry", () => {
    const [response] = parseMultistatus(
      multistatus(
        "<lockdiscovery><activelock><locktype><write/></locktype><lockscope><exclusive/></lockscope><depth>infinity</depth><owner><href> Finder </href></owner><timeout>Second-600</timeout><locktoken><href>urn:uuid:1</href></locktoken><lockroot><href>/dav/files/</href></lockroot></activelock></lockdiscovery>",
      ),
      NOW,
    );
    expect(response?.locks).toEqual([
      {
        token: "urn:uuid:1",
        owner: "Finder",
        root: ["files"],
        expiresAt: "2026-11-24T10:10:00.000Z",
      },
    ]);
    expect(entriesOf(response === undefined ? [] : [response], ["files"])[0]?.lock?.owner).toBe(
      "Finder",
    );
  });

  it("reads a lock the server shows without its token or owner", () => {
    const [response] = parseMultistatus(
      multistatus(
        "<lockdiscovery><activelock><locktype><write/></locktype><lockscope><exclusive/></lockscope><depth>0</depth><timeout>Infinite</timeout><lockroot><href>/dav/files/a.txt</href></lockroot></activelock></lockdiscovery>",
      ),
      NOW,
    );
    expect(response?.locks).toEqual([
      { token: null, owner: "", root: ["files", "a.txt"], expiresAt: "" },
    ]);
  });

  it.each(["<lockdiscovery/>", ""])("reads no lock from %j", (discovery) => {
    expect(parseMultistatus(multistatus(discovery), NOW)[0]?.locks).toEqual([]);
  });

  it.each([
    ["Second-0", "2026-11-24T10:00:00.000Z"],
    ["second-3600", "2026-11-24T11:00:00.000Z"],
    ["Infinite", ""],
    ["Second-", ""],
    [null, ""],
  ])("a timeout of %j runs out at %j", (timeout, expiry) => {
    expect(expiryOf(timeout, NOW)).toBe(expiry);
  });
});
