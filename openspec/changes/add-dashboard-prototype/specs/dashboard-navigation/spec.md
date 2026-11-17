# Spec Delta

## Purpose

Defines how users reach the Dashboard's pages and tell them apart, how the side navigation resizes and folds, where keyboard focus goes when a change removes the control that had it or closes the dialog that held it, and how the prototype keeps to sample data.

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

#### Scenario: Narrow screens
- **WHEN** a user opens each page, and a file's details, in a window 375 px wide
- **THEN** the side navigation is behind a menu button, neither the page's main region nor anything around it is wider than the window, and the dialog with the file's details fits inside the window

### Requirement: Resizing and folding the side navigation
The side navigation's edge SHALL resize it, by pointer or by arrow keys, between 200 and 400 px wide. The navigation SHALL fold to a rail of icons when dragged narrower than 200 px or with its collapse button, and the rail SHALL still mark Storage & Mounts. The browser SHALL keep the width and whether the navigation is folded for the next visit.

#### Scenario: Resizing the side navigation
- **WHEN** a user moves the navigation's edge with the right arrow key, drags it 80 px further to the right, then drags it far to the left, reloads the page and selects Expand sidebar
- **THEN** the navigation grew with each move, folded to its rail, was still folded after the reload, and opened again at the width it had before folding

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
