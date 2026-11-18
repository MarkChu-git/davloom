# Proposal

## Why

On 2026-11-16 the owner asked to see the Dashboard before the API it will call exists, so that the pages in PRD §8 can be judged early, and asked for a black-and-white look in place of the colored neutral theme. Phases 1 to 3 have not built storage, the WebDAV protocol or credentials yet, so the pages run on sample data in the browser. On 2026-11-17 the owner reviewed the prototype and asked for a side navigation after Linear's that can be resized and folded, an Overview that shows its figures as charts, no explanatory or defensive text, and color wherever it belongs, with gray and white as the main colors. Looking at it on a phone, the owner then asked for the navigation to drop down from a menu there and for every layout to fit a phone.

## What Changes

- Add the Dashboard shell from the PRD §13 Phase 4 deliverables: a side navigation with Overview, Files, Credentials, Storage & Mounts and Settings, which can be dragged wider or narrower, folds to a rail of icons, and on a phone drops down from a Menu button in a bar across the top. It shares one grid with every page: the same gutter, the brand on the line of each page's title, and its first link where each page's content starts. Every page fits a window from 320 px wide up: where a table lacks room for a column each, keys and mounts become rows of one shape and Files moves its details into one cell, and buttons beside a title show only their icons where their words do not fit. On a touch screen a chart shows its values while a finger holds it.
- Add the five pages of PRD §8 on sample data. They send no request to the API.
  - Overview: tiles for the bytes and objects stored, the known capacity in use and the mounts; charts of operations per hour and of the bytes on each backend; connection status with each backend's mounts; the WebDAV address; and recent operation errors.
  - Files: browse, sort, search, upload, download, create folders, rename, move, copy, delete one or many items, details and text preview, and the loading, empty, not-found and unreachable states.
  - Credentials: create a key that is shown once, scope it to a mount or folder, make it read only, set when it expires, and revoke it.
  - Storage & Mounts: backends with their status and a connection check; add, edit and remove mounts.
  - Settings: profile, sign-in and security, appearance, how WebDAV clients connect, the default backend for new mounts, data export and instance information.
- Keep the rules that stand in for the server's answers in their own TypeScript modules, and check their laws with fast-check property tests.
- Move keyboard focus to the control that takes the place of one that a change removes, and back to the control that opened a dialog once the dialog closes.
- Leave out explanatory and defensive text, such as page and field descriptions, placeholders, notes and warnings, and keep labels, values, statuses, errors with their reasons and one sentence of consequence in each confirmation.
- Make the Davloom Theme gray and white in light and dark mode, with hues only for statuses: errors red, warnings amber, success green and information blue, which destructive actions and the chart's failed hours share. Statuses keep their icons and words. Selected text and the controls the browser draws are gray, and spelling and grammar marks take the error and information colors.
- Declare light and dark to the browser, set the scheme in use on the root element before the first paint, apply an appearance change to every open tab, and move the appearance control into Settings.
- Replace the placeholder root page with Overview. `/design-check` stays outside the shell for the compatibility tests.
- Add `lucide-react` as a direct dependency of `apps/web` for icons, `@tanstack/charts` and `d3-shape` for the Overview's charts, `d3-scale` and `@lucide/icons` for the scale and the pictures of the errors timeline, and `fast-check` as a dev dependency for the property tests.

Out of scope: calls to the management API or to WebDAV, which wait for Phases 1 to 3; TanStack Virtual for large listings, which needs real listings to measure; real downloads and sign-in; and browser tests for most page flows, which follow the owner's review of the prototype (design.md, Decision 6).

## Capabilities

### New Capabilities

- `dashboard-navigation`: how the Dashboard's pages are reached and identified, how the side navigation resizes and folds, where keyboard focus goes after a change, and how the prototype keeps to sample data.
- `dashboard-overview`: the one-page summary of storage, operations, connections, mounts, the WebDAV address and recent errors, with charts.
- `dashboard-file-explorer`: browsing a mount and changing what it holds.
- `dashboard-credentials`: the API keys that WebDAV clients sign in with.
- `dashboard-storage-mounts`: storage backends and the mounts that publish them.
- `dashboard-settings`: account, appearance, WebDAV and storage settings, data export and instance information.

### Modified Capabilities

- `dashboard-appearance`: adds the gray and white palette with its status colors, the color schemes the page declares and the one its root uses, and appearance changes that reach every open tab.

## Impact

- Code: `apps/web/src/routes` (a pathless `_dashboard` layout and five routes; the old root page is removed), `apps/web/src/features`, `apps/web/src/router.tsx`, `packages/ui/src/tokens` and the regenerated `packages/ui/src/themes`, plus unit tests for the theme and the stand-in rules and browser tests for appearance and navigation.
- Dependencies: `lucide-react` 1.74.0 and `fast-check` 4.10.2, the npm `latest` versions. `bun.lock` already held `lucide-react` 1.69.0 for `@astryxdesign/theme-neutral` (`^1.66.0`), and that entry moves to 1.74.0, so both use one copy. `@tanstack/charts` 1.5.0 and `d3-shape` 3.2.1, with `@types/d3-shape` 3.2.0 as a dev dependency, are npm `latest` too, and `bun.lock` gains the D3 modules they pin. The errors timeline adds `d3-scale` 4.0.3 with `@types/d3-scale` 4.0.9, which brings `@types/d3-time` 3.0.4, and `@lucide/icons` 1.74.0, each the npm `latest` version (design.md, Decision 8).
- APIs and servers: none change. Workers and Bun serve the same static build.
- Approvals: the owner asked in chat for the prototype and the black-and-white theme, and after the review for the side navigation, the charts, TanStack Charts by name, the removal of explanatory text, color for statuses, and a dropdown navigation and layouts that fit a phone. The phases and scope in `prd.md` do not change, and no law is added to `LAWS.bend`. Keeping the stand-in rules in TypeScript is an exception to PRD §4 that the owner decides (design.md, Decision 2); the pull request waits for that decision in chat.
