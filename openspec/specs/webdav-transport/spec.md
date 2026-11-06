# webdav-transport Specification

## Purpose
This spec defines how WebDAV requests reach the WebDAV entry point on Cloudflare Workers and Bun, and how request and response bodies are streamed. Protocol semantics are the responsibility of later protocol capabilities.

## Requirements

### Requirement: WebDAV methods reach the entry point
On both Cloudflare Workers and Bun, the system SHALL hand OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK and UNLOCK requests under `/dav/` to the same WebDAV entry point.

#### Scenario: All methods arrive
- **WHEN** a test client sends each of the methods above to `/dav/a.txt` on each of the two runtimes
- **THEN** the method and path the WebDAV entry point receives match what the client sent

#### Scenario: Non-WebDAV paths unaffected
- **WHEN** a client sends a GET request to `/api/health`
- **THEN** an API route handles the request, and it does not reach the WebDAV entry point

### Requirement: Request path and headers preserved
The system MUST hand the original percent-encoded path and the WebDAV request headers to the WebDAV entry point unchanged, and MUST NOT decode or drop them beforehand.

#### Scenario: Unicode and percent-encoded paths
- **WHEN** a client requests `/dav/%E6%96%87%E4%BB%B6%20a%2Fb.txt`
- **THEN** the path the WebDAV entry point gets is still `/dav/%E6%96%87%E4%BB%B6%20a%2Fb.txt`

#### Scenario: WebDAV request headers
- **WHEN** a request carries `Depth`, `Destination`, `If`, `Lock-Token`, `Overwrite` and `Timeout`
- **THEN** the values of these headers that the WebDAV entry point receives match what the client sent

### Requirement: Unimplemented protocol capabilities are not advertised
Until the protocol behavior is implemented, the production entry MUST return 501 for every method under `/dav/`, and the response MUST NOT include the `DAV` response header.

#### Scenario: OPTIONS advertises no capability
- **WHEN** a client sends OPTIONS to `/dav/` on the production entry
- **THEN** the response status code is 501, and the response does not contain the `DAV` response header

#### Scenario: Other methods
- **WHEN** a client sends PROPFIND or PUT to `/dav/a.txt` on the production entry
- **THEN** the response status code is 501

### Requirement: Streaming request bodies
The system MUST hand the request body to the WebDAV entry point part by part as it arrives, and MUST NOT wait for the complete request body to arrive or buffer the complete request body in memory.

#### Scenario: Data received before the upload ends
- **WHEN** a client sends the first part of a request body and then pauses, on each of the two runtimes
- **THEN** the WebDAV entry point receives the first part before the client sends the remaining data

#### Scenario: Memory use of a large file on Bun
- **WHEN** a client uploads a 1 GiB request body to the probe entry on Bun, and the WebDAV entry point discards the data as it reads
- **THEN** the upload succeeds, and the peak increase in the resident memory of the process stays below 128 MiB

#### Scenario: File pass-through to a Durable Object on Workers (requires a real deployment)
- **WHEN** a client uploads a 95 MB request body to the probe entry on Workers Free, and the WebDAV entry point passes the request stream straight to a Durable Object, which writes it to SQLite in chunks
- **THEN** the size and checksum of the content read back match the uploaded content, and the request does not fail by exceeding the CPU limit

### Requirement: Streaming response bodies
The system MUST send the response body part by part as it is generated, and MUST NOT wait for the complete response to be generated before sending begins.

#### Scenario: Data received before the download ends
- **WHEN** the WebDAV entry point writes the first part of a response and then pauses
- **THEN** the client receives the first part before the WebDAV entry point writes the second
