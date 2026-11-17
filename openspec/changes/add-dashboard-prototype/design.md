# Design

## Context

See proposal.md for the motivation and the specs for the behavior.

Phase 0 left `apps/web` as a TanStack Start SPA with the Davloom Theme built on `@astryxdesign/theme-neutral`, a placeholder root page, and `/design-check`, the page with the appearance switch that the UI compatibility tests open. `main` now has Astryx 0.7.16 and StyleX 0.19.2. No management API exists: storage, the WebDAV protocol, Better Auth and API keys arrive in Phases 1 to 3.

## Goals / Non-Goals

**Goals:**

- Every page in PRD §8 works end to end on sample data, so the owner can judge layouts and flows before the API exists.
- Pages use Astryx components and tokens. Davloom's own styles use StyleX.
- Sample data and the rules that stand in for the server sit in their own modules, so that connecting the API replaces them module by module.

**Non-Goals:**

- No API contract, no network calls, and no sample data kept after a reload. Only preferences the browser keeps last: the appearance mode, and the side navigation's width and fold.
- No Bend code and no laws in `LAWS.bend`. The stand-in rules stay in TypeScript until the API replaces them, an exception to PRD §4 that the owner decides (Decision 2).
- No TanStack Virtual and no screenshot baselines. Both need the real listings and the reviewed pages.

## Decisions

### 1. Sample data in the browser, not a mocked API

`features/sample-data` holds the instance, three backends, four mounts, the file trees, five keys, four recent errors and a day of hourly operation counts. Times are relative to a fixed clock (2026-11-16 15:30 UTC), so "2 minutes ago" reads the same on every run. Module-level TanStack Store instances keep the visit's changes to mounts, files, keys, uploads and settings (the profile, the sessions and the default backend), and the pages share them: a mount added on Storage & Mounts shows in Files and on the Overview, and the default backend chosen in Settings is where a new mount starts.

Alternative: Mock Service Worker in front of a draft management API. Rejected, because it would fix request and response shapes before Phase 3 defines them, and a public API contract needs the owner's approval.

### 2. Stand-in rules in TypeScript until the API replaces them

The pages must refuse what the server will refuse, so the prototype has logic that decides an outcome without IO. PRD §4 asks for such logic to be written in Bend, and keeps pure logic in TypeScript only when Bend cannot express it or cannot meet the Workers CPU budget. Neither is the case here. These rules stay in TypeScript for another reason: `packages/laws`, the pinned Bend release and the CI checks arrive in Phase 1, and the stand-ins live only until the Dashboard calls the API, whose answers then replace them. That is an exception to PRD §4, so the owner decides it, and the pull request waits for that approval in chat.

The stand-ins meet the rest of the rule: fast-check property tests in `apps/web` check the laws they share with the server's rules. Each property also failed, in runs made by hand, when the rule it covers was broken on purpose. The move and copy properties generate transfers from the folders and items of the generated trees, and fail when too few of them succeed with a folder that has contents, so a run cannot pass without checking the law. A further transfer property also draws folders and names that the trees do not hold, and fails unless each way a transfer can be refused comes up in its run. Examples cover what generated trees rarely hold: a name a sibling already has, a folder whose name starts with another's, and mounts named after a property every JavaScript object has, such as `constructor`.

