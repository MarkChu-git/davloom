# Spec Delta

## Purpose

Collects the administrator's settings in one place: profile, sign-in, appearance, how WebDAV clients connect, the default backend for new mounts, data export and information about the instance.

## ADDED Requirements

### Requirement: Sections
Settings SHALL offer the sections Profile, Sign-in and security, Appearance, WebDAV, Storage, Data export and About this instance. The `section` search parameter SHALL name the open section, and a missing or unknown value SHALL open Profile.

#### Scenario: Opening a section by its address
- **WHEN** a user opens `/settings?section=webdav`
- **THEN** the WebDAV section shows, and the section list marks WebDAV as current

#### Scenario: An unknown section
- **WHEN** a user opens `/settings?section=billing`
- **THEN** the Profile section shows

### Requirement: Sections on narrow screens
At 1024 px and below, Settings SHALL replace the section list with a selector above the open section, so that the section keeps the full width beside the side navigation, or the whole window once the navigation is behind its menu button.

#### Scenario: A phone-sized window
- **WHEN** a user opens `/settings?section=webdav` in a window 375 px wide and chooses Storage in the selector
- **THEN** the selector showed WebDAV, the Storage section now shows, and nothing on the page is wider than the window

#### Scenario: A tablet-sized window
- **WHEN** a user opens `/settings?section=webdav` in a window 900 px wide
- **THEN** a selector above the section shows WebDAV in place of the section list, and nothing on the page is wider than the window

### Requirement: Profile
The Profile section SHALL let the user change the display name and email and save them, and each field SHALL declare its autofill purpose to the browser. Saving SHALL refuse an empty display name and an email address without an @ between two parts. A saved profile SHALL last for the visit.

#### Scenario: Autofill purposes
- **WHEN** a user opens the Profile section
- **THEN** the display name field declares `name` and the email field declares `email` as its autocomplete purpose

#### Scenario: Saving the profile
- **WHEN** a user changes the display name to "Home admin", selects Save profile, opens Overview and comes back to Profile
- **THEN** the display name field holds "Home admin"

#### Scenario: A profile without a name
- **WHEN** a user clears the display name, enters `home-admin` as the email and selects Save profile
- **THEN** both fields say what is wrong, and no notification says that the profile was saved

### Requirement: Sign-in and security
The Sign-in and security section SHALL show when the password last changed and whether two-step verification is on, and SHALL list the signed-in sessions, marking the current one and offering to sign out each of the others.

#### Scenario: Signing out another session
- **WHEN** a user selects Sign out next to "Firefox on Windows"
- **THEN** that session leaves the list, and the current session offers no sign-out

### Requirement: Appearance setting
The Appearance section SHALL offer Light, Dark and System, with the mode in use selected.

#### Scenario: The modes on offer
- **WHEN** a user who has not chosen a mode opens the Appearance section
- **THEN** it offers Light, Dark and System, with System selected

### Requirement: WebDAV settings
The WebDAV section SHALL show the WebDAV address with a control that copies it.

#### Scenario: Connecting a client
- **WHEN** a user opens the WebDAV section
- **THEN** it shows `https://files.example.com/dav/` with Copy address

### Requirement: Default backend
The Storage section SHALL let the user choose the backend that new mounts start with, and the choice SHALL last for the visit once saved.

#### Scenario: A new default
- **WHEN** a user chooses R2 photos as the default backend, selects Save storage settings, and then chooses Add mount on Storage & Mounts
- **THEN** the mount form's backend is R2 photos

### Requirement: Data export
The Data export section SHALL export the instance's data to a file and confirm the export with the file name.

#### Scenario: Exporting
- **WHEN** a user selects Export
- **THEN** the button shows that the export is running, and a notification then names `davloom-export-2026-11-16.json`

### Requirement: Instance information
The About this instance section SHALL show the instance's name, version, commit, deployment, runtime, database, region and WebDAV address.

#### Scenario: The sample instance
- **WHEN** a user opens About this instance
- **THEN** it shows the deployment Cloudflare Free, the runtime Cloudflare Workers and the database Cloudflare D1
