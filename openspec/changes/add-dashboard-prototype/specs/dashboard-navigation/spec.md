# Spec Delta

## Purpose

Defines how users reach the Dashboard's pages and tell them apart, how the side navigation resizes, folds and becomes a dropdown on a phone, how every page fits the window, where keyboard focus goes when a change removes the control that had it or closes the dialog that held it, and how the prototype keeps to sample data.

## ADDED Requirements

### Requirement: Side navigation
The Dashboard SHALL list Overview, Files, Credentials, Storage & Mounts and Settings in a side navigation, mark the current page in it, mark Storage & Mounts while a storage backend is slow or unreachable, and change pages without reloading the document. The navigation's mark, its section heading, the icons of its links and its collapse button SHALL line up on one edge.

#### Scenario: Moving between pages
- **WHEN** a user on Overview selects Credentials in the side navigation
- **THEN** the Credentials page shows, the navigation marks Credentials as the current page, and the document was not reloaded

#### Scenario: Storage status in the navigation
- **WHEN** a user opens each page while one backend is unreachable, and then folds the navigation
- **THEN** the side navigation marks Storage & Mounts with an error glyph named "1 backend unreachable", which is part of the link's name, and once folded the glyph takes the place of the link's icon, and the link and its tooltip read "Storage & Mounts, 1 backend unreachable"

#### Scenario: One edge
- **WHEN** a user opens the Overview in a window 1280 px wide
- **THEN** the mark, the Manage heading, the icon of every link and the collapse button's icon start at the same distance from the window's left edge

### Requirement: One grid
Beside the side navigation, the navigation and every page SHALL share one grid: a 24 px gutter between each edge and what it holds, the brand and each page's title on one line a gutter below the top, and the navigation's first link and each page's content on one line a gutter below that. On a phone the gutter SHALL be 16 px.

#### Scenario: One grid
- **WHEN** a user opens each page in a window 1280 px wide
- **THEN** the page's title is level with the mark, the Overview link starts where the page's content starts, the mark is as far from the window's edge as the page's content is from the navigation, and the collapse button ends as far above the bottom

### Requirement: Titles on a touch screen
A page's title SHALL stay level with the brand where a touch screen's type scale makes the title larger.

#### Scenario: The title line on a touch screen
- **WHEN** a user opens each page on a touch tablet 820 px wide, where titles are 26 px
- **THEN** the page's title is level with the mark

### Requirement: Navigation on a phone
In a window narrower than 768 px, the side navigation's links SHALL drop down from a Menu button in a bar across the top. They SHALL stay links, with the current page and Storage & Mounts marked, and the dropdown SHALL close once a link is chosen or Escape is pressed, giving focus back to the button.

#### Scenario: The Menu button
- **WHEN** a user on the Overview in a window 320 px wide selects Menu, chooses Credentials, selects Menu again and presses Escape
- **THEN** the navigation's links drop down below the button inside the window, with Overview marked as the current page and Storage & Mounts marked as unreachable; Credentials opens without a reload, the dropdown closes and focus is on Menu; and Escape closes the dropdown again with focus on Menu

### Requirement: Fitting the window
Every page SHALL fit a window from 320 px wide up without scrolling sideways. A table without room for a column per detail SHALL become a list with a row per record that opens to show the record's other details and its actions, or for Files move those details into each row's first cell, so that every row's actions, or the chevron that shows them, stay in view.

#### Scenario: Narrow screens
- **WHEN** a user opens each page, the folder `/documents`, three Settings sections and a file's details in a window 320 px wide
- **THEN** the side navigation is behind a Menu button, no page scrolls sideways and nothing on it reaches past the window, the dialog with the file's details fits inside the window, and the Overview's connections list shows Default whole at the start of the line of the mounts it serves

#### Scenario: Tables beside the navigation
- **WHEN** a user opens each page and the folder `/documents` in a window 1024 px wide, and then widens the window to 1280 px on Credentials
- **THEN** no page scrolls sideways, Credentials lists each key as a row with its chevron in view at 1024 px, the chevron naming its key in a tooltip, and it shows a column per detail, Scope among them, at 1280 px

### Requirement: Rows on a phone
Where Credentials and Storage & Mounts list keys and mounts as rows, every row SHALL take one shape: the name in bold on a line of its own, then one line under it, a key's first characters with its status at the end of that line or a mount's backend, with a chevron at the row's end.

#### Scenario: Lists on a phone
- **WHEN** a user opens Credentials and Storage & Mounts on a touch screen 375 px wide, and Credentials on one 320 px wide
- **THEN** each key's row shows its name, its first characters and its status and nothing more, each mount's row shows its path and its backend and nothing more, every row's chevron is inside the window and says that its row is closed, no page scrolls sideways, and at both widths every key's name is whole, its first characters share the next line with its status, and the statuses end in one column

### Requirement: Opening a row
A tap anywhere on such a row, or on its chevron, SHALL open the row in place, and another SHALL close it. Every row SHALL start closed, and several SHALL stay open at once. An open key's row shows its access, scope, last use and expiry, with Revoke unless it is revoked, and a mount's its bucket and prefix with Edit and Remove. The chevron SHALL name its record, for assistive technology and in a tooltip, and say whether its row is open, and the details SHALL be a group of the same name.

