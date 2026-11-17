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

### Requirement: Storage by backend
The Overview SHALL chart the bytes stored on each backend, largest first, with each backend's bytes beside its bar and in the chart's description in words, and SHALL link to Storage & Mounts.

#### Scenario: The sample backends
- **WHEN** a user opens the Overview
- **THEN** the chart shows RustFS archive with 212 GB, R2 photos with 41.2 GB and Durable Objects with 1.9 GB, in that order, and Manage storage opens Storage & Mounts

#### Scenario: The storage chart in words
- **WHEN** assistive technology reads the storage chart
- **THEN** its description says that RustFS archive stores 212 GB, R2 photos 41.2 GB and Durable Objects 1.9 GB

### Requirement: Charts on a touch screen
On a touch screen, a chart SHALL show a point's values only while a finger holds the chart. A press held for half a second SHALL show the values of the point under the finger, above the chart where the finger does not cover them; sliding the finger SHALL move along the chart without scrolling the page; and lifting the finger SHALL hide the values. A tap SHALL show nothing, and a swipe that starts on a chart SHALL scroll the page.

#### Scenario: Holding a chart
- **WHEN** a user on a phone taps the storage chart, then holds a finger on the RustFS archive bar, slides it to R2 photos, lifts it, and swipes up from the chart
- **THEN** the tap shows nothing, the hold shows RustFS archive's values above the chart, the slide shows R2 photos' values while the page stays still, the values hide when the finger lifts, and the swipe scrolls the page without showing any

### Requirement: Connection status
The Overview SHALL list each backend with its status in an icon and words and the mounts it serves, SHALL mark the default backend, and SHALL offer to check every connection again and report the result. A result in which a backend still does not answer SHALL be reported as an error.

#### Scenario: An unreachable backend
- **WHEN** a user opens the Overview
- **THEN** the connections list shows Durable Objects as the default backend, serving `/documents` and `/shared`, and RustFS archive as Unreachable, serving `/archive`

#### Scenario: Checking connections
- **WHEN** a user selects Check connections
- **THEN** the button shows that the check is running, and an error notification then says that 3 backends were checked and RustFS archive is still unreachable

### Requirement: WebDAV address
The Overview SHALL show the WebDAV address in a read-only field the user can select, and SHALL offer a control that copies it, joined to the field. Where the row is too narrow for the control's words beside the whole address, the control SHALL show only its icon and keep its name. When the browser does not allow copying, the field SHALL say so and ask the user to copy the text themselves.

#### Scenario: Copying the address
- **WHEN** a user selects Copy address
- **THEN** the clipboard holds `https://files.example.com/dav/` and the button reads Copied

#### Scenario: Copying is blocked
- **WHEN** the browser refuses access to the clipboard and a user selects Copy address
- **THEN** the field says that this browser blocked copying and asks the user to select the text and copy it

### Requirement: Recent operation errors
The Overview SHALL list recent failed operations with when they happened, the method and path, the status code in the error color, and the reason in words.

#### Scenario: A rejected upload
- **WHEN** a user opens the Overview
- **THEN** the list of recent operation errors includes a PUT that failed with status 413 because uploads over 100 MB do not fit one request on Cloudflare Free