| Stand-in in `apps/web` | Law its tests check | Rule that replaces it |
| --- | --- | --- |
| `nameProblem` | An accepted name is one segment, not empty, `.` or `..`, that no sibling has | Phase 2 name validation |
| `folderIn`, `createFolderIn`, `renameIn`, `removeIn` and `putFileIn` | Nothing exists outside the mounts; names stay unique within every folder after any sequence of changes; removing takes away the named items and nothing else; a stored file replaces a file of its name and never a folder | Phase 1 namespace model |
| `transferIn` and `destinationsFor` | A folder never goes inside itself and is never offered as its own destination; a move keeps every item and a copy adds exactly what it copies; a transfer brings every named item, or refuses when the destination holds one of them; a transfer succeeds exactly when its folder holds every name, the destination holds none of them and no folder would go inside itself | Phase 2 COPY and MOVE, with `Overwrite: F` |
| `normalizePath` | Normalizing a normalized path changes nothing | Phase 2 path normalization |
| `mountNameProblem` and `mountFolderOf` | A typed name is accepted exactly when its folder, the name without the spaces and slashes around it, is one segment, not `.` or `..`, that no other mount uses | Phase 2 Mount resolution |
| `keyStateOf` | A revoked key stays revoked, and any other key is expired exactly from its expiry time | Better Auth's API key expiry and revocation (PRD §6), which stays in TypeScript |
| `scopeOf` | A key's scope never reaches outside its mount and has no segment that starts or ends with a space, and a folder of plain names is kept as it is | Phase 3 permission decisions in the Policy Service: a credential never reaches outside its mount and path prefix |
| `uploadProblem` | A file over 100 MB is refused | The Cloud Free request body limit, which the platform enforces |

When the Dashboard calls the API, the stand-ins are deleted and the pages show the server's answers. The specs describe the outcomes the server's rules will give, so the pages need no redesign when the stand-ins go. They never ship: PRD §13 lets a feature ship only once the laws it needs are proven, and the Dashboard calls the API before it ships.

Some checks stay in the page components, because they are UI code, which PRD §4 leaves in TypeScript. A key needs a name, a mount needs a bucket, and a profile needs a display name and an email address with an @ before their forms submit, and the Files page offers no change on, and no move or copy into, a mount whose backend does not answer. These check that a field is filled in, and that the email address has an @, or turn controls off from a status the server reports.

Move and Copy offer the folders of every mount whose backend answers, as if the administrator may reach every mount. Whether the administrator may is for the owner to decide (Open Questions).

Alternative: write the stand-ins in Bend now. Rejected for this change: it would bring the Bend toolchain, `packages/laws` and laws that each need the owner's approval into a prototype whose rules are deleted once the API exists.

### 3. A gray and white theme through tokens, with color for status

The theme still extends `@astryxdesign/theme-neutral`. It changes tokens, and the styles of the side navigation (Decision 11):

- The accent is near-black in light mode and near-white in dark mode (`#111111` and `#f1f1f1`), with the inverse for text on it.
- The page is built in layers of gray, each lighter than the one below: the frame with the side navigation (`#f1f1f1`, dark `#121212`), the page (`#fcfcfc`, `#171717`), cards (`#ffffff`, `#1e1e1e`) and popovers (`#ffffff`, `#262626`). Low, medium and high shadows in black at low opacity lift cards, menus and dialogs, and every card takes the low elevation. In dark mode a shadow barely shows against the page, so each one also draws a white hairline just inside the layer's edge, as the neutral theme does. Before the owner's review, dark mode drew cards in the frame's gray, darker than the page under them.
- Statuses keep the neutral theme's colors: errors red, warnings amber, success green and information blue, in their fills, text, icons, borders, muted backgrounds and rings. The error notification keeps Astryx's own red, which neither the neutral theme nor Davloom sets (`#AA071E` in light mode, `#E3193B` in dark), so in dark mode it is a deeper red than error text (`#ff705d`). On 2026-11-17 the owner asked for gray and white as the main colors and for other colors wherever they belong, which reverses the earlier rule of no hue at all. Destructive buttons take the error color's muted fill, the Delete buttons of Files among them, the Overview's chart rings failed hours in red (Decision 12), and the status code of each recent operation error takes the error text color. Statuses keep their icons and words, and error text is semibold, so color never carries a status alone (WCAG 1.4.1).
- The nine categorical hues share one set of grays for background, border, icon and text, because no page needs a color for a category. Code syntax, the hover and selection rings, the inverted background and the progress track are gray too.
- Astryx 0.7.16 keeps chart series colors in a separate token set, whose grays carry a blue tint. The theme leaves them alone, and the Overview's charts paint with the theme's own tokens instead (Decision 12).