#### Scenario: Opening a row
- **WHEN** a user on a touch screen 375 px wide taps the name of "Old tablet", the chevron of "Conference laptop", and the name of "Old tablet" again, revokes "Conference laptop" from its details, and then on Storage & Mounts opens `/photos`, closes Edit's dialog after a tap that left Edit unfocused, as Safari leaves it, cancels Edit, removes the mount, presses Shift+Tab and Enter, and adds a mount named `photos` again
- **THEN** "Old tablet" shows Read only, All mounts, 2 months ago, and Expired Sep 30, 2026 with no action, under its row, in a group named Details for key Old tablet, the two rows stay open together and fit a window 320 px wide, the second tap closes "Old tablet" alone, "Conference laptop" is then marked Revoked with no action left and focus is on its chevron, `/photos` shows the bucket `davloom-photos`, the prefix None on the line under it, Edit and Remove, focus goes to the chevron of `/photos` after the unfocused tap and back to Edit after Cancel, moves to the chevron of `/archive` once `/photos` is removed, Enter opens `/shared`, and the new `/photos` starts closed

### Requirement: Moving rows
When a row opens or closes, the rows under it SHALL move to their new places rather than jump there, and SHALL move there at once when the user asks for reduced motion.

#### Scenario: Rows that glide
- **WHEN** a user on a touch screen 375 px wide opens and then closes "Old tablet", once as usual and once with reduced motion
- **THEN** each time "Old tablet" opens or closes as usual, the row of "Conference laptop" under it passes through places between where it was and where it comes to rest, and each time with reduced motion that row is already at rest in the first frame after the tap

### Requirement: Pressed rows
A pressed row that opens SHALL show a background with rounded corners inside its card, not a band across it.

#### Scenario: Holding a row
- **WHEN** a user on a touch screen holds a finger on a key's row
- **THEN** the row shows a background with rounded corners, at least 8 px inside its card on either side

### Requirement: Buttons beside a title
Where a title has no room beside its buttons' words, the buttons SHALL show only their icons, named for assistive technology and in a tooltip, and SHALL stay on the title's row.

#### Scenario: Buttons beside a title
- **WHEN** a user opens Storage & Mounts in a window 320 px wide, points at Add mount, and widens the window to 414 px
- **THEN** Add mount shows only its icon at 320 px, named Add mount and with Add mount as its tooltip, shows its words at 414 px, and stays level with the title at both widths

### Requirement: Resizing and folding the side navigation
The side navigation's edge SHALL resize it, by pointer or by arrow keys, between 200 and 400 px wide. The navigation SHALL fold to a rail of icons when its edge is let go narrower than 160 px or flung towards there, when Enter is pressed on the edge, or with its collapse button, and let go at rest between 160 and 200 px it SHALL return to 200 px. The rail SHALL still mark Storage & Mounts. The browser SHALL keep the width and whether the navigation is folded for the next visit.

#### Scenario: Resizing the side navigation
- **WHEN** a user moves the navigation's edge with the right arrow key, drags it 80 px further to the right and then past 400 px, lets it go at rest 180 px from the window's edge, then 300 px and then 150 px from it, reloads the page, selects Expand sidebar, and presses Enter on the edge
- **THEN** the navigation grew with each move and stopped at 400 px, came back to 200 px from 180 px, was 300 px wide, folded to its rail from 150 px, was still folded after the reload, opened again at 300 px, the width it had before folding, and folded again on Enter

### Requirement: Page identity
Each page SHALL have its own document title and exactly one level-one heading, and the document SHALL declare English, the language of the interface.

#### Scenario: Titles and headings
- **WHEN** a user opens Overview, Files, Credentials, Storage & Mounts and Settings in turn
- **THEN** each document title is the page name followed by "| Davloom", each page has one level-one heading, and the root element's language is `en`

### Requirement: Focus after a change
When a change removes the control that had keyboard focus, or closes the panel or dialog that held it, focus SHALL move to the control that takes its place instead of falling back to the start of the page.

#### Scenario: Deleting a row
- **WHEN** a user selects the first row of `/documents`, chooses Delete and confirms
- **THEN** focus is on the link of the row that took its place

#### Scenario: Closing a file's details
- **WHEN** a user closes the details of `wifi-guest.txt` in `/shared`, beside the list in a window 1280 px wide or in the dialog of a window 1024 px wide
- **THEN** focus is on the link of that file's row

#### Scenario: Closing a dialog
- **WHEN** a user closes a form dialog or a confirmation with Cancel or with Escape
- **THEN** focus is on the control that opened it, or on the menu's button when an item of that menu opened it

#### Scenario: Clearing a selection
- **WHEN** a user selects Drafts and Scans in `/documents` and chooses Unselect All
- **THEN** focus is on the checkbox of Drafts

#### Scenario: Clearing finished uploads
- **WHEN** a user uploads a file to `/documents` and chooses Clear finished once it has uploaded
- **THEN** focus is on the upload area's button

#### Scenario: Removing a mount
- **WHEN** a user removes `/documents` from its actions menu and confirms
- **THEN** focus is on the actions menu of `/shared`, the mount that took its place

#### Scenario: A new name the search hides
- **WHEN** a user searches `con` in `/documents` and then creates the folder `Receipts`, or renames Contracts to `Leases`
- **THEN** focus is on the search field, because the search hides the new name

#### Scenario: Signing out a session
- **WHEN** a user signs out "Firefox on Windows" in the Sign-in and security section
- **THEN** focus is on Set up, the control just above the sessions

### Requirement: Sample data
Until the Dashboard reads from the API, every page SHALL show sample data, and no page SHALL send a request to the API. A change made on a page SHALL last until the document reloads.

#### Scenario: No requests to the API
- **WHEN** a user opens every page and creates a key, adds a mount and creates a folder
- **THEN** the browser sent no request to a path under `/api/` or `/dav/`

#### Scenario: Changes last for the visit
- **WHEN** a user adds the mount `/music` on Storage & Mounts and then opens Files
- **THEN** Files lists `music` at the top level, and after a reload it lists only the sample mounts
