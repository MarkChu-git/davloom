import { type ActionEffect } from "@davloom/laws";

// Which verification each management action asks for (PRD §6). Every route of the management API,
// and every path of Better Auth that the Dashboard may reach, names the effect of its action here;
// packages/laws (verification.bend) turns the effect into none, confirm or step-up and proves that
// no step-up action runs without a fresh verification. A route missing from these tables is
// refused: app.test.ts checks that every route of the app has an entry.
//
// To add a route: add `"METHOD /path/:param": "<effect>"` below, with the route's own pattern as
// Elysia declares it. A route that a visitor without a session uses is "public". The Dashboard
// needs nothing more: its requests repeat themselves after a step-up (features/api/stepUp.ts).

/** An action's effect, or `public` for a route that serves visitors without a session. */
export type RouteEffect = ActionEffect | "public";

/** The management API's routes, as `METHOD pattern`. */
export const API_ACTIONS: Readonly<Record<string, RouteEffect>> = {
  "GET /api/health": "public",
  "GET /api/registration": "public",
  "POST /api/registration": "public",
  // Only an instance without an owner imports; there is nobody to verify yet.
  "POST /api/registration/import": "public",
  "POST /api/verify": "public",
  "GET /api/me": "read",
  "GET /api/overview": "read",
  "POST /api/export": "disclose",
  "GET /api/keys": "read",
  "POST /api/keys": "credential",
  "DELETE /api/keys/:id": "credential",
  "GET /api/backends": "read",
  // A backend holds the secret key of its S3-compatible store.
  "POST /api/backends": "credential",
  "PATCH /api/backends/:id": "credential",
  "DELETE /api/backends/:id": "destroy",
  "PUT /api/settings/default-backend": "destroy",
  "GET /api/mounts": "read",
  "POST /api/mounts": "change",
  // Renaming or retargeting a Mount changes what every key limited to it reaches.
  "PATCH /api/mounts/:id": "destroy",
  "DELETE /api/mounts/:id": "destroy",
};

/**
 * Better Auth's paths under /api/auth that the Dashboard uses. Every other path of Better Auth,
 * such as the API Key plugin's own routes, is refused, so Davloom's own checks cannot be passed by.
 */
export const AUTH_ACTIONS: Readonly<Record<string, RouteEffect>> = {
  "/ok": "public",
  "/get-session": "public",
  "/sign-in/email": "public",
  "/sign-in/username": "public",
  "/two-factor/verify-totp": "public",
  "/two-factor/verify-backup-code": "public",
  "/passkey/generate-authenticate-options": "public",
  "/passkey/verify-authentication": "public",
  "/sign-out": "end-self",
  "/list-sessions": "read",
  "/passkey/list-user-passkeys": "read",
  "/passkey/update-passkey": "change",
  // A display name alone is a change; a username or an email is a credential (updateUserEffect).
  "/update-user": "change",
  "/change-password": "credential",
  "/two-factor/enable": "credential",
  "/two-factor/disable": "credential",
  "/two-factor/get-totp-uri": "credential",
  "/two-factor/generate-backup-codes": "credential",
  "/passkey/generate-register-options": "credential",
  "/passkey/verify-registration": "credential",
  "/passkey/delete-passkey": "credential",
  "/revoke-session": "credential",
  "/revoke-sessions": "credential",
  "/revoke-other-sessions": "credential",
};

/** The effect of an API route, or undefined for one nobody classified. */
export const apiEffect = (method: string, route: string): RouteEffect | undefined =>
  API_ACTIONS[`${method.toUpperCase()} ${route}`];

/** The effect of a Better Auth path, below /api/auth, or undefined for one Davloom refuses. */
export const authEffect = (path: string): RouteEffect | undefined =>
  Object.hasOwn(AUTH_ACTIONS, path) ? AUTH_ACTIONS[path] : undefined;

/** Changing the username or the email changes how the owner signs in. */
export const updateUserEffect = (body: unknown): ActionEffect =>
  typeof body === "object" &&
  body !== null &&
  ["username", "displayUsername", "email"].some((field) => field in body)
    ? "credential"
    : "change";

/**
 * The effect of a WebDAV request the Dashboard makes with its session. API Keys are limited by
 * their access level instead (packages/laws policy.bend), since a WebDAV client cannot step up.
 */
export const davEffect = (method: string, overwrite: string | null): ActionEffect => {
  switch (method.toUpperCase()) {
    case "GET":
    case "HEAD":
    case "OPTIONS":
    case "PROPFIND":
      return "read";
    case "DELETE":
    // An UNLOCK by the Dashboard can end another client's lock.
    case "UNLOCK":
      return "destroy";
    case "COPY":
    case "MOVE":
      // RFC 4918 §10.6: without `Overwrite: F` the destination is replaced.
      return overwrite?.trim().toUpperCase() === "F" ? "change" : "destroy";
    default:
      return "change";
  }
};