`packages/ui/src/tokens/monochrome.ts` holds the grays and `davloom-source.ts` assigns them to tokens, leaving the status tokens to the neutral theme. A unit test checks that status text reaches 4.5:1 against the frame, page, card and popover in both modes, and so does the text on each status fill and on each muted fill, which in dark mode lets the background show through, so the test blends it over each background first. A Playwright test checks the text of the error notification on its red. `brand.ts` still writes the light accent as a six-digit hex literal, the form that `verify-brand-change.ts` looks for when it swaps the brand color.

Astryx styles neither text selection, spelling marks, the controls the browser draws nor autofilled inputs, so the browser would paint them blue, red and yellow. `apps/web/src/styles/globals.css` paints selection in the accent, gives native checkboxes and radio buttons the accent as their `accent-color`, draws spelling marks as a wavy underline in the error color and grammar marks in the information color where the browser allows it (Chromium does), and keeps the autofill tint off. Fields whose text is not prose turn spell check off, since most of it would be marked: the names of files, folders, keys and mounts, the display name, the email address, a key's folder, a mount's bucket and prefix, the search field and the values offered for copying. The "Selected text and spelling marks" test checks the selection and the spelling and grammar marks. The autofill rule has no test, because only the browser's own autofill applies it.

Until 2026-11-17 statuses were grays ranked by lightness, because the owner had asked for no color at all. The owner then asked for color wherever it belongs, so statuses took their hues back.

Alternative: status colors of Davloom's own. Rejected for now, because the neutral theme's already reach 4.5:1 in both modes, and its red, amber, green and blue read as the statuses people expect.

### 4. A pathless layout route for the shell

`_app/_dashboard.tsx` renders the Astryx AppShell, and Overview (`/`), Files, Credentials, Storage & Mounts and Settings sit under it. `/design-check` stays under `_app` outside the shell, so the UI compatibility tests keep their page.

Page state lives in search parameters (`path` and `file` for Files, `section` for Settings), so links, reloads and Back work. The router reads and writes every search parameter as plain text (`parseSearch` and `stringifySearch` in `router.tsx`), because its default JSON parsing would turn a folder named `1` into a number, and the Files route normalizes `path`. Route definitions load with the entry chunk even though page components are split out, so search validation imports only modules without dependencies. Importing the Settings page module from its route had put the page and its components into the entry chunk, `assets/index-*.js` in `apps/web/dist/client`: 538 kB as Vite prints it, minified and before gzip, against 382 kB on `main`. With `features/settings/sections.ts` it is 320 kB, which includes the path normalization that the Files route validates with.

### 5. A responsive contract per region

PRD §8.1 asks for the Astryx Dashboard Layout. The Overview keeps the frame of the Astryx `dashboard` page template, with its padding and gaps: a row of headline tiles, then charts, then lists in cards (Decision 12). It leaves out the template's filter bar, because the Overview shows one time range.

Following the Astryx layout guide, each region states what it does as the width changes:

- The AppShell side navigation moves behind a menu button below 768 px, the theme's `md` breakpoint.
- The Files details panel is 360 px wide beside the list on a page wider than 776 px, the page that a window 1024 px wide leaves beside the side navigation at its default 248 px. On a narrower page the details open in a dialog.
- The Settings section list is 280 px wide on a page wider than 776 px. On a narrower page it becomes a selector above the section, because on a page between 520 and 660 px wide the list left the section too narrow, and its content spilled sideways.
- Files and Settings measure the page itself, not the window, because the side navigation resizes from 200 to 400 px and folds to a rail. With a viewport rule, a 400 px navigation in a window just over 1024 px wide left Settings too narrow again. `useIsNarrowPage` in `features/shell/pageWidth.ts` measures the main region before the browser paints and follows it with a `ResizeObserver`, since the switch changes which components render, which a container query cannot do.
- Card grids reflow with a minimum column width and a maximum column count, which lets the last column shrink on a phone instead of overflowing.
- The Overview's three headline tiles sit side by side, or one above another once the row has no room for three tiles 10rem wide, so they never wrap two above one. Astryx Grid has no such mode, so the Overview gives its grid a column template of its own (Decision 9).

