import { describe, expect, it } from "vitest";
import { crossSiteRefusal } from "./same-origin";

const JSON_TYPE = { "content-type": "application/json" };

const request = (url: string, method: string, headers: Record<string, string> = {}) =>
  new Request(url, { method, headers });

const codeOf = async (response: Response | undefined) =>
  response === undefined
    ? "allowed"
    : `${response.status} ${JSON.stringify(await response.json())}`;

const CROSS_SITE = `403 ${JSON.stringify({ error: { code: "cross_site" } })}`;
const NOT_JSON = `415 ${JSON.stringify({ error: { code: "unsupported_media_type" } })}`;

describe("crossSiteRefusal", () => {
  it.each([
    // [case, url, method, headers, configured origin, expected]
    [
      "a GET from anywhere",
      "https://d.example/api/keys",
      "GET",
      { origin: "https://evil.example" },
      undefined,
      "allowed",
    ],
    ["a HEAD", "https://d.example/api/me", "HEAD", {}, undefined, "allowed"],
    ["an OPTIONS", "https://d.example/api/keys", "OPTIONS", {}, undefined, "allowed"],
    [
      "a same-origin POST",
      "https://d.example/api/keys",
      "POST",
      { origin: "https://d.example", ...JSON_TYPE },
      undefined,
      "allowed",
    ],
    [
      "a POST from another site",
      "https://d.example/api/keys",
      "POST",
      { origin: "https://evil.example", ...JSON_TYPE },
      undefined,
      CROSS_SITE,
    ],
    [
      "a POST from a sibling subdomain",
      "https://d.example/api/keys",
      "POST",
      { origin: "https://x.d.example", ...JSON_TYPE },
      undefined,
      CROSS_SITE,
    ],
    [
      "a POST from another port",
      "https://d.example/api/keys",
      "POST",
      { origin: "https://d.example:8443", ...JSON_TYPE },
      undefined,
      CROSS_SITE,
    ],
    [
      "a POST from plain HTTP",
      "https://d.example/api/keys",
      "POST",
      { origin: "http://d.example", ...JSON_TYPE },
      undefined,
      CROSS_SITE,
    ],
    [
      "a POST with Origin null",
      "https://d.example/api/keys",
      "POST",
      { origin: "null", ...JSON_TYPE },
      undefined,
      CROSS_SITE,
    ],
    [
      "a POST with neither header",
      "https://d.example/api/keys",
      "POST",
      JSON_TYPE,
      undefined,
      CROSS_SITE,
    ],
    [
      "a POST that a browser marks same-origin",
      "https://d.example/api/keys",
      "POST",
      { "sec-fetch-site": "same-origin", ...JSON_TYPE },
      undefined,
      "allowed",
    ],
    [
      "a POST that a browser marks same-site",
      "https://d.example/api/keys",
      "POST",
      { "sec-fetch-site": "same-site", ...JSON_TYPE },
      undefined,
      CROSS_SITE,
    ],
    [
      "a POST that a browser marks cross-site",
      "https://d.example/api/keys",
      "POST",
      { "sec-fetch-site": "cross-site", ...JSON_TYPE },
      undefined,
      CROSS_SITE,
    ],
    [
      "a cross-site Origin with a same-origin Sec-Fetch-Site",
      "https://d.example/api/keys",
      "POST",
      { origin: "https://evil.example", "sec-fetch-site": "same-origin", ...JSON_TYPE },
      undefined,
      CROSS_SITE,
    ],
    [
      "a DELETE from another site",
      "https://d.example/api/keys/k1",
      "DELETE",
      { origin: "https://evil.example", ...JSON_TYPE },
      undefined,
      CROSS_SITE,
    ],
    [
      "a PATCH from another site",
      "https://d.example/api/mounts/m1",
      "PATCH",
      { origin: "https://evil.example", ...JSON_TYPE },
      undefined,
      CROSS_SITE,
    ],
    [
      "a PUT from another site",
      "https://d.example/api/settings/storage",
      "PUT",
      { origin: "https://evil.example", ...JSON_TYPE },
      undefined,
      CROSS_SITE,
    ],
    [
      "a sign-in from another site",
      "https://d.example/api/auth/sign-in/username",
      "POST",
      { origin: "https://evil.example", ...JSON_TYPE },
      undefined,
      CROSS_SITE,
    ],
    [
      "a registration from another site",
      "https://d.example/api/registration",
      "POST",
      { origin: "https://evil.example", ...JSON_TYPE },
      undefined,
      CROSS_SITE,
    ],
    [
      "a form post",
      "https://d.example/api/keys",
      "POST",
      { origin: "https://d.example", "content-type": "application/x-www-form-urlencoded" },
      undefined,
      NOT_JSON,
    ],
    [
      "a text/plain post",
      "https://d.example/api/verify",
      "POST",
      { origin: "https://d.example", "content-type": "text/plain" },
      undefined,
      NOT_JSON,
    ],
    [
      "a multipart post",
      "https://d.example/api/registration/import",
      "POST",
      { origin: "https://d.example", "content-type": "multipart/form-data; boundary=x" },
      undefined,
      NOT_JSON,
    ],
    [
      "a POST without Content-Type",
      "https://d.example/api/keys",
      "POST",
      { origin: "https://d.example" },
      undefined,
      NOT_JSON,
    ],
    [
      "JSON with a charset",
      "https://d.example/api/keys",
      "POST",
      { origin: "https://d.example", "content-type": "Application/JSON; charset=utf-8" },
      undefined,
      "allowed",
    ],
    [
      "a cross-site form post",
      "https://d.example/api/keys",
      "POST",
      { origin: "https://evil.example", "content-type": "text/plain" },
      undefined,
      CROSS_SITE,
    ],
    [
      "WebDAV, which API Keys and preflights guard",
      "https://d.example/dav/files/a.txt",
      "PUT",
      { origin: "https://evil.example" },
      undefined,
      "allowed",
    ],
    [
      "a Dashboard page",
      "https://d.example/keys",
      "POST",
      { origin: "https://evil.example" },
      undefined,
      "allowed",
    ],
    [
      "a path that only starts like /api",
      "https://d.example/apix",
      "POST",
      {},
      undefined,
      "allowed",
    ],
    [
      "the configured origin",
      "http://10.0.0.5:3000/api/keys",
      "POST",
      { origin: "https://files.example", ...JSON_TYPE },
      "https://files.example",
      "allowed",
    ],
    [
      "the request's own origin behind a configured one",
      "http://10.0.0.5:3000/api/keys",
      "POST",
      { origin: "http://10.0.0.5:3000", ...JSON_TYPE },
      "https://files.example",
      CROSS_SITE,
    ],
    [
      "a spoofed Host matching the Origin behind a configured one",
      "https://evil.example/api/keys",
      "POST",
      { origin: "https://evil.example", ...JSON_TYPE },
      "https://files.example",
      CROSS_SITE,
    ],
    [
      "HTTPS behind a TLS proxy",
      "http://d.example/api/keys",
      "POST",
      { origin: "https://d.example", "x-forwarded-proto": "https", ...JSON_TYPE },
      undefined,
      "allowed",
    ],
    [
      "HTTPS without a proxy that says so",
      "http://d.example/api/keys",
      "POST",
      { origin: "https://d.example", ...JSON_TYPE },
      undefined,
      CROSS_SITE,
    ],
  ] as const)("refuses or allows %s", async (_case, url, method, headers, configured, expected) => {
    expect(await codeOf(crossSiteRefusal(request(url, method, headers), configured))).toBe(
      expected,
    );
  });
});
