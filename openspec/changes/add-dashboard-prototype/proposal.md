# Proposal

## Why

On 2026-11-16 the owner asked to see the Dashboard before the API it will call exists, so that the pages in PRD §8 can be judged early, and asked for a black-and-white look in place of the colored neutral theme. Phases 1 to 3 have not built storage, the WebDAV protocol or credentials yet, so the pages run on sample data in the browser.

## What Changes

- Add the Dashboard shell from the PRD §13 Phase 4 deliverables: a side navigation with Overview, Files, Credentials, Storage & Mounts and Settings, which collapses behind a menu button on narrow screens.
- Add the five pages of PRD §8 on sample data. They send no request to the API, and the navigation says that the data are samples.
  - Overview: backends, mounts, objects, stored bytes, the WebDAV address and recent operation errors.
  - Files: browse, sort, search, upload, download, create folders, rename, move, copy, delete one or many items, details and text preview, and the loading, empty, not-found and unreachable states.
  - Credentials: create a key that is shown once, scope it to a mount or folder, make it read only, set when it expires, and revoke it.
  - Storage & Mounts: backends with their status and a connection check; add, edit and remove mounts.
  - Settings: profile, sign-in and security, appearance, how WebDAV clients connect, the default backend for new mounts, data export and instance information.
- Keep the rules that stand in for the server's answers in their own TypeScript modules, and check their laws with fast-check property tests.
- Move keyboard focus to the control that takes the place of one that a change removes, and back to the control that opened a dialog once the dialog closes.
- Make the Davloom Theme black, white and grays in light and dark mode. Statuses differ by icon and words instead of hue, and their lightness ranks them. Selected text, spelling marks and the controls the browser draws are gray too.
- Declare light and dark to the browser, set the scheme in use on the root element before the first paint, apply an appearance change to every open tab, and move the appearance control into Settings.
- Replace the placeholder root page with Overview. `/design-check` stays outside the shell for the compatibility tests.
- Add `lucide-react` as a direct dependency of `apps/web` for icons, and `fast-check` as a dev dependency for the property tests.

Out of scope: calls to the management API or to WebDAV, which wait for Phases 1 to 3; TanStack Virtual for large listings, which needs real listings to measure; real downloads and sign-in; and browser tests for most page flows, which follow the owner's review of the prototype (design.md, Decision 6).

## Capabilities

### New Capabilities

- `dashboard-navigation`: how the Dashboard's pages are reached and identified, where keyboard focus goes after a change, and how the prototype marks its data as samples.
- `dashboard-overview`: the one-page summary of storage, mounts, the WebDAV address and recent errors.
- `dashboard-file-explorer`: browsing a mount and changing what it holds.
- `dashboard-credentials`: the API keys that WebDAV clients sign in with.
- `dashboard-storage-mounts`: storage backends and the mounts that publish them.
- `dashboard-settings`: account, appearance, WebDAV and storage settings, data export and instance information.

### Modified Capabilities

- `dashboard-appearance`: adds the black, white and gray palette, the color schemes the page declares and the one its root uses, and appearance changes that reach every open tab.

## Impact

- Code: `apps/web/src/routes` (a pathless `_dashboard` layout and five routes; the old root page is removed), `apps/web/src/features`, `apps/web/src/router.tsx`, `packages/ui/src/tokens` and the regenerated `packages/ui/src/themes`, plus unit tests for the theme and the stand-in rules and browser tests for appearance and navigation.
- Dependencies: `lucide-react` 1.73.0 and `fast-check` 4.10.2, the npm `latest` versions. `bun.lock` already held `lucide-react` 1.69.0 for `@astryxdesign/theme-neutral` (`^1.66.0`), and that entry moves to 1.73.0, so both use one copy.
- APIs and servers: none change. Workers and Bun serve the same static build.
- Approvals: the owner asked for the prototype and the black-and-white theme in chat. The phases and scope in `prd.md` do not change, and no law is added to `LAWS.bend`. Keeping the stand-in rules in TypeScript is an exception to PRD §4 that the owner decides (design.md, Decision 2); the pull request waits for that decision in chat.