### 6. Automated tests now, most page flows after the review

Automated now:

- Unit tests read the built theme stylesheet and theme module and check that only status tokens hold a hue, that status text and the text on status fills reach 4.5:1 in both modes (Decision 3), and the stand-in rules with fast-check (Decision 2).
- Playwright checks the appearance requirements on Bun and on Workers. It scans 43 page states in both modes: every page and Settings section; the dialogs, menus, option lists and confirmations the pages open; the details dialog of a window 1024 px wide, the navigation menu of one 375 px wide and the folded side navigation; and keyboard focus, a tooltip, a chart's tooltip, a chart in keyboard focus, notifications, warnings, field errors, a checked switch, empty states, a loading listing, a busy button, upload progress, finished and refused uploads, and row selection. States that pass, such as a busy button, pause the page's timers with Playwright's clock, which `clock.install()` alone leaves running, and check after the scan that the page still shows the state the scan read. The scan reads every element and nine pseudo-elements, among them `::selection` and the spelling marks, in the 30 properties that paint colors, including shadows, filters and gradients, and the hex values, color functions and color names inside SVG data URLs. It allows a difference of 1 in 255 between channels, the rounding that color mixing leaves, in `rgb()` and in `color(srgb)`, the notation that relative colors compute to, counts a notation it does not parse as a hue, and reports an element whose `accent-color` is left to the browser. It lets the status colors through, which it reads from the theme's tokens in the mode in use, and it waits for transitions to end first, because a border on its way to a status color passes through blends that are not status colors. Two tests put hues on a page on purpose, in each kind of place and notation that task 1.3 lists and in a notation the scan does not parse, and check that the scan reports every one of them and none of the grays or the status color beside them. Reds one and two steps from the error color, written in `rgb()` and as relative colors, test the allowance itself: the scan forgives the first and reports the second. A further test checks that statuses, failed hours, the status codes of failed operations and destructive actions take their status colors, and that the error notification's text reaches 4.5:1 in both modes. Other tests cover the color scheme, the first paint and a change made in another tab.
- Playwright checks the navigation requirements: titles, headings, the document language, the storage status in the side navigation and its rail, resizing and folding the side navigation, the layouts of Settings and Files beside a wider and a folded navigation, focus after a change, that no request goes to `/api/` or `/dav/`, and that nothing is wider than a 360 px window. The page scrolls inside its main landmark rather than the document, so that test measures the landmark and every element around it.
- Scenarios that guard a fix made after review have their tests now: "The name a screen reader hears", "Opening the name dialog again", "Opening the form again", "A folder outside the mount", "A profile without a name", "A wider side navigation", "The operations chart in words" and "The storage chart in words". The two chart tests read each description from Chromium's accessibility tree, because Playwright's own description check skips an SVG `<desc>`.

Playwright runs in UTC, so the dates on the pages read the same on every machine.

The other page-flow scenarios of Overview, Files, Credentials, Storage & Mounts and Settings wait for the owner's review of the prototype, because the review may change those flows. They were verified by hand in the browser for this change (tasks.md), each one is written so that it converts to a Playwright test, and the change is archived only after those tests exist.

"A dropped folder" cannot drop a real folder through Playwright, so its test will send the drop through the Chrome DevTools Protocol, which the hand check of this change also used.

Alternative: write every page-flow test now. Rejected for now: that is about 50 browser tests against sample data that the review may change, and PRD §11 schedules UI-specific tests for Phase 4.

### 7. Appearance control, color scheme and tabs

The Dashboard's appearance switch lives in Settings, where users look for it, and `/design-check` keeps its own switch for the tests.

The page declares `<meta name="color-scheme" content="light dark">` and never changes it. The scheme in use is set on the root element instead: the stylesheet gives it `light dark` and narrows it under `html[data-theme]`, and the first-paint script and the appearance store write the chosen scheme into the root's inline style. An earlier version narrowed the meta element, which left a second copy of it after hydration, because React 19 adopts a server-rendered `<meta>` only when its `content` matches what React renders.

