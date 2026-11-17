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

- No API contract, no network calls, and no sample data kept after a reload. The browser keeps only two preferences between visits: the appearance mode, and the side navigation's width and fold.
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
| `keyStateOf` and `hasExpired` | A revoked key stays revoked, any other key is expired exactly from its expiry time, and a key's row says Expired exactly from then, revoked or not | Better Auth's API key expiry and revocation (PRD §6), which stays in TypeScript |
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
- Statuses keep the neutral theme's colors: errors red, warnings amber, success green and information blue, in their fills, text, icons, borders, muted backgrounds and rings. The error notification keeps Astryx's own red, which neither the neutral theme nor Davloom sets (`#AA071E` in light mode, `#E3193B` in dark), so in dark mode it is a deeper red than the error fill (`#ff705d`) and the error text (`#ffaea7`). On 2026-11-17 the owner asked for gray and white as the main colors and for other colors wherever they belong, which reverses the earlier rule of no hue at all. Destructive buttons take the error color's muted fill, the Delete buttons of Files among them, the Overview's chart rings failed hours in red (Decision 12), and the status code of each recent operation error takes the error text color. Statuses keep their icons and words, and error text is semibold, so color never carries a status alone (WCAG 1.4.1).
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

- Below 768 px, the theme's `md` breakpoint, AppShell trades the side navigation for a bar across the top, and the navigation's links drop down from a Menu button in that bar (Decision 14).
- The Files details panel is 360 px wide beside the list on a page wider than 776 px, the page that a window 1024 px wide leaves beside the side navigation at its default 248 px. On a narrower page the details open in a dialog.
- The Settings section list is 280 px wide on a page wider than 776 px. On a narrower page it becomes a selector above the section, because on a page between 520 and 660 px wide the list left the section too narrow, and its content spilled sideways. Both layouts keep the open section at the same place in the React tree, so folding or widening the navigation, which can switch the layout, keeps what was typed in it and lets an export it started finish.
- Files and Settings measure the page itself, not the window, because the side navigation resizes from 200 to 400 px and folds to a rail. With a viewport rule, a 400 px navigation in a window just over 1024 px wide left Settings too narrow again. `useIsNarrowPage` in `features/shell/pageWidth.ts` measures the main region before the browser paints and follows it with a `ResizeObserver`, since the switch changes which components render, which a container query cannot do.
- Card grids reflow with a minimum column width and a maximum column count, which lets the last column shrink on a phone instead of overflowing.
- Every page keeps a 24 px gutter beside the side navigation and a 16 px one on a phone, where the navigation drops down from the bar across the top. The narrow gutter used to start on a page 776 px wide or less, which moved a page's title and content off the lines it shares with the navigation (Decision 11).
- The Files, Credentials and Mounts tables, the Storage backend cards, About this instance and the Copy button beside a value lay themselves out by their own width rather than the page's, and a title row by whether its buttons' words fit beside the title (Decision 14).
- The Overview's three headline tiles sit side by side, or one above another once the row has no room for three tiles 11rem wide, so they never wrap two above one. The minimum was 10rem until the 16 px gutter of a narrow page left room for three such tiles beside the navigation in a window 800 px wide. Astryx Grid has no such mode, so the Overview gives its grid a column template of its own (Decision 9).

### 6. Automated tests now, most page flows after the review

Automated now:

