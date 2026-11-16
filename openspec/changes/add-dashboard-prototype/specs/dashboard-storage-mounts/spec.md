# Spec Delta

## Purpose

Shows where Davloom stores bytes and whether each backend answers, and decides which bucket and prefix each top-level WebDAV folder publishes.

## ADDED Requirements

### Requirement: Backends
Storage & Mounts SHALL show each backend with its kind, its connection status in an icon and words, its endpoint, its object count, the bytes it stores, its capacity when that is known, and the number of mounts it serves.

#### Scenario: The sample backends
- **WHEN** a user opens Storage & Mounts
- **THEN** Durable Objects shows 1.9 GB of 5 GB with a bar, R2 photos shows 41.2 GB with no fixed limit, and RustFS archive is marked Unreachable

### Requirement: Verifying a connection
Verifying a backend SHALL show the result next to the button and announce it to assistive technology, assertively when the backend still does not answer.

#### Scenario: A backend that still does not answer
- **WHEN** a user selects Verify connection for RustFS archive
- **THEN** the button shows that the check is running, then the card says that RustFS archive is still unreachable and an assertive announcement says the same

### Requirement: Adding and editing mounts
A mount SHALL need a folder name that is a single path segment, is neither `.` nor `..`, and is not used by another mount, a backend and a bucket; the prefix is optional. A new mount's backend SHALL start as the default backend chosen in Settings. A mount's folder name SHALL NOT change after it is created. Each time the form opens, it SHALL start from the mount it edits, or from the defaults for a new mount. A mount added here SHALL appear in Files and on the Overview.

#### Scenario: A folder name already in use
- **WHEN** a user adds a mount named `documents`
- **THEN** the form stays open and says that another mount already uses this folder

#### Scenario: A dot segment
- **WHEN** a user adds a mount named `..`
- **THEN** the form stays open and asks for another folder name

#### Scenario: Editing a mount
- **WHEN** a user chooses Edit for `/photos`
- **THEN** the form shows the mount's backend, bucket and prefix, and its folder name cannot be changed

#### Scenario: Opening the form again
- **WHEN** a user edits `/photos` and cancels, edits `/documents` and cancels, and then chooses Add mount
- **THEN** the second form shows the folder name `documents`, and Add mount starts with an empty folder name

### Requirement: Removing a mount
Removing a mount SHALL ask for confirmation and say that the files stay in the bucket and come back if the mount is added again.

#### Scenario: Removing a mount keeps its files
- **WHEN** a user chooses Remove for `/shared` and confirms
- **THEN** the confirmation said that the files stay in the bucket, and `/shared` is gone from the mount list and from the top level of Files
