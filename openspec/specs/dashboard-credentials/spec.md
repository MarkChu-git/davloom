# dashboard-credentials Specification

## Purpose
Lets the administrator create, scope and revoke the API keys that WebDAV clients sign in with, so that each device or person can lose access without affecting the others.

## Requirements

### Requirement: Key list
Credentials SHALL list every key with its name, the first characters of the key, its access, its scope, when it was last used, when it expires, and its state: Revoked once revoked, otherwise Expired from its expiry time on, otherwise Active. Where a key's expiry has a label of its own, as in an opened row, the label SHALL read Expired from the key's expiry time on, whether or not the key was revoked, and Expires before it.

#### Scenario: The sample keys
- **WHEN** a user opens Credentials
- **THEN** the list shows five keys, among them "Phone photo backup" scoped to `/photos`, "Old tablet" marked Revoked and "Conference laptop" marked Expired

#### Scenario: A revoked key past its expiry
- **WHEN** a user on a phone opens the rows of "Old tablet", "Conference laptop" and "Phone photo backup"
- **THEN** the first two say Expired, Sep 30, 2026 and Oct 31, 2026, though "Old tablet" is marked Revoked, and "Phone photo backup" says Expires, May 1, 2027

### Requirement: Creating a key
Creating a key SHALL require a name and SHALL let the user limit the key to a mount or to a folder inside it, make it read only, and choose when it expires: in 30, 90 or 365 days, or never. The folder can be set only once a mount is chosen, and a folder whose path has a `.` or `..` segment SHALL be refused, so that a key never reaches outside its mount. Spaces around a segment of the folder are dropped, since the Dashboard never names a folder that way.

#### Scenario: A key without a name
- **WHEN** a user submits the form without a name
- **THEN** the form stays open and asks for a name, which it did not do before the submit

#### Scenario: A folder outside the mount
- **WHEN** a user limits a key to `/documents` with the folder `../photos` and submits
- **THEN** the form stays open and says that the folder must be inside the mount, without `.` or `..` in its path

#### Scenario: A folder needs a mount
- **WHEN** the mount is "All mounts"
- **THEN** the folder field cannot be used

### Requirement: Key shown once
After a key is created, the same dialog SHALL show the whole key once, with a control that copies it. Once the user closes the dialog, the page SHALL no longer hold the whole key, and the list SHALL show only its first characters.

#### Scenario: Creating a key
- **WHEN** a user creates a key named "Work laptop" that expires in 90 days
- **THEN** the dialog shows the whole key with Copy key, and after Done the page no longer contains the key, and the list shows "Work laptop" first, expiring on Feb 14, 2027, with only its first characters

### Requirement: Revoking a key
Revoking a key SHALL ask for confirmation and say that clients signed in with it lose access and that this cannot be undone. A revoked key SHALL be marked Revoked and SHALL NOT offer Revoke again.

#### Scenario: Revoking a key
- **WHEN** a user chooses Revoke for "Laptop (Finder)" and confirms
- **THEN** the key is marked Revoked, and its actions menu offers Revoke only as unavailable