React writes the stylesheet first in `<head>`, ahead of the inline script, so the script runs once the stylesheet has loaded. That is still before `<body>` is parsed, and a stylesheet in `<head>` holds back rendering, so the first paint shows the stored mode. The trade-off: while the stylesheet loads, before anything is painted, the browser may show an empty page in the operating system's scheme, because the meta element names both. Narrowing the meta element would avoid that and bring back the duplicate.

The store also listens for `storage` events, which the browser fires only in the other tabs, and applies the mode they carry. The store writes the scheme into the root's inline style on every change, because the stylesheet's own `html[data-theme]` rules lose to the value the first-paint script wrote there. "Choosing a mode" and "Two open tabs" each change the mode after a page has loaded with Dark stored, so they fail without that write.

### 8. Dependencies and language

Icons come from `lucide-react`, the icon set PRD §2 names. `bun.lock` already held one `lucide-react` entry, 1.69.0, for `@astryxdesign/theme-neutral` (`^1.66.0`). `apps/web` declares the npm `latest` version, 1.74.0, and that entry moved to 1.74.0, which the theme's range allows, so both use one copy.

`fast-check` 4.10.2, the npm `latest` version, is a dev dependency of `apps/web` for the property tests of Decision 2. It brings `pure-rand` 8.4.2 into `bun.lock`.

`@tanstack/charts` 1.5.0, the npm `latest` version, draws the Overview's charts (Decision 12). It pins the D3 modules behind its marks, and `bun.lock` gains 41 entries: `@tanstack/charts` itself, the D3 modules and their types with `@types/geojson`, `delaunator`, `internmap` and `robust-predicates`, and the older `d3-array` 2.12.1, `d3-shape` 1.3.7, `d3-path` 1.0.9 and `@types/d3-shape` 1.3.12 that `d3-sankey` 0.12.3 and its types ask for, with `@types/d3-path` 1.0.11, the only copy of those types. Only the Overview imports the charts, so the entry chunk stays at 320 kB as Vite prints it, and the Overview's own chunk grows from 5.3 kB to 158 kB, or from 2.1 kB to 52 kB after gzip.

TanStack Charts draws straight lines unless it is handed a D3 curve, and its documentation asks an application to declare every `d3-*` module that its own source imports. `d3-shape` 3.2.1 and `@types/d3-shape` 3.2.0, both npm `latest`, therefore give the operations chart its monotone curve through `d3Curve` from `@tanstack/charts/d3/shape`. `@tanstack/charts` pins `d3-shape` 3.2.0 for itself, so `bun.lock` holds three versions of `d3-shape`: 3.2.1 for the app, 3.2.0 for TanStack Charts and 1.3.7 for `d3-sankey`.

A chart library is none of the runtimes, frameworks, databases, storage backends or cloud services whose addition `CLAUDE.md` brings to the owner, and the owner asked for TanStack Charts by name.

`<html lang="en">` matches the interface text, which is English.

### 9. Where the pages leave Astryx props

`astryx doctor` reports five places in the source, and each needs what no Astryx prop gives:

- `FileName` uses StyleX so that a file name's stem can shrink to an ellipsis while its extension keeps its width. `StackItem` only offers a size that grows or one that stays put.
- `FileExplorerPage` uses StyleX to make the name link fill its table cell, because the Link root is sized to its content and its `display` prop styles only the inner text.
- `OverviewPage` gives its tile grid a column template that switches between three columns and one (Decision 5). Astryx Grid's responsive columns would wrap the three tiles two above one at some widths, and Grid's guide points to `xstyle` for a template of one's own.
- `charts.tsx` sets the CSS variables from which TanStack Charts takes its palette, the fills of its focus ring and crosshair, its tooltip's colors, border, radius, shadow and font, and the font of its labels, each from an Astryx token. A chart is not an Astryx component and has no other way to take them (Decision 12).
- `RouterLink` renders a plain `<a>`: it is the component that Astryx `LinkProvider` renders for every link, and it hands in-app clicks to the router.

