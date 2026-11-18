# Spec Delta

## Purpose

Gives a one-page summary of the instance: what it stores and where, how busy it was over the last day, whether each backend answers, which mounts publish its data, how WebDAV clients connect, and which operations failed recently.

## ADDED Requirements

### Requirement: Headline figures
The Overview SHALL show the bytes stored with the number of objects, the share of known capacity in use with the bytes it measures, and the number of mounts with how many of the backends hold them. The three figures SHALL sit side by side, or one above another where the row is too narrow for three, and never two above one.

#### Scenario: Figures of the sample data
- **WHEN** a user opens the Overview
- **THEN** it shows 255.1 GB stored in 24,597 objects, 10.7% of known capacity in use, which is 213.9 GB of 2 TB, and 4 mounts on 3 of 3 backends

#### Scenario: Figures at two widths
- **WHEN** a user opens the Overview in a window 900 px wide and then narrows the window to 800 px
- **THEN** the three figures sit side by side at 900 px and one above another at 800 px

### Requirement: Figures on one grid
Side by side, the headline figures' labels, the figures and the lines under them SHALL each stand on a shared line, whether or not a figure has a bar, and each label SHALL stand 4 px above its figure.

#### Scenario: Figures on one grid
- **WHEN** a user opens the Overview in a window 1280 px wide, and in one 900 px wide
- **THEN** Stored, Known capacity and Mounts stand on one line, 255.1 GB, 10.7% and 4 on another, and 24,597 objects, 213.9 GB of 2 TB and On 3 of 3 backends on a third, although only Known capacity has a bar, and each tile keeps 4 px between its label and its figure

### Requirement: Operations
The Overview SHALL show how many operations the instance handled in the last 24 hours and how many of them failed, and SHALL chart the operations of each hour, marking each hour in which an operation failed. Pointing at an hour SHALL show its operations, and its failures when it had any. The chart SHALL also say in words how many operations failed, in which hours, and which hour was busiest, and it SHALL call the latest hour "now", as its axis and tooltip do.

#### Scenario: The last 24 hours
- **WHEN** a user opens the Overview
- **THEN** it shows 3,732 operations with 4 failed, and the chart marks the 3 hours in which an operation failed

#### Scenario: Pointing at an hour
- **WHEN** a user points at the chart where it shows 12 hours ago
- **THEN** a tooltip names that hour and shows 426 operations

#### Scenario: The operations chart in words
- **WHEN** assistive technology reads the operations chart
- **THEN** its description says that 4 of 3,732 operations failed, names the 3 hours in which they failed, the latest of them as now, and says that the busiest hour was 12 hours ago, with 426

### Requirement: A count and its status
The count of failed operations SHALL stand on the line of the count of operations beside it.

#### Scenario: A count and its status
- **WHEN** a user opens the Overview in a window 1280 px wide, and in one 320 px wide
- **THEN** 4 failed stands on the line of 3,732

### Requirement: Storage by backend
The Overview SHALL chart the bytes stored on each backend, largest first, with each backend's bytes beside its bar and in the chart's description in words, and SHALL link to Storage & Mounts.

#### Scenario: The sample backends
- **WHEN** a user opens the Overview
- **THEN** the chart shows RustFS archive with 212 GB, R2 photos with 41.2 GB and Durable Objects with 1.9 GB, in that order, and Manage storage opens Storage & Mounts

#### Scenario: The storage chart in words
- **WHEN** assistive technology reads the storage chart
- **THEN** its description says that RustFS archive stores 212 GB, R2 photos 41.2 GB and Durable Objects 1.9 GB

### Requirement: Charts on their card's grid
The longest label on a chart's y axis SHALL start where its card's title starts, and the last label on the operations chart's x axis SHALL end where its card's content ends on the right.

#### Scenario: Charts on their card's grid
- **WHEN** a user opens the Overview in windows 1280, 800 and 320 px wide
- **THEN** the longest label on the y axis of each chart starts where the card's title starts, and Now ends at the right edge of the operations card's content

