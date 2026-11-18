# Spec Delta

## ADDED Requirements

### Requirement: Gray and white palette
Every color in the Davloom Theme SHALL be black, white or a gray in both light and dark mode, except the status colors. No Dashboard page SHALL render any other hue, in any state a component can show.

#### Scenario: The theme stylesheet
- **WHEN** a test reads the built Davloom Theme stylesheet and the built theme module
- **THEN** every hue in them belongs to a status token, every other color is black, white or a gray, whatever notation writes it, and the fill and the text of each status hold a hue

#### Scenario: Rendered pages
- **WHEN** Playwright opens each Dashboard page and Settings section in light mode and in dark mode, together with the dialogs, menus, option lists and confirmations the pages open, the details dialog and the navigation menu of narrower windows, the folded side navigation, the tooltips of a control and of a chart, a chart in keyboard focus, notifications, warnings, field errors, checked switch, empty states, loading states, upload outcomes, row selection and keyboard focus that the pages show, and waits for transitions to end
- **THEN** no element or pseudo-element has a computed color, in the properties that paint colors, including shadows, filters, gradients and SVG data URLs, whose red, green and blue channels differ by more than 1 in 255, the rounding that color mixing leaves, unless it is one of the theme's status colors in that mode, and no element leaves its accent color to the browser

### Requirement: Status colors
Statuses SHALL keep their hues: errors red, warnings amber, success green and information blue, in their fills, text, icons, borders, muted backgrounds and rings, and the error notification's background. Destructive actions, the failures a chart marks and the status codes of failed operations SHALL take the error color.

#### Scenario: Status colors
- **WHEN** a user opens the Overview, selects a file in `/shared`, opens the details of `wifi-guest.txt` and the confirmation that removes `/photos`, and then checks the connections in light mode and in dark mode
- **THEN** the Unreachable icon takes the error color, the Connected icon the success color, the chart rings its 3 failed hours in the error color, the status codes of recent errors take the error color, both Delete buttons and the Remove mount button take the error's muted fill with the text color that belongs on it, and the error notification's text reaches 4.5:1 on its red in both modes

### Requirement: Status legibility
Every status SHALL keep its icon and words, so color never carries it alone. Status text, and the text on a status fill, muted or not, or on the error notification, SHALL reach a contrast ratio of 4.5:1.

#### Scenario: Status contrast
- **WHEN** a test compares each status's text with the frame, page, card and popover backgrounds, and each status fill and muted fill with the text on it, the muted fill blended over each of those backgrounds, in light mode and in dark mode
- **THEN** every pair reaches a contrast ratio of at least 4.5:1

### Requirement: Colors the browser draws
Selected text and the checkboxes and radio buttons that the browser draws itself SHALL be gray, and spelling and grammar marks SHALL take the error and information colors, wherever the browser lets a page style them.

#### Scenario: Selected text and spelling marks
- **WHEN** a Dashboard page has loaded in Chromium and a test reads the styles the page gives selected text and spelling and grammar marks
- **THEN** the selection's background is a gray, the spelling mark is a wavy underline in the error color, and the grammar mark is one in the information color

### Requirement: Color scheme reported to the browser
The page SHALL declare to the browser that it supports light and dark, and its root element SHALL use the scheme of the chosen mode from the first paint on: light and dark while the mode is System, and only the chosen scheme while it is Light or Dark, so that the parts the browser draws, such as scrollbars and form controls, match the page. While the stylesheet loads, before the first paint, the empty page may still follow the operating system's scheme.

#### Scenario: Choosing a mode
- **WHEN** a user chooses Dark, then Light, then System, reloads the page with Dark chosen, and then chooses Light and System again
- **THEN** the root element's color scheme is `dark`, `light` and `light dark`, then `dark` after the reload, and then `light` and `light dark` again, while the page has one `color-scheme` meta element, which reads `light dark` throughout

#### Scenario: First paint
- **WHEN** a user who chose Dark reloads the page while its script bundles are blocked, so that only the inline first-paint script runs
- **THEN** the root element already carries the dark mode and the `dark` color scheme when the browser starts to parse the body

### Requirement: The dev server matches the build
`vite dev` SHALL draw every Dashboard page as the production build does, with Davloom's own styles in effect and overriding the design system's wherever they do in the build, so that a page reviewed on the dev server looks as it will ship.

#### Scenario: The same page on both servers
- **WHEN** Playwright opens the Overview, Files at `/documents`, Credentials, Storage & Mounts and Settings on the build that Bun delivers and on `vite dev`, 1280 px wide in light and in dark mode and 375 px wide in light mode, with reduced motion
- **THEN** every element that draws has the same box on both servers, to within a pixel, and the same display, text color, background color, top border color and width, font size and font weight, and each page on `vite dev` links the StyleX plugin's dev stylesheet and holds the rules its runtime adds

### Requirement: Appearance shared across tabs
A mode chosen in one tab SHALL apply to the app's other open tabs in the same browser without a reload.

#### Scenario: Two open tabs
- **WHEN** two tabs of the app are open and the user chooses Dark in one of them, opens a third tab, and then chooses Light and then System in the first
- **THEN** the second tab turns dark without a reload, and the third tab, which opened dark, turns light and then follows the system
