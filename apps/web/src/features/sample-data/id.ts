/**
 * A random id for something created during the visit. `crypto.randomUUID` exists only in secure
 * contexts, and the prototype also opens over plain HTTP, for example from a phone on the LAN.
 */
export const sampleId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