The StyleX uses follow PRD §3.3 and the UI rules in `CLAUDE.md`. `FileName` also hides the two parts from assistive technology and gives it the whole name in `VisuallyHidden`, since two boxes on screen would read as two words.

### 10. Focus after a change

When a change removes the control that had focus, `refocusIfLost` in `features/shell/focus.ts` moves focus to the control that takes its place: the row after a deleted one, the checkbox of the first selected row after Unselect All, the upload area's button after Clear finished, and, after a session is signed out, the Sign out button of the session after it, or of the one before it when it was the last, or Set up above the sessions when no other session is left. When a search hides the folder or file a dialog has just created or renamed, focus goes to the search field. It cannot do so at once. An Astryx dialog keeps focus until its exit transition ends and returns it to its opener only if the opener is still there, and the Files table renders its rows again when the details panel closes and the table's width changes. So the helper watches each frame for up to a second, moves focus whenever it has fallen to the page body, and stops once something else takes it. It looks for its targets inside `[role="main"]`, because Astryx renders the main landmark as an element with that role, not as `<main>`.

A closing dialog needs the same help. Astryx Dialog takes as its opener whatever has focus once its content has mounted, and a form's first field focuses itself in that same commit, so the dialog returns focus to that field inside the closed dialog, and focus falls to the page body after Cancel, Escape or the close button alike. `features/shell/useFormDialog.tsx` remembers the control that opened a form dialog and sends focus back to it however the dialog closes, or to the menu's button when the opener was an item of a menu that has since closed. Credentials does the same for its key dialog. Each form shown also gets a new React `key`, because a dialog keeps its content while it closes, and the next form would otherwise start with the last one's values.

Errors are announced assertively: an error notification, a folder that cannot be listed, a try that fails again, a connection that still does not answer, and a copy the browser blocked. A missing folder needs no announcement of its own, because Astryx `EmptyState` announces its title when it appears. Files announces the match count of a search and its errors through two announcers, as Astryx advises, so an error never cancels a count, and a try, a connection check or an export that is still running when the user leaves the page is cancelled rather than announced on the next one.

### 11. A side navigation after Linear

The owner reviewed the prototype on 2026-11-17, asked for a side navigation after Linear's, and asked for components with more depth than black on white (Decision 3). The side navigation now:

- shows the Davloom mark beside the product name, which links to the Overview: a tile and three rounded squares, each turned 12 degrees past the one around it, whose shades step evenly from the tile to the core, with no letter in it, as the owner asked;
- lists Overview and Files at the top without a heading, and Credentials and Storage & Mounts under a Manage heading, in rows of the design system's default size with medium-weight secondary text;
- lines up the mark, the Manage heading, every row's icon and the collapse button's chevron on one edge, 16 px in, which the owner asked for after a second review. Rows of the small size had put the icons 4 px further out than the heading and the mark;
- marks the current page with the design system's fill and primary text, in semibold, with its icon drawn in a heavier stroke, so the page differs in weight and shape as well as in shade (WCAG 1.4.1);
- shows a status glyph after Storage & Mounts while a backend is slow or unreachable, and the glyph's label, such as "1 backend unreachable", joins the link's name. The folded rail draws icons only, so there the glyph takes the row's icon, and the status joins the label, which names the link and fills its tooltip;
- keeps Settings and the collapse button at its foot;
- can be dragged from its edge between 200 and 400 px wide, or moved with the arrow keys on that edge, and folds to its icon rail when the edge is let go narrower than 160 px, with Enter on the edge or with the collapse button, which the owner asked for. Let go at rest between 160 and 200 px, it springs back to 200 px. Astryx SideNav's `resizable` does this, with a fold threshold of its own that Davloom does not set, and the browser keeps the width and whether the rail is folded between visits;
- meets the page at a hairline, which the top bar of narrow windows leaves out.

The Overview and the glyph read their totals from `features/storage/summary.ts`, so the two always agree. The mark's grays run from `--color-accent` at the tile to `--color-on-accent` at the core through two translucent squares, so the mark inverts with the mode, as the accent buttons do. Astryx Icon draws it at its large size, 24 px, and hides it from assistive technology, because the product name beside it names the link.