- Unit tests read the built theme stylesheet and theme module and check that only status tokens hold a hue, that status text and the text on status fills reach 4.5:1 in both modes (Decision 3), and the stand-in rules with fast-check (Decision 2).
- Playwright checks the appearance requirements on Bun and on Workers. It scans 45 page states in both modes: every page and Settings section; the dialogs, menus, option lists and confirmations the pages open; the details dialog of a window 1024 px wide, the navigation dropdown and the list of keys with two rows open in one 375 px wide, Storage & Mounts with a mount open in one 320 px wide, and the folded side navigation; and keyboard focus, a tooltip, a chart's tooltip, a chart in keyboard focus, notifications, warnings, field errors, a checked switch, empty states, a loading listing, a busy button, upload progress, finished and refused uploads, and row selection. States that pass, such as a busy button, pause the page's timers with Playwright's clock, which `clock.install()` alone leaves running, and check after the scan that the page still shows the state the scan read. The scan reads every element and nine pseudo-elements, among them `::selection` and the spelling marks, in the 30 properties that paint colors, including shadows, filters and gradients, and the hex values, color functions and color names inside SVG data URLs. It counts a color as gray when its channels differ by 1 in 255 at most, the rounding that color mixing leaves, in `rgb()` and in `color(srgb)`, the notation that relative colors compute to, counts a notation it does not parse as a hue, and reports an element whose `accent-color` is left to the browser. It lets the status colors through, which it reads from the theme's tokens in the mode in use, with each channel allowed to be 1 in 255 away, and it waits for transitions to end first, because a border on its way to a status color passes through blends that are not status colors. Two tests put hues on a page on purpose, in each kind of place and notation that task 1.3 lists and in a notation the scan does not parse, and check that the scan reports every one of them and none of the grays or the status color beside them. Grays whose channels are 1 apart and colors whose channels are 2 apart, in both notations, test the gray rule at its edge, the color in `color()` a hair under 2 so that a rule moved to 2 lets it through, and reds one and two steps from the error color, written in `rgb()` and as relative colors, test the status allowance: the scan forgives the first of each pair and reports the second. A further test checks that statuses, failed hours, the status codes of failed operations and destructive actions take their status colors, and that the error notification's text reaches 4.5:1 in both modes. Other tests cover the color scheme, the first paint and a change made in another tab.
- Playwright checks the navigation requirements: titles, headings, the document language, the storage status in the side navigation and its rail, the dropdown of the Menu button, the lists, the rows that move when one opens or closes, and the buttons beside a title in a phone's window, resizing and folding the side navigation, the layouts of Settings and Files beside a wider and a folded navigation, a Settings section that keeps its typed input and its running export when folding the navigation switches the layout, focus after a change, that no request goes to `/api/` or `/dav/`, and that no page scrolls sideways in a window 320 px wide, the width WCAG 1.4.10 asks content to reflow to, or in one 1024 px wide beside the navigation. A page scrolls inside its layout, within the main landmark, rather than the document, so that check reads the landmark and every element around it, every element inside it that scrolls sideways, such as the layout or a table's frame, and every element whose visible part reaches past the window. Text cut off with an ellipsis, and labels kept for screen readers, are cut off on purpose and do not count. The check fails at 320 px when a title row's actions keep their full width, and at 320 and 1024 px when Credentials keeps a column per detail. "Lists on a phone" fails when Credentials or Mounts keep their tables at 375 px, when a key's row leaves out its first characters, and when a key's status moves back to its name's line, and "Buttons beside a title" fails when the buttons keep their words at 320 px. "Lists on a phone" also fails when a row's chevron loses `aria-expanded`, and when a closed row shows any line beyond its name and the one under it, such as a key's last use and expiry or a mount's bucket. "Opening a row" fails when only one row can be open, when the list keeps a removed record among its open rows, which opens a mount added again under a removed one's name, when the details lose their group's name, when Edit's dialog has no way back to the row's chevron, when a tap on the row's name no longer opens it, when `aria-controls` stays on a closed row, when a revoked key keeps Revoke, when its expiry says Expires, when focus is lost after Revoke or after a mount is removed, when a mount's bucket and prefix share a line again, joined or side by side, and when the details open above their row. It waits for the list's animations to end before it measures where the details are. "Rows that glide" fails when each row keeps its own open state, so that the list does not render again and the rows under an opening row jump to their places, and when the list has no animated layout. "Holding a row" fails when the list reaches the card's edges or has dividers, either of which draws pressed rows square, and "Tables beside the navigation" fails when the chevron has no tooltip. "A revoked key past its expiry" fails when a key's expiry says Expires once it has passed, or Expired before. "Narrow screens" fails when the default backend's mark follows the mounts it serves.
- Scenarios that guard a fix made after review have their tests now: "The name a screen reader hears", "Opening the name dialog again", "Opening the form again", "A folder outside the mount", "A profile without a name", "A wider side navigation", "Folding the navigation on Settings", "The Menu button", "Lists on a phone", "Buttons beside a title", "Tables beside the navigation", "The operations chart in words", "The storage chart in words", "Holding a chart", "Focusing a chart", "Sorting a narrow listing", "The address field's name", "The WebDAV section's address field", "Opening a row", "Rows that glide", "Holding a row", "A revoked key past its expiry", "One grid" and "The title line on a touch screen". The two chart tests in words read each description from Chromium's accessibility tree, because Playwright's own description check skips an SVG `<desc>`. "Holding a chart" moves a finger through the Chrome DevTools Protocol, because Playwright's touchscreen can only tap. During the tap and the swipe it watches every frame and every change to the page, so values shown for a single frame count. It fails when the chart receives the finger's own pointer events, which showed RustFS archive's values for one frame of a swipe, when the values show where they would for a mouse, and when the page scrolls under a held finger. "Focusing a chart" fails when a click rings the chart in the system's blue and when the keyboard draws no ring. "Sorting a narrow listing" runs all six orders and fails when a narrow listing keeps its Name header, which it reports without waiting out the test's time, when the menu's choice does not sort, and when the table keeps an order of its own. "The address field's name" and "The WebDAV section's address field" fail when a field's own label says Value again, and "Sorting a narrow listing" also fails when the menu sits in another column's header. "One grid" checks every page in a window 1280 px wide, and fails when the brand's row, a page's content or the collapse button leaves its line or a page keeps a 16 px gutter beside the navigation. "The title line on a touch screen" fails when a title's line grows with the touch type scale.

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

