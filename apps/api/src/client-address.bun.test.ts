import { describe, expect, it } from "vitest";
import { clientAddress, parseTrustedProxies } from "./client-address.bun";

const proxies = (value: string) => {
  const parsed = parseTrustedProxies(value);
  if (!parsed.ok) throw new Error(`invalid: ${parsed.invalid.join(", ")}`);
  return parsed.proxies;
};

describe("parseTrustedProxies", () => {
  it.each([
    [undefined, true],
    ["", true],
    ["10.0.0.1", true],
    ["10.0.0.0/8, 172.16.0.0/12 192.168.0.0/16", true],
    ["::1,fd00::/8", true],
    ["10.0.0.0/33", false],
    ["::/129", false],
    ["10.0.0.0/8/1", false],
    ["10.0.0.0/x", false],
    ["proxy.local", false],
    ["10.0.0.1, nonsense", false],
  ])("reads %j: %s", (value, ok) => {
    expect(parseTrustedProxies(value).ok).toBe(ok);
  });

  it("names the entries it cannot read", () => {
    expect(parseTrustedProxies("10.0.0.1, bad, 1.2.3.4/40")).toEqual({
      ok: false,
      invalid: ["bad", "1.2.3.4/40"],
    });
  });
});

describe("clientAddress", () => {
  const caddy = proxies("10.0.0.2, 127.0.0.1, ::1");
  it.each([
    // [case, peer, X-Forwarded-For, trusted proxies, client]
    [
      "no proxies: the peer, whatever the header says",
      "203.0.113.5",
      "198.51.100.1",
      null,
      "203.0.113.5",
    ],
    ["a client the proxy forwards", "10.0.0.2", "198.51.100.7", caddy, "198.51.100.7"],
    [
      "a client that also sends the header",
      "10.0.0.2",
      "1.1.1.1, 198.51.100.7",
      caddy,
      "198.51.100.7",
    ],
    [
      "a client that names a trusted proxy",
      "10.0.0.2",
      "10.0.0.2, 198.51.100.7",
      caddy,
      "198.51.100.7",
    ],
    ["two trusted proxies", "127.0.0.1", "198.51.100.7, 10.0.0.2", caddy, "198.51.100.7"],
    ["a peer that is no trusted proxy", "203.0.113.5", "198.51.100.7", caddy, "203.0.113.5"],
    ["a trusted proxy without the header", "10.0.0.2", null, caddy, "10.0.0.2"],
    ["a trusted proxy with an empty header", "10.0.0.2", " , ", caddy, "10.0.0.2"],
    ["garbage the proxy forwarded", "10.0.0.2", "not-an-address", caddy, "10.0.0.2"],
    ["garbage behind the client", "10.0.0.2", "garbage, 198.51.100.7", caddy, "198.51.100.7"],
    ["IPv6 peer and client", "::1", "2001:db8::7", caddy, "2001:db8::7"],
    ["an IPv4-mapped peer", "::ffff:10.0.0.2", "198.51.100.7", caddy, "198.51.100.7"],
    ["an address with a port", "10.0.0.2", "198.51.100.7:51234", caddy, "198.51.100.7"],
    ["an IPv6 address in brackets", "10.0.0.2", "[2001:db8::7]:443", caddy, "2001:db8::7"],
    ["a subnet of proxies", "172.20.0.3", "198.51.100.7", proxies("172.16.0.0/12"), "198.51.100.7"],
  ] as const)("%s", (_case, peer, forwarded, trusted, client) => {
    expect(clientAddress(peer, forwarded, trusted)).toBe(client);
  });

  it("gives every client its own address behind one proxy", () => {
    const seen = new Set(
      ["198.51.100.1", "198.51.100.2", "2001:db8::3"].map((client) =>
        clientAddress("10.0.0.2", client, caddy),
      ),
    );
    expect(seen.size).toBe(3);
  });
});
