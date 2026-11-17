# Tasks

## 1. Theme and appearance

- [x] 1.1 Add `packages/ui/src/tokens/monochrome.ts`, assign its grays to the accent, status, categorical, syntax, inset ring, inverted background and track tokens in `davloom-source.ts`, and rebuild the theme with `bun run --filter @davloom/ui build:theme` (Decision 3). Verify that `packages/ui/src/themes/davloom.test.ts` passes, including the table that shows its parser flags each sample hue, that `packages/ui/src/tokens/monochrome.test.ts` passes, which checks that the status grays keep their ranking in both modes, and that `bun run check` passes its generated-theme step
- [x] 1.2 Declare `light dark` in a `color-scheme` meta element that never changes, set the root's `color-scheme` from the first-paint script and the appearance store, make the store follow `storage` events from other tabs, and keep selection, spelling marks, native controls and autofill gray in `globals.css` (Decisions 3 and 7). Verify that the "Choosing a mode", "First paint" and "Two open tabs" tests in `tests/integration/compat/ui/appearance.spec.ts` and the "Selected text and spelling marks" test in `dashboard.spec.ts` pass on Bun and on Workers, alongside the existing appearance tests, and, by hand, that "First paint" fails when the script moves into `<body>` and that "Choosing a mode" and "Two open tabs" fail without the store's write of the scheme. The autofill rule has no test, because only the browser's own autofill applies it
- [x] 1.3 Scan the computed colors of the 40 page states that Decision 6 lists, among them every page and Settings section and the dialogs, menus, option lists and confirmations they open, in light and in dark mode (Decision 6). Verify that the "Rendered pages" tests in `tests/integration/compat/ui/dashboard.spec.ts` pass on Bun and on Workers, and that the two "Rendered pages" tests that put hues on a page on purpose pass: the scan reports each hue, in pseudo-elements, shadows, filters and gradients, in SVG data URLs as hex values, color functions or color names, in Lab, OKLCH and Display P3 notation, as a colored spelling mark, as a checkbox left to the browser's accent color and in a notation the scan does not parse, and no gray

- [x] 1.4 Build the page in layers of gray in `monochrome.ts`, with low, medium and high shadows and the low one under cards without an elevation (Decision 3). Verify that `packages/ui/src/tokens/monochrome.test.ts` passes against the new backgrounds in both modes and that the "Rendered pages" tests pass on Bun and on Workers

## 2. Shell and sample data

- [x] 2.1 Add the pathless `_dashboard` layout route with the Astryx AppShell, the side navigation and `RouterLink`, put Overview at `/`, keep `/design-check` outside the shell, and read and write search parameters as plain text (Decision 4). Verify that the "Moving between pages", "Titles and headings" and "Narrow screens" tests pass and that the existing UI compatibility tests still pass
- [x] 2.2 Add the sample data with its fixed clock, the stores that keep a visit's changes, and the "Prototype, sample data" label in the navigation (Decision 1). Verify that the "No requests to the API" and "Changes last for the visit" tests pass
- [x] 2.3 Keep route search validation free of page imports by moving the Settings sections into `features/settings/sections.ts` (Decision 4). Verify that the production build prints no chunk size warning and that its entry chunk, `assets/index-*.js`, is 320 kB as Vite prints it before gzip, against 382 kB on `main`
- [x] 2.4 Add `lucide-react` 1.73.0 to `apps/web`, which moves the lockfile's one `lucide-react` entry from 1.69.0 to 1.73.0 (Decision 8). Verify that `bun install --frozen-lockfile` reports no changes and that `bun.lock` lists one `lucide-react` package

- [x] 2.5 Restyle the side navigation after Linear, as the owner asked after reviewing the prototype: the Davloom mark, compact rows under no heading and under Manage, the current page in semibold with a heavier icon, the storage status glyph after Storage & Mounts, and the sample-data note at the foot (Decision 11). Verify that the "Moving between pages", "Storage status in the navigation" and "Narrow screens" tests pass on Bun and on Workers, and by hand at 1280 px and 375 px, collapsed and in both modes, that the navigation shows each part