`@tanstack/charts` 1.5.0, the npm `latest` version, draws the Overview's charts (Decision 12). It pins the D3 modules behind its marks, and `bun.lock` gains 41 entries: `@tanstack/charts` itself, the D3 modules and their types with `@types/geojson`, `delaunator`, `internmap` and `robust-predicates`, and the older `d3-array` 2.12.1, `d3-shape` 1.3.7, `d3-path` 1.0.9 and `@types/d3-shape` 1.3.12 that `d3-sankey` 0.12.3 and its types ask for, with `@types/d3-path` 1.0.11, the only copy of those types. Only the Overview imports the charts, so the entry chunk stays at 320 kB as Vite prints it, and the Overview's own chunk grows from 5.3 kB to 164 kB, or from 2.1 kB to 54 kB after gzip.

TanStack Charts draws straight lines unless it is handed a D3 curve, and its documentation asks an application to declare every `d3-*` module that its own source imports. `d3-shape` 3.2.1 and `@types/d3-shape` 3.2.0, both npm `latest`, therefore give the operations chart its monotone curve through `d3Curve` from `@tanstack/charts/d3/shape`. `@tanstack/charts` pins `d3-shape` 3.2.0 for itself, so `bun.lock` holds three versions of `d3-shape`: 3.2.1 for the app, 3.2.0 for TanStack Charts and 1.3.7 for `d3-sankey`.

A chart library is none of the runtimes, frameworks, databases, storage backends or cloud services whose addition `CLAUDE.md` brings to the owner, and the owner asked for TanStack Charts by name.

`<html lang="en">` matches the interface text, which is English.

### 9. Where the pages leave Astryx props

`astryx doctor` reports eight places in the source, and each needs what no Astryx prop gives:

- `FileName` uses StyleX so that a file name's stem can shrink to an ellipsis while its extension keeps its width. `StackItem` only offers a size that grows or one that stays put.
- `FileExplorerPage` uses StyleX to make the name link fill its table cell, because the Link root is sized to its content and its `display` prop styles only the inner text. On a narrow listing it also starts the size and age under a name where the name's text starts, past its icon, with a spacing token.
- `OverviewPage` gives its tile grid a column template that switches between three columns and one (Decision 5). Astryx Grid's responsive columns would wrap the three tiles two above one at some widths, and Grid's guide points to `xstyle` for a template of one's own. It also gives each recent error's status code the error text color, which Text's `color` prop does not offer.
- `TitleRow`, the row of a page's title or a panel's heading and its actions, lets the actions narrow below their widest content, so a wide field among them, such as the Overview's WebDAV address, narrows with a phone's row instead of pushing past it. Astryx stacks have no minimum-width prop, and `StackItem` either keeps its size or grows.
- `charts.tsx` sets the CSS variables from which TanStack Charts takes its palette, the fills of its focus ring and crosshair, its tooltip's colors, border, radius, shadow and font, and the font of its labels, each from an Astryx token. A chart is not an Astryx component and has no other way to take them (Decision 12).
- `TouchHold` turns off text selection and the system's callout on a chart, so a finger held on it shows the chart's values rather than selecting its labels or opening a menu (Decision 12).
- `SortMenu` pulls its trigger back by a small button's padding, a spacing token, so the words of a narrow listing's sort menu start where each row's icon does, as the Name header's words did. Button has no prop that lines its words up with an edge (Decision 14).
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
- lines up the mark, the Manage heading, every row's icon and the collapse button's chevron on one edge, which the owner asked for after a second review, now one gutter in (below). Rows of the small size had put the icons 4 px further out than the heading and the mark;
- marks the current page with the design system's fill and primary text, in semibold, with its icon drawn in a heavier stroke, so the page differs in weight and shape as well as in shade (WCAG 1.4.1);
- shows a status glyph after Storage & Mounts while a backend is slow or unreachable, and the glyph's label, such as "1 backend unreachable", joins the link's name. The folded rail draws icons only, so there the glyph takes the row's icon, and the status joins the label, which names the link and fills its tooltip;
- keeps Settings and the collapse button at its foot;
- can be dragged from its edge between 200 and 400 px wide, or moved with the arrow keys on that edge, and folds to its icon rail when the edge is let go narrower than 160 px, or flung towards there, since Astryx projects a moving release forward, with Enter on the edge or with the collapse button, which the owner asked for. Let go at rest between 160 and 200 px, it springs back to 200 px. Astryx SideNav's `resizable` does this, with a fold threshold of its own that Davloom does not set, and the browser keeps the width and whether the rail is folded between visits;
- meets the page at a hairline, which the top bar of narrow windows leaves out.