### Requirement: Charts on a touch screen
On a touch screen, a chart SHALL show a point's values only while a finger holds the chart. A press held for half a second SHALL show the values of the point under the finger, above the chart where the finger does not cover them; sliding the finger SHALL move along the chart without scrolling the page; and lifting the finger SHALL hide the values. A tap SHALL show nothing at any moment, and a swipe that starts on a chart SHALL scroll the page and show nothing.

#### Scenario: Holding a chart
- **WHEN** a user on a phone taps the storage chart, then holds a finger on the RustFS archive bar, slides it to R2 photos, lifts it, and swipes up from the chart
- **THEN** the tap shows nothing at any moment, the hold shows RustFS archive's values above the chart, the slide shows R2 photos' values while the page stays still, the values hide when the finger lifts, and the swipe scrolls the page without showing any values at any moment

### Requirement: Charts with a mouse
A chart SHALL show a point's values while a mouse is over the chart and SHALL hide them when the mouse leaves it, unless a finger holds the chart.

#### Scenario: Pointing at a chart
- **WHEN** a user with a mouse points at the storage chart, then moves the mouse off the chart
- **THEN** the values of a bar show while the mouse is over the chart, and they hide when the mouse leaves

### Requirement: Focus on a chart
A chart SHALL draw the theme's focus ring when the keyboard moves focus to it, as every Astryx control does, and SHALL draw no ring when a click focuses it.

#### Scenario: Focusing a chart
- **WHEN** a user clicks the storage chart, and later reaches it with Tab from Manage storage
- **THEN** the click draws no focus ring, and Tab draws the theme's

### Requirement: Connection status
The Overview SHALL list each backend with its status in an icon and words and the mounts it serves, SHALL mark the default backend at the start of the line of the mounts it serves, so that a narrow window shortens the mounts rather than the mark, and SHALL offer to check every connection again and report the result. A result in which a backend still does not answer SHALL be reported as an error.

#### Scenario: An unreachable backend
- **WHEN** a user opens the Overview
- **THEN** the connections list shows Durable Objects as the default backend, serving `/documents` and `/shared`, and RustFS archive as Unreachable, serving `/archive`

#### Scenario: Checking connections
- **WHEN** a user selects Check connections
- **THEN** the button shows that the check is running, and an error notification then says that 3 backends were checked and RustFS archive is still unreachable

### Requirement: WebDAV address
The Overview SHALL show the WebDAV address in a read-only field the user can select, and SHALL offer a control that copies it, joined to the field. Where the row is too narrow for the control's words beside the whole address, the control SHALL show only its icon and keep its name. When the browser does not allow copying, the field SHALL say so and ask the user to copy the text themselves. Assistive technology SHALL hear the field named by its label alone.

#### Scenario: Copying the address
- **WHEN** a user selects Copy address
- **THEN** the clipboard holds `https://files.example.com/dav/` and the button reads Copied

#### Scenario: Copying is blocked
- **WHEN** the browser refuses access to the clipboard and a user selects Copy address
- **THEN** the field says that this browser blocked copying and asks the user to select the text and copy it

#### Scenario: The address field's name
- **WHEN** assistive technology reads the address field on the Overview
- **THEN** it hears it named "WebDAV address", its label alone

### Requirement: Recent operation errors
The Overview SHALL show each recent failed operation as a picture of its cause, named for assistive technology, the name of the file or folder it failed on, shortened before its extension so that the extension stays whole, and how long ago it failed, short on screen and in words for assistive technology, with the same count in both. Its details SHALL show the status code in the error color with the cause in words, the method and path, the reason in words, and when it failed.

#### Scenario: A rejected upload
- **WHEN** a user opens the Overview and opens the details of `holiday.mov`
- **THEN** the recent operation errors show `holiday.mov` with a picture named Too large and 5h, and its details show 413 in the error color with Too large, PUT `/photos/2026/holiday.mov`, that uploads over 100 MB do not fit one request on Cloudflare Free, and 5 hours ago