## 3. Pages

- [x] 3.1 Build the Overview: summary tiles, connection status with Check connections, the WebDAV address with Copy address, and recent operation errors. Verify by hand in the production build, at 1280 px and 375 px wide and in both modes, that every scenario in `specs/dashboard-overview/spec.md` holds
- [x] 3.2 Build Files: browsing by address, the top level with Manage mounts, sorting with folders first, search with announcements, details beside the list or in a dialog, long names, the loading, empty, not-found and unreachable states, naming, move and copy between mounts, delete, upload with its refusals, and download. Verify by hand in the same way that every scenario in `specs/dashboard-file-explorer/spec.md` holds, including the switch to a dialog at 1024 px
- [x] 3.3 Build Credentials: the key list with its Active, Expired and Revoked states, the creation form and its folder check, the key shown once in the same dialog, and revocation. Verify by hand in the same way that every scenario in `specs/dashboard-credentials/spec.md` holds
- [x] 3.4 Build Storage & Mounts: backend cards with Verify connection, the mount form that starts with the default backend, and mount removal. Verify by hand in the same way that every scenario in `specs/dashboard-storage-mounts/spec.md` holds
- [x] 3.5 Build Settings with its seven sections, the `section` search parameter, the selector at 1024 px and below, and a profile and default backend that last for the visit. Verify by hand in the same way that every scenario in `specs/dashboard-settings/spec.md` holds
- [x] 3.6 Run `bunx --bun astryx doctor --built apps/web` and re-read each page for raw elements and hard-coded colors or sizes. Verify that doctor reports no failure, and that its only source findings are the ones Decision 9 explains
- [x] 3.7 Add `fast-check` 4.10.2 to `apps/web` and property tests for the stand-in rules in `tree.test.ts`, `mountStore.test.ts`, `keyState.test.ts`, `scope.test.ts` and `uploadStore.test.ts` (Decisions 2 and 8). Verify that `bun run test` passes them, that the move and copy properties fail when too few generated transfers succeed, and, by hand, that each property fails when the rule it covers is broken on purpose
- [x] 3.8 Move focus to the control that takes the place of a removed one with `refocusIfLost`, send it back to the control that opened a dialog with `useFormDialog`, or to the search field when a search hides the name a dialog just gave, and give assistive technology a file's whole name (Decisions 9 and 10). Verify that the "Deleting a row", "Closing a file's details", "Removing a mount", "Signing out a session", "Closing a dialog", "Clearing a selection", "Clearing finished uploads", "A new name the search hides" and "The name a screen reader hears" tests pass on Bun and on Workers
- [x] 3.9 Start each dialog form from its own values, refuse a key folder with a `.` or `..` segment through `scopeOf`, which drops the spaces around each segment, and refuse a profile without a display name or with an email address without an @ (Decisions 2 and 10). Verify that the "Opening the form again", "Opening the name dialog again", "A folder outside the mount" and "A profile without a name" tests pass on Bun and on Workers

## 4. Browser tests for the page flows

- [ ] 4.1 Once the owner has reviewed the prototype, add a Playwright test, named after its scenario, for every other scenario in the specs of the Overview, Files, Credentials, Storage & Mounts and Settings (Decision 6). Verify that each of those scenarios has a test and that `bun run test:compat` passes on Bun and on Workers

## 5. Integration

- [x] 5.1 Run `bun install --frozen-lockfile`, `bun run check` and `bun run test:compat` in a clean export of the branch head, with a logging `node` first on `PATH`. Verify that each exits with status 0, and that `bun run check` and `bun run test:compat` make no Node call

## Workflow follow-up

- The owner decides the PRD §4 exception in Decision 2 before the pull request merges.
- Archive the change after the owner has reviewed the prototype and group 4 is done.