Later on 2026-11-17 the owner found that the side navigation still did not line up with the page and asked for it to be redesigned on one grid. The shell now keeps one gutter between every edge and what it holds, 24 px beside the navigation and 16 px on a phone. The navigation's content starts one gutter in from the window's edge, as a page's content starts one gutter in from the navigation, and the collapse button ends one gutter above the bottom. Two lines cross the window. The title line, one gutter below the top and as tall as the brand's row, 32 px, holds the brand, each page's title, and the heading of a Settings section or of a file's details. The content line, one gutter below the title line, is where the navigation's first link, each page's content, the Settings section list and an action that wraps below a title start. SideNav pads its parts by 8 px, so Davloom's brand, sections and footer add the rest with Astryx padding props. The rail keeps both lines and centers its icons, and a phone's bar keeps AppShell's spacing. A title keeps the line's height even where a touch screen's type scale makes it 26 px and its own line 36 px, so it stays level with the brand. Before, the brand sat 16 px above the titles, Files and Credentials started their content 20 px below the title rather than 24, and Settings put its title 16 px from the top.

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

The charts draw with the theme's tokens. The line, the wash under it and the bars take the accent, axis labels take secondary text, grid lines take the border gray, and the tooltip takes the popover's background, the border, the element radius and the medium shadow. TanStack Charts reads its series palette from `--ts-chart-1` to `--ts-chart-6`, which fall back to blue, orange and other hues, and the fills of its focus guide, crosshair and tooltip from other `--ts-chart-*` variables, which fall back to the browser's `Canvas` and `CanvasText`. The Overview sets each of them, and the tooltip's font, from a theme token. A chart's SVG takes keyboard focus, and the library leaves its ring to the browser, which draws it in the system's blue, even after a click, because Chromium's rule for SVG uses `:focus` rather than `:focus-visible`. `globals.css` removes that ring and gives a chart in keyboard focus the theme's focus ring, as every Astryx control has, which "Focusing a chart" checks. The charts follow the dataviz guidance: one series needs no legend, the line is 2 px over a wash that fades from 20% to nothing, the grid is a hairline with no axis lines, bars are 12 px thick with a 4 px rounded end and their values in text color at the tip, and a failed hour is a hollow ring in the error color, so it differs by shape as well as by color. Each chart has an accessible name and a description in words of its figures: the operations, the failures and their hours, and the busiest hour, or the bytes on each backend. Pointing at an hour or a bar, or moving through them with the arrow keys, shows its values in a tooltip, which names the latest hour Now, as the axis and the chart's description do. The color scan covers the tooltip and a chart in keyboard focus (Decision 6). TanStack Charts' own focus ring is off on both charts. On the bar chart, the bar and the size at its tip each drew a ring there, side by side, which the owner pointed out; the backend in focus now keeps its ink while the other bars and their sizes fade to 35%, the way a bar shows focus. On the operations chart, the area, the line and the error ring each drew a ring on the hour in focus, and the last one, in the card's color, hid the error ring. One ring in the ink now marks a quiet hour in focus, and a failed hour keeps its error ring. Axis and bar labels are 12 px, the theme's small size at the default root size, because TanStack Charts measures labels in pixels; they do not follow a larger default font size the way the page's text does. The tooltip takes the theme's extra-small size, 10 px with a mouse and 12 px where a touch screen's type scale is a step larger.

