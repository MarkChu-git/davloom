# Spec Delta

## Purpose

Gives a one-page summary of the instance: where data is stored and whether it answers, which mounts publish it, how WebDAV clients connect, and which operations failed recently.

## ADDED Requirements

### Requirement: Storage summary
The Overview SHALL show the number of backends and how many answer, the number of mounts and how many backends they use, the number of objects, and the bytes stored, with the share of known capacity in use.

#### Scenario: Summary of the sample data
- **WHEN** a user opens the Overview
- **THEN** it shows 3 backends with 2 connected and 1 unreachable, 4 mounts on 3 backends, 24,597 objects, and 255.1 GB stored, of which 213.9 GB counts against 2 TB of known capacity

### Requirement: Connection status
The Overview SHALL list each backend with its status in an icon and words, its object count and its use of space, and SHALL offer to check every connection again and report the result. A result in which a backend still does not answer SHALL be reported as an error.

#### Scenario: An unreachable backend
- **WHEN** a user opens the Overview
- **THEN** the storage connections list shows RustFS archive as Unreachable

#### Scenario: Checking connections
- **WHEN** a user selects Check connections
- **THEN** the button shows that the check is running, and an error notification then says that 3 backends were checked and RustFS archive is still unreachable

### Requirement: Mounts
The Overview SHALL list each mount with its backend, bucket and prefix, and SHALL link to Storage & Mounts.

#### Scenario: The sample mounts
- **WHEN** a user opens the Overview
- **THEN** the mount list shows `/documents`, `/shared`, `/photos` and `/archive`, each with its backend and its bucket and prefix, and Manage mounts opens Storage & Mounts

### Requirement: WebDAV address
The Overview SHALL show the WebDAV address in a read-only field the user can select, offer a control that copies it, and point to Credentials for a key to sign in with. When the browser does not allow copying, the field SHALL say so and ask the user to copy the text themselves.

#### Scenario: Copying the address
- **WHEN** a user selects Copy address
- **THEN** the clipboard holds `https://files.example.com/dav/` and the button reads Copied

#### Scenario: Copying is blocked
- **WHEN** the browser refuses access to the clipboard and a user selects Copy address
- **THEN** the field says that this browser blocked copying and asks the user to select the text and copy it

### Requirement: Recent operation errors
The Overview SHALL list recent failed operations with when they happened, the method and path, the status code and the reason in words.

#### Scenario: A rejected upload
- **WHEN** a user opens the Overview
- **THEN** the list of recent operation errors includes a PUT that failed with status 413 because uploads over 100 MB do not fit one request on Cloudflare Free
