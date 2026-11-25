// Grafana k6 load test of Davloom's production Worker in local workerd (PRD §11: scheduled, run
// only against local Bun or Docker, never against Cloud Free). scripts/load.ts starts the Worker
// and runs this script in the pinned k6 image with:
//   BASE_URL  where k6 reaches the Worker
//   HOST      the Host header to send, the Worker's own loopback address
//   API_KEY   a read-write API Key, for WebDAV with Basic Auth
//   COOKIE    the signed-in administrator's session, for the management API
// Each WebDAV iteration works in a collection of its own virtual user, so the users never take
// each other's locks. The thresholds hold the 95th percentile of each operation and the error
// rate; docs/ci.md gives the measurements they come from.
import http from "k6/http";
import { check, fail } from "k6";
import encoding from "k6/encoding";
import exec from "k6/execution";

const BASE_URL = __ENV.BASE_URL;
const HOST = __ENV.HOST;
const API_KEY = __ENV.API_KEY;
const COOKIE = __ENV.COOKIE;
const ROOT = "/dav/files/load";

const LOCK_BODY =
  '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>';
const FILE_BYTES = 64 * 1024;
/** Files in each virtual user's collection besides its own, so that a listing has entries. */
const SEEDED_FILES = 20;

const WEBDAV_VUS = 6;
const API_VUS = 2;

/** A ramp to the target, a hold, and a ramp down. */
const stages = (target) => [
  { duration: "20s", target },
  { duration: "90s", target },
  { duration: "10s", target: 0 },
];

/** The 95th percentile of one operation, in milliseconds. */
const p95 = (scenario, op, ms) => ({
  [`http_req_duration{scenario:${scenario},op:${op}}`]: [`p(95)<${ms}`],
});

export const options = {
  scenarios: {
    webdav: { executor: "ramping-vus", exec: "webdav", stages: stages(WEBDAV_VUS) },
    api: { executor: "ramping-vus", exec: "api", stages: stages(API_VUS) },
  },
  // Two runs on 4 CPUs on 2026-11-24 failed no request; each p95 limit is about 2.5 times the
  // higher p95 those runs measured (in the comment), which leaves room for the runner's slower
  // CPUs, 1.5 to 1.8 times slower in docs/ci.md, and for noise.
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
    ...p95("webdav", "put", 500), // 187 ms, a 64 KiB body
    ...p95("webdav", "get", 300), // 108 ms
    ...p95("webdav", "propfind", 250), // 96 ms, Depth 1 on 21 or 22 entries
    ...p95("webdav", "lock", 300), // 108 ms
    ...p95("webdav", "unlock", 300), // 119 ms
    ...p95("webdav", "move", 350), // 131 ms
    ...p95("webdav", "delete", 300), // 123 ms
    ...p95("api", "me", 250), // 98 ms
    ...p95("api", "overview", 300), // 118 ms
    ...p95("api", "keys", 300), // 110 ms
    ...p95("api", "mounts", 250), // 100 ms
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

const davHeaders = (extra = {}) => ({
  Host: HOST,
  Authorization: `Basic ${encoding.b64encode(`davloom:${API_KEY}`)}`,
  ...extra,
});

const dav = (method, path, op, { body = null, headers = {}, expected = [200] } = {}) => {
  const response = http.request(method, `${BASE_URL}${path}`, body, {
    headers: davHeaders(headers),
    tags: { op },
    responseCallback: http.expectedStatuses(...expected),
  });
  check(response, {
    [`${op} answers ${expected.join(" or ")}`]: (r) => expected.includes(r.status),
  });
  return response;
};

export const setup = () => {
  if (!BASE_URL || !HOST || !API_KEY || !COOKIE) {
    fail("BASE_URL, HOST, API_KEY and COOKIE are required");
  }
  dav("MKCOL", ROOT, "setup", { expected: [201, 405] });
  return { content: "x".repeat(FILE_BYTES) };
};

export const webdav = ({ content }) => {
  // k6 numbers virtual users across scenarios, so each one makes its collection on its first run.
  const folder = `${ROOT}/vu-${exec.vu.idInTest}`;
  if (exec.vu.iterationInScenario === 0) {
    dav("MKCOL", folder, "setup", { expected: [201, 405] });
    for (let index = 0; index < SEEDED_FILES; index += 1) {
      dav("PUT", `${folder}/seed-${index}.txt`, "setup", { body: "seed", expected: [201, 204] });
    }
  }
  const name = `${folder}/i-${exec.vu.iterationInScenario}`;
  dav("PUT", `${name}.txt`, "put", { body: content, expected: [201, 204] });
  const read = dav("GET", `${name}.txt`, "get");
  check(read, { "get returns the bytes put": (r) => r.body.length === FILE_BYTES });
  dav("PROPFIND", folder, "propfind", { headers: { Depth: "1" }, expected: [207] });
  const locked = dav("LOCK", `${name}.txt`, "lock", {
    body: LOCK_BODY,
    headers: { "Content-Type": "application/xml", Timeout: "Second-60" },
  });
  const token = locked.headers["Lock-Token"] ?? "";
  dav("UNLOCK", `${name}.txt`, "unlock", { headers: { "Lock-Token": token }, expected: [204] });
  dav("MOVE", `${name}.txt`, "move", {
    headers: { Destination: `${BASE_URL}${name}.moved.txt`, Overwrite: "T" },
    expected: [201, 204],
  });
  // So the collection keeps its seeded size, and the listing measures the same work throughout.
  dav("DELETE", `${name}.moved.txt`, "delete", { expected: [204] });
};

const API_PATHS = [
  ["me", "/api/me"],
  ["overview", "/api/overview"],
  ["keys", "/api/keys"],
  ["mounts", "/api/mounts"],
];

export const api = () => {
  for (const [op, path] of API_PATHS) {
    const response = http.get(`${BASE_URL}${path}`, {
      headers: { Host: HOST, Cookie: COOKIE, Origin: `http://${HOST}` },
      tags: { op },
    });
    check(response, { [`${op} answers 200`]: (r) => r.status === 200 });
  }
};
