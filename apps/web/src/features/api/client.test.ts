import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  api,
  apiCall,
  apiCallOnce,
  authFetch,
  describeError,
  errorCodeOf,
  isUnauthorized,
} from "./client";
import { translator } from "../i18n/translate";
import { DavError } from "./dav";

const en = translator("en");
const zh = translator("zh-CN");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("error codes", () => {
  it.each([
    [409, { error: { code: "name_taken" } }, "name_taken"],
    [401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "x" }, "invalid_email_or_password"],
    [401, null, "unauthorized"],
    [500, "plain text", "http_500"],
    [404, { error: "x" }, "http_404"],
  ])("%d with %j is %s", (status, body, code) => {
    expect(errorCodeOf(status, body)).toBe(code);
  });

  it.each([
    ["network_error", 0, "could not be reached"],
    ["unauthorized", 401, "Sign in again"],
    ["not_configured", 503, "DAVLOOM_SECRET"],
    ["name_taken", 409, "already in use"],
    ["not_found", 404, "no longer there"],
    ["invalid_input", 400, "Check the values"],
    ["backend_in_use", 409, "A mount uses this backend"],
    ["backend_not_empty", 409, "still holds files"],
    ["backend_unavailable", 503, "did not answer"],
    ["verification_locked", 429, "Wait 15 minutes"],
    ["setup_token_invalid", 403, "setup token"],
    ["cross_site", 403, "own address"],
    ["unsupported_media_type", 415, "format"],
    ["http_501", 501, "does not run the management API"],
    ["http_500", 500, "(500)"],
  ])("%s says %s", (code, status, words) => {
    expect(describeError(en, new ApiError(status, code))).toContain(words);
  });

  it("anything else asks to try again", () => {
    expect(describeError(en, new Error("boom"))).toBe("Something went wrong. Try again.");
  });

  it.each([
    ["network_error", 0, "无法连接"],
    ["name_taken", 409, "已被使用"],
    ["http_500", 500, "（500）"],
  ])("%s says %s in Chinese", (code, status, words) => {
    expect(describeError(zh, new ApiError(status, code))).toContain(words);
  });

  it.each([
    "cross_site",
    "archive_invalid",
    "username_refused",
    "password_refused",
    "email_refused",
    "password_compromised",
    "invalid_display_username",
  ])("%s gives the API's own explanation in English, and its own words otherwise", (code) => {
    expect(describeError(en, new ApiError(400, code, "Because."))).toBe("Because.");
    expect(describeError(zh, new ApiError(400, code, "Because."))).not.toContain("Because");
    expect(describeError(en, new ApiError(400, code))).not.toBe("");
  });

  it.each([
    ["username_refused", "too_short", "too short", "用户名太短"],
    ["username_refused", "too_long", "too long", "用户名太长"],
    ["username_refused", "invalid_characters", "letters, digits", "只能包含字母"],
    ["username_refused", "taken", "already taken", "已被占用"],
    ["password_refused", "too_short", "at least 12", "至少使用 12 个字符"],
    ["password_refused", "too_long", "at most 128", "最多可用 128 个字符"],
    ["password_refused", "compromised", "data breaches", "数据泄露"],
    ["email_refused", "invalid", "not a valid email", "不是有效的电子邮件地址"],
    ["email_refused", "taken", "Another account", "其他账户"],
  ])("%s for %s says why in English and Chinese", (code, reason, english, chinese) => {
    const error = new ApiError(400, code, "Better Auth's words.", reason);
    expect(describeError(en, error)).toContain(english);
    expect(describeError(zh, error)).toContain(chinese);
    expect(describeError(zh, error)).not.toContain("Better Auth");
  });

  it.each([
    ["username_refused", "invalid", "Check the username", "请检查用户名"],
    ["password_refused", "something_new", "Check the password", "请检查密码"],
    ["email_refused", "toString", "Check the email", "请检查电子邮件地址"],
    ["password_refused", "invalid", "Check the password", "请检查密码"],
  ])("%s for %s falls back to the general message", (code, reason, english, chinese) => {
    expect(describeError(en, new ApiError(400, code, undefined, reason))).toContain(english);
    expect(describeError(zh, new ApiError(400, code, "Words.", reason))).toContain(chinese);
  });

  it.each([
    ["password_too_short", "at least 12", "至少使用 12 个字符"],
    ["password_too_long", "at most 128", "最多可用 128 个字符"],
    ["username_too_short", "too short", "用户名太短"],
    ["username_too_long", "too long", "用户名太长"],
    ["invalid_username", "letters, digits", "只能包含字母"],
    ["username_is_already_taken", "already taken", "已被占用"],
    ["invalid_email", "not a valid email", "不是有效的电子邮件地址"],
    ["user_already_exists", "Another account", "其他账户"],
    ["user_already_exists_use_another_email", "Another account", "其他账户"],
  ])("Better Auth's %s says why in both languages", (code, english, chinese) => {
    expect(describeError(en, new ApiError(400, code, "Better Auth's words."))).toContain(english);
    expect(describeError(zh, new ApiError(400, code, "Better Auth's words."))).toContain(chinese);
  });

  it("reads the reason of a refusal from the API's answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: { code: "password_refused", message: "Password too short", reason: "too_short" },
          },
          { status: 400 },
        ),
      ),
    );
    const error: unknown = await apiCallOnce(() =>
      api.registration.post({ email: "a@example.com", name: "A", password: "short" }),
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "password_refused", reason: "too_short" });
    expect(describeError(zh, error)).toBe("密码太短，请至少使用 12 个字符。");
  });

  it("keeps the API's own English explanation out of a Chinese message", () => {
    const error = new ApiError(400, "archive_invalid", "The file is not JSON.");
    expect(describeError(en, error)).toContain("The file is not JSON.");
    expect(describeError(zh, error)).not.toContain("The file is not JSON.");
  });
});

