export interface BasicCredentials {
  readonly username: string;
  readonly password: string;
}

const BASIC_SCHEME = /^basic\s+(\S+)$/i;

/** Reads an RFC 7617 Authorization header. Returns null for anything that is not valid Basic. */
export const parseBasicCredentials = (header: string | null): BasicCredentials | null => {
  const encoded = header?.match(BASIC_SCHEME)?.[1];
  if (!encoded) {
    return null;
  }

  let decoded: string;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }

  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return null;
  }
  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
};
