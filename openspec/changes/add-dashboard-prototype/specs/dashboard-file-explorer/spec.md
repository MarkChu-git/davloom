# Spec Delta

## Purpose

Lets users browse what each mount holds and change it from the Dashboard: upload, download, create folders, rename, move, copy and delete.

## ADDED Requirements

### Requirement: Folder in the address
The File Explorer SHALL show the folder that the `path` search parameter names and a breadcrumb that links to every folder above it. When the parameter names no folder, it SHALL list the mounts as folders, offer Manage mounts in place of the controls that change content, and let no row be selected. When the folder does not exist, it SHALL say so and offer no control that changes content.

#### Scenario: Opening a folder by its address
- **WHEN** a user opens `/files?path=/documents`
- **THEN** the breadcrumb reads Files / documents, and the list shows what `/documents` holds

#### Scenario: The top level
- **WHEN** a user opens `/files`
- **THEN** the list shows documents, shared, photos and archive as folders, Manage mounts takes the place of New folder and Upload, and no row can be selected

#### Scenario: A folder that does not exist
- **WHEN** a user opens `/files?path=/documents/missing`
- **THEN** the page says that the folder does not exist, offers Go to Files, and shows neither New folder nor Upload

### Requirement: Loading and empty folders
Until a folder's listing arrives, the File Explorer SHALL show placeholder rows in its place. A folder that holds nothing SHALL say so and offer New folder and Upload.

#### Scenario: A folder while it loads
- **WHEN** a user opens `/files?path=/documents`
- **THEN** placeholder rows show until the list of what `/documents` holds replaces them

#### Scenario: An empty folder
- **WHEN** a user creates the folder `Receipts` in `/documents` and opens it
- **THEN** the page says that the folder is empty and offers New folder and Upload

### Requirement: Sorting
The list SHALL sort by name, size or modification time in either direction, and folders SHALL stay above files in every order. A listing too narrow for its Size and Modified columns SHALL offer the same orders from a menu in place of its Name header, and the menu SHALL name the order in use.

#### Scenario: Sorting by size
- **WHEN** a user sorts `/documents` by size, first one way and then the other
- **THEN** both times every folder comes before every file, and the files are in size order

#### Scenario: Sorting a narrow listing
- **WHEN** a user in a window 375 px wide sorts `/documents` by size from the menu in place of the Name header, then largest first, then by modification time, and then widens the window to 1280 px
- **THEN** the menu names each order, every folder comes before every file, the files follow their size both ways and then their modification time, newest first, and the wide listing keeps that order and marks it on its Modified header

### Requirement: Search
Searching SHALL filter the current folder by name without regard to case, tell assistive technology how many items match, and say so when nothing matches.

#### Scenario: Matching names
- **WHEN** a user types `REPORT` into the search box in `/documents`
- **THEN** only the quarterly report remains, and a polite announcement says that 1 item matches

#### Scenario: No match
- **WHEN** a user searches `/documents` for `zzz`
- **THEN** the page says that nothing matches and offers to clear the search

### Requirement: Item details
Selecting a file SHALL show its location, size, modification time, type, backend and lock state, and a preview of a text file's content, and the `file` search parameter SHALL name it. On a page wider than 776 px beside the side navigation, which a window wider than 1024 px leaves beside the navigation at its default width, the details sit beside the list; on a narrower page they open in a dialog.

#### Scenario: Details beside the list
- **WHEN** a user opens `/files?path=/shared&file=wifi-guest.txt` in a window 1280 px wide
- **THEN** a panel beside the list gives the size as 120 bytes and previews the file's text

#### Scenario: Details in a dialog
- **WHEN** a user opens the same address in a window 375 px wide and then closes the dialog
- **THEN** the details had opened in a dialog named after the file, and the address no longer names a file

### Requirement: Long names
A name too long for its column SHALL end in an ellipsis before its extension, and the extension SHALL stay visible. Assistive technology SHALL get the whole name as one piece of text, not as the two parts on screen.

#### Scenario: A long log file name
- **WHEN** `/documents` is listed in a window 1280 px wide
- **THEN** the name of the exported log ends in an ellipsis followed by `.log`