On a touch screen a chart shows a point's values only while a finger holds it, as the owner asked on 2026-11-17. TanStack Charts treats a finger as a mouse. A tap showed the point's values and left them open, since a finger never leaves the chart the way a mouse does, and the focus a tap gave the chart showed its first point, as Tab does. `TouchHold` wraps each chart and keeps the finger's own pointer events, and the click and focus a tap brings, away from the chart. A press held for half a second, the default of Astryx's `useLongPress`, shows the point under the finger, sliding the finger moves along the chart while the page stays still, and lifting it hides the values. A tap shows nothing, and a swipe that starts on a chart scrolls the page. Where a finger is the main pointer, as the `pointer: coarse` media feature reports, the values show above the plot, in line with the point, through TanStack Charts' tooltip portal, which lets them leave the chart's box; beside the point, the finger and the hand would cover them. A mouse, a pen and the keyboard show the values as before.

Alternative: Recharts, which the Astryx `dashboard` template uses. Rejected, because the owner named TanStack Charts, which belongs to the TanStack family that already gives the app its router, Start and stores, and Recharts 3 brings Redux Toolkit and Immer with it.

Alternative: charts drawn by hand in SVG. Rejected, because scales, axes, tooltips and pointer tracking would all become Davloom code to test and maintain.

Alternative: the chart colors of Astryx's data tokens. Rejected, because their grays carry a blue tint (Decision 3).

Alternative: show a tapped point's values until the next tap, as TanStack Charts did. Rejected, because the owner asked for the values to show only while a finger holds the chart, and a tap meant to scroll the page left a tooltip over it.

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

### 14. Phones and narrow pages

On 2026-11-17 the owner looked at the prototype on a phone, found the Overview's address field spilling past the screen, and asked for the side navigation to become a dropdown menu on phones and for every layout to hold up at that size.

Below the theme's `md` breakpoint AppShell drops the side navigation and draws a bar across the top with the navigation's heading and footer icons. Its own phone navigation is a drawer that slides in from the side. Davloom passes AppShell a `mobileNav` node of its own, which turns the drawer and its toggle off and keeps the bar, and puts a Menu button among the footer icons, where AppShell's collapse button hides itself on a phone. The button opens an Astryx Popover below it, aligned to its end and as wide as the navigation, holding the same rows as the side navigation: the current page marked with `aria-current="page"`, the Manage heading and the storage glyph. Choosing a row changes the page and closes the dropdown, and so does reaching another page by Back. Escape or a tap outside closes it, and focus goes back to Menu. The rows stay links, as the `navbar` guide of modern-web-guidance asks of site navigation, so a screen reader hears links and the current page rather than menu items. Like the drawer it replaces, the popover is a modal dialog while open.

The page fits a phone in the same pass:

- The Copy button joins its field in an Astryx InputGroup, under the label, so the two line up, which the owner asked for. Below 24rem of width the button keeps only its icon, with "Copy address" or "Copy key" as its name and tooltip, so the whole WebDAV address stays in view. InputGroup names a field with the group's label and then the field's own, so the field's own label stays empty and a screen reader hears "WebDAV address" rather than "WebDAV address Value".
- A table that is too narrow for a column per detail moves those details into its first cell, so its actions column stays in view and no table scrolls sideways. `useNarrowerThan` in `features/shell/useNarrowerThan.ts` measures each table, and the copy field, as `useIsNarrowPage` measures the page. The second pass below turns two of these tables into lists.
- In the Sign-in and security section, the words beside a button wrap so the button keeps its label.

Later the same day the owner rated the phone layouts 0 out of 10: rows of different shapes, a status placed after each name wherever the name ended, sentences that wrapped, and buttons that fell below their titles. The second pass gives each kind of content one shape at every width:

