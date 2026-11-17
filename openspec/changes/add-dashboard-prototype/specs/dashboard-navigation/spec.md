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

### Requirement: Navigation on a phone
In a window narrower than 768 px, the side navigation's links SHALL drop down from a Menu button in a bar across the top. They SHALL stay links, with the current page and Storage & Mounts marked, and the dropdown SHALL close once a link is chosen or Escape is pressed, giving focus back to the button.

#### Scenario: The Menu button
- **WHEN** a user on the Overview in a window 320 px wide selects Menu, chooses Credentials, selects Menu again and presses Escape
- **THEN** the navigation's links drop down below the button inside the window, with Overview marked as the current page and Storage & Mounts marked as unreachable; Credentials opens without a reload, the dropdown closes and focus is on Menu; and Escape closes the dropdown again with focus on Menu

### Requirement: Fitting the window
Every page SHALL fit a window from 320 px wide up without scrolling sideways. A table without room for a column per detail SHALL become a list with a row per record, or for Files move those details into each row's first cell, so that the actions of every row stay in view.

#### Scenario: Narrow screens
- **WHEN** a user opens each page, the folder `/documents`, three Settings sections and a file's details in a window 320 px wide
- **THEN** the side navigation is behind a Menu button, no page scrolls sideways and nothing on it reaches past the window, and the dialog with the file's details fits inside the window

#### Scenario: Tables beside the navigation
- **WHEN** a user opens each page and the folder `/documents` in a window 1024 px wide, and then widens the window to 1280 px on Credentials
- **THEN** no page scrolls sideways, Credentials lists each key as a row with its menu in view at 1024 px, and it shows a column per detail, Scope among them, at 1280 px

### Requirement: Rows and buttons on a phone
Where Credentials and Storage & Mounts list keys and mounts as rows, every row SHALL take one shape: the name in bold, a key's status at the end of the name's line, at most two lines of details beneath, each kept to one line, and the row's menu level with the name. Where a title has no room beside its buttons' words, the buttons SHALL show only their icons, named for assistive technology and in a tooltip, and SHALL stay on the title's row.

#### Scenario: Lists on a phone
- **WHEN** a user opens Credentials and Storage & Mounts in a window 375 px wide
- **THEN** each key is a row with its name, its status, its access and scope, and when it was last used and expires, each mount is a row with its path, its backend and its bucket, every row's menu is inside the window, and no page scrolls sideways

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
