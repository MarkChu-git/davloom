import { LayerProvider } from "@astryxdesign/core/Layer";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCanceledAnimations } from "../../test/layout";
import { json, renderPage, type Handler } from "../../test/render";
import { translator } from "../i18n/translate";
import { describeEvent, eventDetails, type AuditEvent } from "./ActivitySection";
import { SettingsPage } from "./SettingsPage";

// Settings, Activity: the audit trail, a page at a time.

handleCanceledAnimations();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const en = translator("en");
const zh = translator("zh-CN");

const event = (id: string, extra: Partial<AuditEvent> = {}): AuditEvent => ({
  id,
  at: "2026-11-24T08:00:00.000Z",
  action: "sign-in",
  outcome: "success",
  address: null,
  target: "password",
  count: 1,
  ...extra,
});

const show = (api: Record<string, Handler>) =>
  renderPage(
    <LayerProvider>
      <SettingsPage section="activity" />
    </LayerProvider>,
    { path: "/settings?section=activity", api },
  );

describe("describeEvent", () => {
  it.each([
    [{ action: "sign-in" }, "Signed in with the password"],
    [{ action: "sign-in", outcome: "failure" }, "Refused a sign-in with the password"],
    [{ action: "sign-in", target: "passkey" }, "Signed in with a passkey"],
    [{ action: "sign-in", target: null }, "Signed in"],
    [{ action: "sign-out", target: null }, "Signed out"],
    [{ action: "registration" }, "Registered the owner"],
    [{ action: "registration", outcome: "failure" }, "Refused a registration"],
    [{ action: "import" }, "Imported an export"],
    [{ action: "import", outcome: "failure" }, "Refused an import"],
    [{ action: "export" }, "Exported the instance"],
    [{ action: "step-up" }, "Verified again"],
    [{ action: "step-up", outcome: "failure" }, "Refused a verification"],
    [{ action: "step-up", outcome: "locked" }, "Locked verification"],
    [{ action: "password" }, "Changed the password"],
    [{ action: "email" }, "Changed the email"],
    [{ action: "two-factor", target: "enabled" }, "Turned on two-step verification"],
    [{ action: "two-factor", target: "disabled" }, "Turned off two-step verification"],
    [{ action: "two-factor", target: "backup codes" }, "Made new backup codes"],
    [{ action: "two-factor", target: null }, "Changed two-step verification"],
    [{ action: "passkey", target: "added" }, "Added a passkey"],
    [{ action: "passkey", target: "renamed" }, "Renamed a passkey"],
    [{ action: "passkey", target: "removed" }, "Removed a passkey"],
    [{ action: "passkey", target: "x" }, "Changed a passkey"],
    [{ action: "sessions", target: "one" }, "Signed out a session"],
    [{ action: "sessions", target: "all" }, "Signed out every session"],
    [{ action: "sessions", target: "others" }, "Signed out the other sessions"],
    [{ action: "sessions", target: null }, "Signed out sessions"],
    [{ action: "key.create", target: "laptop" }, "Created the key laptop"],
    [{ action: "key.create", target: null }, "Created the key"],
    [{ action: "key.rename", target: "phone" }, "Renamed a key to phone"],
    [{ action: "key.revoke", target: "id-1" }, "Revoked a key"],
    [{ action: "backend.create", target: "S3" }, "Added the backend S3"],
    [{ action: "backend.edit", target: "S3" }, "Changed the backend S3"],
    [{ action: "backend.remove", target: "id" }, "Removed a backend"],
    [{ action: "mount.create", target: "photos" }, "Created the mount photos"],
    [{ action: "mount.edit", target: "photos" }, "Changed a mount"],
    [{ action: "mount.remove", target: "id" }, "Removed a mount"],
    [{ action: "settings", target: "default backend" }, "Changed the default backend"],
    [{ action: "webdav.auth", outcome: "failure" }, "Refused a WebDAV key"],
    [{ action: "later.action" }, "later.action"],
  ] as const)("describes %j as %s", (extra, text) => {
    expect(describeEvent(en, event("e", extra))).toBe(text);
  });
});

describe("eventDetails", () => {
  it.each([
    [{}, /^Nov 24, 2026/],
    [{ address: "203.0.113.5" }, / · 203\.0\.113\.5$/],
    [{ action: "webdav.auth", target: "dav_abcdef", count: 1200 }, / · dav_abcdef… · 1,200 times$/],
    [{ action: "webdav.auth", target: null, count: 2 }, /^[^·]+ · 2 times$/],
    [{ count: 1 }, /^[^·]+$/],
  ] as const)("writes %j", (extra, pattern) => {
    expect(eventDetails(en, event("e", extra))).toMatch(pattern);
  });

  it("writes them in Chinese", () => {
    expect(describeEvent(zh, event("e", { action: "key.rename", target: "phone" }))).toBe(
      "将密钥重命名为 phone",
    );
    expect(describeEvent(zh, event("e", { action: "webdav.auth", outcome: "failure" }))).toBe(
      "拒绝了一个 WebDAV 密钥",
    );
    expect(eventDetails(zh, event("e", { action: "webdav.auth", target: null, count: 2 }))).toMatch(
      /^2026年11月24日/,
    );
  });
});

describe("Settings, Activity", () => {
  it("lists the events, marks the refused ones, and reads the next page", async () => {
    const { calls } = await show({
      "GET /api/audit": (request) =>
        new URL(request.url).searchParams.get("before") === null
          ? json({
              events: [
                event("a", { outcome: "failure", address: "198.51.100.9" }),
                event("b", { action: "step-up", outcome: "locked", target: null }),
              ],
              next: "1.b",
            })
          : json({ events: [event("c", { action: "export", target: null })], next: null }),
    });
    expect(await screen.findByText("Refused a sign-in with the password")).toBeTruthy();
    expect(screen.getByText("Locked verification")).toBeTruthy();
    expect(screen.getByText("Refused")).toBeTruthy();
    expect(screen.getByText("Locked")).toBeTruthy();
    expect(screen.getByText(/198\.51\.100\.9/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Exported the instance")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    const reads = calls.filter((call) => new URL(call.url).pathname === "/api/audit");
    expect(reads.map((call) => new URL(call.url).search)).toEqual([
      "?limit=50",
      "?limit=50&before=1.b",
    ]);
  });

  it("says when there is no activity", async () => {
    await show({ "GET /api/audit": () => json({ events: [], next: null }) });
    expect(await screen.findByText("No activity yet")).toBeTruthy();
  });

  it("says when the activity cannot be read", async () => {
    await show({ "GET /api/audit": () => json({ error: { code: "x" } }, 500) });
    expect(await screen.findByText("Cannot read the activity")).toBeTruthy();
  });
});