### Requirement: Views of recent errors
The recent operation errors SHALL offer three views, a list, a timeline and tiles, through a control beside their title, or under it where the row has no room, whose choices are pictures named for assistive technology and in a tooltip. A tooltip SHALL repeat its choice's name without also describing the choice, so that assistive technology reads the name once. The list SHALL show first, and the view chosen SHALL last for the visit.

#### Scenario: Choosing a view
- **WHEN** a user on the Overview points at each choice beside Recent operation errors, chooses Timeline, opens Files, comes back to the Overview, and reloads the page
- **THEN** each choice is a picture with its name in a tooltip, which assistive technology hears as the choice's name and not again as its description, the list shows first, the timeline shows once Timeline is chosen and again after the return, and the list shows after the reload

### Requirement: Errors as a list
The list SHALL give each error one line, starting where the panel's title does, with a chevron at its end. A tap anywhere on the line, or on its chevron, SHALL open the error's details under it in place, and another SHALL close them. Several SHALL stay open at once, and the chevron SHALL name its error and say whether its details are open.

#### Scenario: Opening an error in the list
- **WHEN** a user on a touch screen 320 px wide taps the line of `2026-11-16.tar.zst`, taps the line of `holiday.mov`, taps the line of `2026-11-16.tar.zst` again, and holds a finger on the line of `budget-2027.xlsx`
- **THEN** every line fits the window on one line, starts where the title does and keeps `.zst` whole, the first tap shows 504, Timed out, PUT `/archive/2026-11-16.tar.zst` and the reason under its line, both stay open after the second tap, the third closes `2026-11-16.tar.zst` alone, and the held line draws a rounded background inside the card

### Requirement: Errors on a timeline
The timeline SHALL place each error of the last 24 hours as a marker of its cause on a scale that gives the last hour more than half of its width, along an axis that starts where the panel's title does. A marker whose center would come within 46 px of the one before it, a marker's width and a gap, SHALL move onto a second lane, so that no marker covers another unless three fall that close. Pointing at a marker or moving to it with the arrow keys SHALL show the error's name and details.

#### Scenario: Reading the timeline
- **WHEN** a user in a window 1280 px wide chooses Timeline, points at the marker of `budget-2027.xlsx`, moves through the markers with the arrow keys, and then narrows the window to 375 px and to 320 px
- **THEN** the markers run from `holiday.mov` to `2026-11-16.tar.zst` from left to right, the tick marked 1h lies left of the middle with the two errors of the last hour after it, no two markers overlap and the axis starts where the title does at 1280 and 320 px, pointing shows `budget-2027.xlsx` with 423 and Locked above the timeline, each arrow key shows the next marker's details, and at 375 px the marker of `budget-2027.xlsx`, between 40 and 46 px after the one of `holiday.mov`, sits a lane above it

### Requirement: Timeline errors by touch and in words
Holding a finger on a marker of the timeline SHALL show the error's name and details while the finger holds. The timeline SHALL also say in words when each error happened and why.

#### Scenario: Holding a marker
- **WHEN** a user on a touch screen 375 px wide chooses Timeline, holds a finger on the marker of `holiday.mov`, and lifts it
- **THEN** while the finger holds, the details of `holiday.mov` with 413 show above the timeline, and they hide when the finger lifts

#### Scenario: The timeline in words
- **WHEN** assistive technology reads the timeline
- **THEN** its description names each error's file, cause and age, among them `holiday.mov`, too large, 5 hours ago

### Requirement: Errors as tiles
The tiles SHALL give each error a tile with a large picture of its cause, its age, and its file's name with a picture of its kind, at least two side by side on a phone. A tap on a tile SHALL show the error's details beside it until they are dismissed, and dismissing them SHALL return focus to the tile.

#### Scenario: Opening a tile
- **WHEN** a user on a touch screen 375 px wide chooses Tiles, taps the tile of `Drafts`, and dismisses its details with Escape
- **THEN** the tiles sit two side by side with every extension whole, the tap shows 412, Already exists, MOVE `/documents/Drafts → /shared/Drafts` and the reason beside the tile, and after Escape the details are gone and focus is on the tile of `Drafts`