Alternative: a letter on an ink tile, such as a D. Rejected, because the owner asked for a mark without letters. Sketches drawn on a canvas also set aside a trefoil knot, which the owner found too close to Stash's mark, and a woven lattice or a tartan, which come close to Plaid's.

Alternative: an ink bar at the start of the current row, which would give the marker the 3:1 contrast against the rail that the `navbar` guide of modern-web-guidance asks for. Rejected for this review, because Linear marks the current page with a fill, and the weight and the stroke already tell it apart without color.

Alternative: a storage card at the foot of the navigation, with a capacity bar. Rejected, because Linear keeps its navigation to rows, and the Overview already shows the capacity.

### 12. Charts on the Overview

On 2026-11-17 the owner asked the Overview to keep the important figures and show more of them as charts, named TanStack Charts, and asked for a polished, startup look. From top to bottom the Overview now holds:

- the page title, with the WebDAV address and Copy address beside it;
- three headline tiles: the bytes stored with the object count, the share of known capacity in use with a bar and the bytes it measures, and the number of mounts with how many backends hold them;
- the operations of the last 24 hours, with how many failed and an area chart of operations per hour, on which a hollow ring marks each hour with a failed operation;
- a bar chart of the bytes on each backend, largest first, with each bar's size at its tip, beside the backends' connection status with the mounts each one serves, the default backend marked, and Check connections;
- the recent operation errors.

Everything PRD §8.1 lists is still there. The current storage backend is the one marked Default, the mount list is the mounts under each backend, the object count and the known capacity have their tiles, and the WebDAV address, the connection status and the recent errors keep their places. The operations chart goes beyond PRD §8.1, and its counts stand for what the audit log, `audit_events` in PRD §7, will record (Open Questions).

The charts draw with the theme's tokens. The line, the wash under it and the bars take the accent, axis labels take secondary text, grid lines take the border gray, and the tooltip takes the popover's background, the border, the element radius and the medium shadow. TanStack Charts reads its series palette from `--ts-chart-1` to `--ts-chart-6`, which fall back to blue, orange and other hues, and the fills of its focus guide, crosshair and tooltip from other `--ts-chart-*` variables, which fall back to the browser's `Canvas` and `CanvasText`. The Overview sets each of them, and the tooltip's font, from a theme token. A chart's SVG takes keyboard focus, and the library leaves its ring to the browser, which draws it in the system's blue, so `globals.css` gives a focused chart the theme's focus ring, as every Astryx control has. The charts follow the dataviz guidance: one series needs no legend, the line is 2 px over a wash that fades from 20% to nothing, the grid is a hairline with no axis lines, bars are 12 px thick with a 4 px rounded end and their values in text color at the tip, and a failed hour is a hollow ring in the error color, so it differs by shape as well as by color. Each chart has an accessible name and a description in words of its figures: the operations, the failures and their hours, and the busiest hour, or the bytes on each backend. Pointing at an hour or a bar, or moving through them with the arrow keys, shows its values in a tooltip, which names the latest hour Now, as the axis does. The color scan covers the tooltip and a chart in keyboard focus (Decision 6). Chart text is 12 px, the theme's extra-small size at the default root size, because TanStack Charts measures labels in pixels; it does not follow a larger default font size the way the page's text does.

Alternative: Recharts, which the Astryx `dashboard` template uses. Rejected, because the owner named TanStack Charts, which belongs to the TanStack family that already gives the app its router, Start and stores, and Recharts 3 brings Redux Toolkit and Immer with it.

Alternative: charts drawn by hand in SVG. Rejected, because scales, axes, tooltips and pointer tracking would all become Davloom code to test and maintain.

Alternative: the chart colors of Astryx's data tokens. Rejected, because their grays carry a blue tint (Decision 3).

### 13. No explanatory or defensive text

On 2026-11-17 the owner asked to remove every piece of explanatory and defensive text from the interface. These went:

