// Capability advertisement and methods outside the protocol. The oracle: RFC 4918 §10.1 and §18
// (DAV: 1 is Class 1; 2 adds LOCK and UNLOCK), RFC 9110 §15.5.6 (405 names the allowed methods in
// Allow), PRD §5 (never advertise what is not implemented) and PRD §6 (an API Key may make no
// request outside the twelve methods the policy knows). methods.test.ts runs the table in process,
// and tests/integration/compat/http/protocol-tables.test.ts over HTTP against real servers.

export const CLASS_1 = [
  "OPTIONS",
  "GET",
  "HEAD",
  "PUT",
  "DELETE",
  "MKCOL",
  "COPY",
  "MOVE",
  "PROPFIND",
  "PROPPATCH",
];
export const CLASS_2 = [...CLASS_1, "LOCK", "UNLOCK"];

// Methods that the Fetch API's Request keeps as sent on every runtime the tests run on. (Bun's
// Request turns names it does not know, such as LABEL or VERSION-CONTROL, into GET.)
export const OTHER_METHODS: readonly string[] = [
  "POST",
  "PATCH",
  "SEARCH",
  "REPORT",
  "ACL",
  "BIND",
  "UNBIND",
  "REBIND",
  "MKCALENDAR",
  "MKACTIVITY",
  "CHECKOUT",
  "MERGE",
  "LINK",
  "UNLINK",
  "PURGE",
  "QUERY",
  "M-SEARCH",
  "SUBSCRIBE",
  "UNSUBSCRIBE",
  "NOTIFY",
  "SOURCE",
];

export const allowOf = (response: Response) =>
  (response.headers.get("allow") ?? "")
    .split(",")
    .map((method) => method.trim())
    .filter((method) => method !== "")
    .toSorted();