describe("calls", () => {
  it("sends JSON with the session cookie and reads JSON back", async () => {
    const fetch = vi.fn(async () => Response.json({ id: "k", key: "dav_k" }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await expect(apiCall(() => api.keys.post({ name: "a" }))).resolves.toEqual({
      id: "k",
      key: "dav_k",
    });
    expect(fetch).toHaveBeenCalledWith("/api/keys", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: '{"name":"a"}',
    });
  });

  it("puts a route's parameters in its path, encoded", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ id: "a b" }));
    vi.stubGlobal("fetch", fetch);
    await apiCall(() => api.mounts({ id: "a b/c" }).patch({ name: "x" }));
    await apiCall(() => api.backends({ id: "b1" }).verify.post());
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/mounts/a%20b%2Fc",
      "/api/backends/b1/verify",
    ]);
  });

  it("keeps the dates of an answer as the strings the API sent", async () => {
    const mount = {
      id: "m",
      name: "files",
      backendId: "b",
      backendKind: "durable-object",
      root: "",
      createdAt: "2026-11-24T08:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([mount])),
    );
    await expect(apiCall(() => api.mounts.get())).resolves.toEqual([mount]);
  });

  it("sends the audit trail's query parameters", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ events: [], next: null }),
    );
    vi.stubGlobal("fetch", fetch);
    await apiCall(() => api.audit.get({ query: { limit: "50", before: "a&b" } }));
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/audit?limit=50&before=a%26b");
  });

  it("an empty answer from Better Auth is null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    await expect(authFetch("/api/auth/x")).resolves.toBeNull();
  });

  it.each([
    ["the typed client", () => apiCall(() => api.me.get())],
    ["Better Auth", () => authFetch("/api/auth/get-session")],
  ])("a refusal through %s throws its status and code", async (_, call) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: { code: "unauthorized" } }, { status: 401 })),
    );
    const error: unknown = await call().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "unauthorized" });
    expect(isUnauthorized(error)).toBe(true);
    expect(isUnauthorized(new DavError(401))).toBe(true);
    expect(isUnauthorized(new DavError(403))).toBe(false);
  });

  it.each([
    [422, { error: { code: "archive_invalid", message: "The file is not JSON." } }],
    [400, { code: "INVALID_USERNAME", message: "The file is not JSON." }],
  ])("a %d refusal keeps the API's explanation", async (status, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body, { status })),
    );
    const error: unknown = await apiCall(() => api.registration.import.post({})).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ status, detail: "The file is not JSON." });
  });

  it("a refusal without a body is named by its status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    await expect(apiCall(() => api.me.get())).rejects.toMatchObject({ code: "unauthorized" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Bad gateway", { status: 502 })),
    );
    await expect(apiCall(() => api.me.get())).rejects.toMatchObject({ code: "http_502" });
  });

  it.each([
    ["the typed client", () => apiCall(() => api.me.get())],
    ["Better Auth", () => authFetch("/api/auth/get-session")],
  ])("a dropped connection through %s is a network error", async (_, call) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(call()).rejects.toMatchObject({ status: 0, code: "network_error" });
  });

  it("an answer that says it is JSON and is not counts as a broken connection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html>", { headers: { "content-type": "application/json" } }),
      ),
    );
    await expect(apiCall(() => api.me.get())).rejects.toMatchObject({ code: "network_error" });
  });
});