- the description under each page title and each Settings section, and the Settings notes on whether the appearance follows the system and on how WebDAV clients sign in;
- the descriptions and example placeholders of form fields, and the description of the upload area;
- the descriptions under empty states, and the second sentence of the banner for an unreachable backend in Files and of the notification for failed uploads;
- the subtitles of the Create a key and Add a mount dialogs;
- the notifications that said where password change and two-step setup would open, so Change password and Set up do nothing in the prototype (Open Questions);
- the "Prototype, sample data" note at the foot of the side navigation;
- the warning that a new key is shown only once, and the hint that a WebDAV client uses it as the password;
- the longer explanations in confirmations, such as WebDAV having no trash.

What stays is what someone needs in order to act: labels, values, statuses, errors with their reasons, the reason a control is unavailable, the titles of empty states, and one sentence in each confirmation that says what will happen, such as "Its files stay in the bucket." when a mount is removed. Astryx AlertDialog requires that sentence as its `description`, which assistive technology reads through `aria-describedby`.

## Cloudflare Workers and Bun

They do not differ for this change. Everything runs in the browser, both runtimes serve the same `apps/web/dist/client` build, and no server code changes.

## Risks / Trade-offs

- [Sample data taken for real state] → No request leaves the page, a reload restores the samples, and the pull request and these documents say that the pages run on samples. The navigation no longer says so, because the owner asked for no explanatory text (Decision 13).
- [Stand-in rules drift from the server's rules] → Decision 2 names the rule that replaces each one, property tests check the laws they share, and connecting the API deletes them.
- [The owner declines the PRD §4 exception] → The stand-ins sit in their own modules, so they can move to Bend in Phase 1, or the pages can wait for the API, without a redesign.
- [A status read from its color alone] → Every status has an icon and words, errors are semibold, and errors are announced assertively (Decision 10).
- [Page flows have no automated tests until the review] → Their tasks stay open in tasks.md, and the change is not archived before they are done.
- [A new key closed before it is copied] → The dialog no longer warns that the key is shown once. A key cannot be shown again, so the user creates another and revokes the first.
- [The charts make the Overview heavier] → They load only with the Overview's chunk, which grows from 5.3 kB to 158 kB, or from 2.1 kB to 52 kB after gzip. The entry chunk stays at 320 kB.

## Open Questions

The reviews of this change found these. The owner's review of the prototype decides them, or the phase an item names:

- Move and Copy work between any two mounts. The Dashboard acts for the administrator, the only account V1 has (PRD §6), while PRD §12 and `openspec/config.yaml` deny cross-Mount operations by default unless they are authorized. The owner decides whether the administrator is authorized for every mount, and the Policy Service then enforces that answer.
- Opening a folder rebuilds the Files page, so keyboard focus starts again from the top of the page. A file manager would keep it in the list.
- Keys scoped to a mount stay Active after the mount is removed, and the confirmation does not mention them. Adding the mount again on another bucket would give those keys its files.
- At 375 px the Credentials table shows only Name and Access, and its status and actions are reached by scrolling the table sideways, with no cue that it scrolls. The Mounts table's actions are also off screen.
- Beside the section list, the Settings heading sits inside the section navigation landmark.
- Change password and Set up do nothing, because the prototype models neither flow, and the notifications that said where they would open went with the other explanatory text (Decision 13). Phase 3 builds both on Better Auth. The owner decides whether the prototype should show them first.
- The specs keep details that Phases 1 and 3 may settle differently: a key covers one mount or all of them, while PRD §7's `mount_permissions` could hold several, and every mount names a bucket, Durable Objects included.
- The operations chart counts every operation in an hour. PRD §7 keeps `audit_events` for security and operation auditing, but does not say whether reads such as GET and PROPFIND are recorded. The phase that builds the table decides, and the chart then counts what it holds.
- A key's folder drops the spaces around each segment, because the Dashboard never names a folder that way. A WebDAV client could name one ` public`, and a key meant for it would then cover `public` instead. Phase 3 decides whether the Policy Service keeps, refuses or trims such a segment.

## Migration Plan

Nothing to migrate. The root page changes from the Phase 0 placeholder to Overview. To roll back, revert the merge.