- Where Credentials and Mounts have no room for a column per detail, below 58rem and 39rem of table width, each key or mount becomes a row of a list in a Card. Every row has one shape: the name in bold on a line of its own, then a key's first characters, as the table shows them under its name, with its status at the end of that line, or a mount's backend. The rows first listed every other detail under the name as well, which the third pass below moved behind a tap. Until the fifth review a key's status ended its name's line, which cut names such as Accountant, invoices only short on phones narrower than 375 px, and the rows left out the first characters that the Key list requirement asks for. A window 1024 px wide lists the keys, and one 1280 px wide shows their columns. Files keeps its table, because a list has no sorting or selection, and below 37rem puts each entry's size and age, or a mount's backend at the top level, under its name. Its Name header then becomes a sort menu, an Astryx DropdownMenu with a radio group for the key and one for the direction, because the Size and Modified headers that sorted the listing are gone. The menu's button names the order in use, such as "Size, largest first", and the page holds that order, so the columns keep it when the listing widens again.
- `TitleRow` holds a page's title or a panel's heading with its actions. It measures the title and the actions while the actions show their words. Where the two do not fit side by side, each `TitleAction` button shows only its icon, named by its label for screen readers and in a tooltip, and the words come back once the row is wide enough. Create key, Add mount, New folder, Upload, Manage mounts, Check connections and Manage storage all follow it. Manage storage becomes a small button with the drive icon, as Manage mounts has, so it can. A field among the actions, such as the Overview's address, moves below the title instead. The theme's type scale is a step larger on a touch screen narrower than 1024 px, so Storage & Mounts shows Add mount as an icon in a phone 375 px wide and with its words in a desktop window of that width.
- Below 32rem Files puts its search on a line of its own, as wide as the listing, and leaves out the path at the top level, where it would only repeat the title.
- The Overview's requests and connections keep to one line and a recent error's message to two. On a narrow page an error's time moves under its message, so the request has the row's width.
- Below 21rem a backend card puts its status under the backend's kind and each label above its value, so neither the name nor the RustFS endpoint breaks across lines. About this instance puts its labels above its values below 30rem. Durable Objects has no endpoint, so its card says Built in in the body font rather than as code.
- The Storage section's selector sits in a form layout, as Profile's fields do, so the two sections' fields share a width.

That evening the owner found the key rows still too full on a phone, with the access, scope, last use and expiry of every key under its name, and asked for those details to wait behind a tap, in a window that pops up or in a dropdown. Four designs were built on the sample keys and shown at 375 px: a dialog, a bottom sheet, rows that open in place, and a panel that drops down under its row. The owner then found that every pressed row drew a square gray band across the card, and chose the rows that open in place. The third pass builds them:

- `ExpandableList` in `features/shell/ExpandableList.tsx` draws the rows of keys and mounts. Each row shows the name and one line under it, with a chevron at its end. A tap opens the row in place and shows the rest in a static row under it: an Astryx MetadataList of the details, then the record's actions. A key shows its access, scope, last use and expiry, with Revoke unless it is revoked, and a mount shows its bucket and prefix, each on a line of its own so the narrowest phone breaks neither name, with Edit and Remove. Several rows stay open at once, so two keys can be compared, as the `accordion` guide of modern-web-guidance prefers to an accordion that closes the others. The list, not each row, holds which rows are open, so it renders again when one opens or closes, which its animated layout needs (below). A record that leaves the list leaves its open rows too, so a mount removed and added again under the same folder name, which is its id, starts closed.
- The chevron is an Astryx IconButton named "Details for key …" or "Details for mount …", with the same words as its tooltip, `aria-expanded`, and `aria-controls` naming the details while they are open. The details are a group of the same name, so a screen reader says whose details it reads. ListItem's `interactiveRef` hands it the row, so a tap anywhere on the row presses it and the row adds no second tab stop. The chevron stays at the row's end, where the owner saw it, rather than beside the name as the same guide advises for accordions that grow wide: these rows exist only where a table has no room, and the statuses beside the chevron end in one column.
- Astryx draws rows square when a list has dividers or reaches its card's edges, so the list keeps `edge="padded"` and no dividers, and a pressed row shows a background with rounded corners 12 px inside the card. A `useAnimatedLayout` handle moves the rows below a row that opens or closes to their places rather than at once, and Reduce Motion stops it. Astryx moves them only when the List itself renders again.
- Revoking a key from its details leaves the row with no action, so focus goes to the row's chevron. Removing a mount sends focus to the next mount's chevron, and Edit's dialog returns it to Edit, or to the mount's chevron where a tap does not focus the button, as in Safari. The menus of the wide tables keep their focus rules (Decision 10).

The rows replace `SummaryRow`, which listed every detail and the row's menu under each name.

Alternative: Astryx DropdownMenu with the pages as link items. Rejected, because a menu's role and arrow keys suit actions, and Astryx's own guidance says not to use DropdownMenu for navigation.

