# Spec Delta

## ADDED Requirements

### Requirement: Black, white and gray palette
Every color in the Davloom Theme SHALL be black, white or a gray in both light and dark mode, and no Dashboard page SHALL render a hue, in any state a component can show. Statuses SHALL differ by icon and words, and the lightness of their fills, text and rings SHALL rank them: errors the strongest, then warnings, then success and information, which share one gray. Colors for chart series are outside this rule until the Dashboard has a chart.

#### Scenario: The theme stylesheet
- **WHEN** a test reads the built Davloom Theme stylesheet and the built theme module
- **THEN** every color in them is black, white or a gray, whatever notation writes it

#### Scenario: Status ranking
- **WHEN** a test compares the grays of the status fills, status text and status rings in light mode and in dark mode
- **THEN** errors stand furthest from the page's background, then warnings, then success and information, which share one gray

#### Scenario: Rendered pages
- **WHEN** Playwright opens each Dashboard page and Settings section in light mode and in dark mode, together with the dialogs, menus, option lists and confirmations the pages open, the details dialog and the navigation menu of narrower windows, and the tooltip, notifications, warnings, field errors, checked switch, empty states, loading states, upload outcomes, row selection and keyboard focus that the pages show
- **THEN** no element or pseudo-element has a computed color, in the properties that paint colors, including shadows, filters, gradients and SVG data URLs, whose red, green and blue channels differ by more than 1 in 255, the rounding that color mixing leaves, and no element leaves its accent color to the browser

### Requirement: Colors the browser draws
Selected text, spelling marks, and the checkboxes and radio buttons that the browser draws itself SHALL be gray wherever the browser lets a page style them.

#### Scenario: Selected text and spelling marks
- **WHEN** a Dashboard page has loaded in Chromium and a test reads the styles the page gives selected text and spelling and grammar marks
- **THEN** the selection's background is a gray, and each mark is a gray wavy underline, not the browser's blue, red or green

### Requirement: Color scheme reported to the browser
The page SHALL declare to the browser that it supports light and dark, and its root element SHALL use the scheme of the chosen mode from the first paint on: light and dark while the mode is System, and only the chosen scheme while it is Light or Dark, so that the parts the browser draws, such as scrollbars and form controls, match the page. While the stylesheet loads, before the first paint, the empty page may still follow the operating system's scheme.

#### Scenario: Choosing a mode
- **WHEN** a user chooses Dark, then Light, then System, reloads the page with Dark chosen, and then chooses Light and System again
- **THEN** the root element's color scheme is `dark`, `light` and `light dark`, then `dark` after the reload, and then `light` and `light dark` again, while the page has one `color-scheme` meta element, which reads `light dark` throughout

#### Scenario: First paint
- **WHEN** a user who chose Dark reloads the page while its script bundles are blocked, so that only the inline first-paint script runs
- **THEN** the root element already carries the dark mode and the `dark` color scheme when the browser starts to parse the body

### Requirement: Appearance shared across tabs
A mode chosen in one tab SHALL apply to the app's other open tabs in the same browser without a reload.

#### Scenario: Two open tabs
- **WHEN** two tabs of the app are open and the user chooses Dark in one of them, opens a third tab, and then chooses Light and then System in the first
- **THEN** the second tab turns dark without a reload, and the third tab, which opened dark, turns light and then follows the system
