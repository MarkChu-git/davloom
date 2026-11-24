import { clientHop, type HopKind } from "@davloom/laws";
import { BlockList, isIP } from "node:net";

// The client's address on Bun, for Better Auth's rate limit. Without trusted proxies it is the
// socket's peer. Behind a reverse proxy every request comes from the proxy, so all clients would
// share one bucket; the deployment names its proxies in DAVLOOM_TRUSTED_PROXIES, and only when the
// peer is one of them does X-Forwarded-For count, read from the right (packages/laws forwarding).

/** The trusted proxies DAVLOOM_TRUSTED_PROXIES names, or the entries it could not read. */
export const parseTrustedProxies = (
  value: string | undefined,
): { ok: true; proxies: BlockList | null } | { ok: false; invalid: string[] } => {
  const entries = (value ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (entries.length === 0) return { ok: true, proxies: null };
  const proxies = new BlockList();
  const invalid: string[] = [];
  for (const entry of entries) {
    const [address = "", prefix, ...rest] = entry.split("/");
    const family = isIP(address);
    const bits = family === 4 ? 32 : 128;
    const length = prefix === undefined ? bits : /^\d{1,3}$/.test(prefix) ? Number(prefix) : -1;
    if (family === 0 || rest.length > 0 || length < 0 || length > bits) {
      invalid.push(entry);
      continue;
    }
    proxies.addSubnet(address, length, family === 4 ? "ipv4" : "ipv6");
  }
  return invalid.length > 0 ? { ok: false, invalid } : { ok: true, proxies };
};

/** An address as a socket or a proxy writes it: IPv6 maybe in brackets, IPv4 maybe with a port. */
const addressOf = (value: string): string | null => {
  const trimmed = value.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
  const candidate =
    bracketed?.[1] ?? (/^[\d.]+:\d+$/.test(trimmed) ? trimmed.split(":")[0] : trimmed);
  return candidate !== undefined && isIP(candidate) !== 0 ? candidate : null;
};

/** Whether `proxies` names the address. */
const isTrusted = (proxies: BlockList, address: string) =>
  proxies.check(address, isIP(address) === 4 ? "ipv4" : "ipv6");

/**
 * The address a request's client sent it from: the socket's peer, unless `proxies` names it,
 * and then the nearest X-Forwarded-For address that no trusted proxy has.
 */
export const clientAddress = (
  peer: string,
  forwardedFor: string | null,
  proxies: BlockList | null,
): string => {
  if (proxies === null) return peer;
  const hops = [
    peer,
    ...(forwardedFor ?? "")
      .split(",")
      .map((hop) => hop.trim())
      .filter((hop) => hop !== "")
      .toReversed(),
  ];
  const addresses = hops.map(addressOf);
  const kinds = addresses.map((address): HopKind =>
    address === null ? "invalid" : isTrusted(proxies, address) ? "trusted" : "untrusted",
  );
  const index = clientHop(kinds);
  return addresses[index] ?? peer;
};