Alternative: keep AppShell's drawer. Rejected, because the owner asked for a dropdown.

Alternative: open a key's details in a dialog, a bottom sheet, or a panel under its row. Shown to the owner with the rows that open in place, which the owner chose. A dialog and a sheet hide the list, and a panel covers the rows under it.

Alternative: an Astryx Collapsible for each row. Rejected, because its trigger draws a square background when pressed, the shape the owner rejected.

Alternative: let each row hold its own open state. Tried after the eighth review and rejected: the List then does not render again when a row opens, so the rows under it jump to their places.

Alternative: keep dividers between rows. Rejected, because Astryx then draws each pressed row square, across the card.

Alternative: CSS container queries for the tables. Rejected, because a narrow table renders different columns and cells, which CSS cannot do, the reason `useIsNarrowPage` measures in script too (Decision 5).

Alternative: drop the buttons' words below a fixed window width. Rejected, because whether they fit depends on the title, the buttons and the type scale: Create key keeps its words beside Credentials on a phone 320 px wide, while Add mount needs its icon alone beside Storage & Mounts on one 375 px wide.

## Cloudflare Workers and Bun

They do not differ for this change. Everything runs in the browser, both runtimes serve the same `apps/web/dist/client` build, and no server code changes.

## Risks / Trade-offs

- [Sample data taken for real state] → No request leaves the page, a reload restores the samples, and the pull request and these documents say that the pages run on samples. The navigation no longer says so, because the owner asked for no explanatory text (Decision 13).
- [Stand-in rules drift from the server's rules] → Decision 2 names the rule that replaces each one, property tests check the laws they share, and connecting the API deletes them.
- [The owner declines the PRD §4 exception] → The stand-ins sit in their own modules, so they can move to Bend in Phase 1, or the pages can wait for the API, without a redesign.
- [A status read from its color alone] → Every status has an icon and words, errors are semibold, and errors are announced assertively (Decision 10).
- [Page flows have no automated tests until the review] → Their tasks stay open in tasks.md, and the change is not archived before they are done.
- [A new key closed before it is copied] → The dialog no longer warns that the key is shown once. A key cannot be shown again, so the user creates another and revokes the first.
- [The charts make the Overview heavier] → They load only with the Overview's chunk, which grows from 5.3 kB to 164 kB, or from 2.1 kB to 54 kB after gzip. The entry chunk stays at 320 kB.

## Open Questions

The reviews of this change found these. The owner's review of the prototype decides them, or the phase an item names:

- Move and Copy work between any two mounts. The Dashboard acts for the administrator, the only account V1 has (PRD §6), while PRD §12 and `openspec/config.yaml` deny cross-Mount operations by default unless they are authorized. The owner decides whether the administrator is authorized for every mount, and the Policy Service then enforces that answer.
- Opening a folder rebuilds the Files page, so keyboard focus starts again from the top of the page. A file manager would keep it in the list.
- Keys scoped to a mount stay Active after the mount is removed, and the confirmation does not mention them. Adding the mount again on another bucket would give those keys its files.
- Beside the section list, the Settings heading sits inside the section navigation landmark.
- Change password and Set up do nothing, because the prototype models neither flow, and the notifications that said where they would open went with the other explanatory text (Decision 13). Phase 3 builds both on Better Auth. The owner decides whether the prototype should show them first.
- The specs keep details that Phases 1 and 3 may settle differently: a key covers one mount or all of them, while PRD §7's `mount_permissions` could hold several, and every mount names a bucket, Durable Objects included.
- The operations chart counts every operation in an hour. PRD §7 keeps `audit_events` for security and operation auditing, but does not say whether reads such as GET and PROPFIND are recorded. The phase that builds the table decides, and the chart then counts what it holds.
- The theme names Figtree for body text and headings, but the app does not load the font, so each page shows the system's own font and width-sensitive tests measure the font of the machine they run on. Loading Figtree would change every width the narrow layouts were tuned to, so it waits for the owner's decision on the font.
- A key's folder drops the spaces around each segment, because the Dashboard never names a folder that way. A WebDAV client could name one ` public`, and a key meant for it would then cover `public` instead. Phase 3 decides whether the Policy Service keeps, refuses or trims such a segment.

## Migration Plan

Nothing to migrate. The root page changes from the Phase 0 placeholder to Overview. To roll back, revert the merge.