#### Scenario: The name a screen reader hears
- **WHEN** `/documents` is listed
- **THEN** the link of the exported log is named with the log's whole file name

### Requirement: Unreachable backend
When a mount's backend does not answer, the File Explorer SHALL say that the folder cannot be listed, name the backend and the reason, and offer to try again, instead of showing an empty folder. New folder and Upload SHALL be unavailable and say that the backend is not answering. A try that fails again SHALL be announced as an error.

#### Scenario: Opening the archive
- **WHEN** a user opens `/files?path=/archive`
- **THEN** an error says that `/archive` cannot be listed because RustFS archive gave no answer within 30 s and offers Try again, and New folder and Upload cannot be used and say that RustFS archive is not answering

#### Scenario: Trying again
- **WHEN** a user selects Try again on `/files?path=/archive`
- **THEN** the button shows that it is working and keeps focus, and an assertive announcement then says that `/archive` still cannot be listed

### Requirement: Names
Creating a folder or renaming an item SHALL refuse an empty name, a name with a slash, `.`, `..`, and a name already used in the same folder. The reason SHALL appear only after the user submits. Each time the dialog opens, the name SHALL start as the item's own name for a rename, and empty for a new folder.

#### Scenario: A name already in use
- **WHEN** a user opens New folder in `/documents`, which shows no error, and submits the name `Drafts`
- **THEN** the dialog stays open and says that something with this name is already here

#### Scenario: Opening the name dialog again
- **WHEN** a user starts renaming Contracts in `/documents`, cancels, and chooses New folder
- **THEN** the name field is empty

### Requirement: Move and copy
Moving or copying SHALL offer as destinations the folders of every mount whose backend answers, except the folder that holds the items, the items themselves and the folders inside them, and SHALL refuse a destination that already holds an item with one of the names.

#### Scenario: Destinations for a folder
- **WHEN** a user chooses Move for `/documents/Drafts`
- **THEN** the destinations are `/documents/Contracts`, `/documents/Invoices 2026`, `/documents/Scans`, `/shared`, `/shared/Family`, `/photos`, `/photos/2025` and `/photos/2026`

#### Scenario: A name already at the destination
- **WHEN** a user copies `README.txt` from `/documents` into `/documents/Drafts` a second time
- **THEN** the dialog says that `README.txt` is already in `/documents/Drafts`, and nothing is copied

### Requirement: Delete
Deleting one or several items SHALL ask for confirmation, say that it cannot be undone, and report what was deleted.

#### Scenario: Deleting two files
- **WHEN** a user selects two files in `/documents`, chooses Delete and confirms
- **THEN** the confirmation named 2 items and said it cannot be undone, both files are gone, and a notification says that 2 items were deleted

### Requirement: Upload
Uploading SHALL accept several files dropped or chosen at once, show each file's progress and outcome, and report how the batch went. A file SHALL replace a file of the same name, and its upload SHALL fail with the reason when the file is over 100 MB, when a folder in the destination has its name, or when it is a folder or cannot be read.

#### Scenario: One file too large
- **WHEN** a user uploads a 2 KB text file and a 150 MB file to `/documents`
- **THEN** the text file appears in `/documents` with a preview, the large file is marked as over the 100 MB limit for one request on Cloudflare Free, and a notification says that 1 of 2 uploads failed

#### Scenario: Uploading a file again
- **WHEN** a user uploads a file named `README.txt` to `/documents`, which already holds one
- **THEN** `/documents` lists one `README.txt`, the uploaded one

#### Scenario: A file with a folder's name
- **WHEN** a user uploads a file named `Drafts` to `/documents`
- **THEN** its upload fails because a folder named `Drafts` is already there, and the folder is unchanged

#### Scenario: A dropped folder
- **WHEN** a user drops a folder onto the upload area
- **THEN** its upload fails and says to upload the files inside the folder

### Requirement: Download
Choosing Download for a file, from its row or from its details, SHALL confirm that the download started.

#### Scenario: Downloading from a row
- **WHEN** a user chooses Download in the row menu of `README.txt`
- **THEN** a notification says that `README.txt` is downloading
