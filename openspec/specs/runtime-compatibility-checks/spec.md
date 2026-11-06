# runtime-compatibility-checks Specification

## Purpose
This spec uses repeatable tests to verify that the chosen combination of technologies works on Workers and Bun, and records measurements of the Cloud Free limits as a basis for version upgrades and later design.

## Requirements

### Requirement: Local compatibility tests without a cloud account
The project SHALL provide one command that runs the compatibility tests on the Workers runtime and on Bun in an environment without Cloudflare credentials. Test cases that need a real deployment MUST be marked as skipped, and a skipped case is not counted as a failure.

#### Scenario: No cloud credentials
- **WHEN** a contributor runs the compatibility test command in an environment without Cloudflare credentials
- **THEN** the local cases run on both runtimes, the cases that need a real deployment show as skipped, and the command exits with status 0

### Requirement: Business errors map to deterministic HTTP responses
The API entry MUST map the success results and declared errors of the business orchestration layer to deterministic HTTP responses. An unexpected defect MUST return 500, and the response MUST NOT include internal error details.

#### Scenario: Business success
- **WHEN** a business program completes successfully on either runtime
- **THEN** the response contains the program's result and the matching success status code

#### Scenario: Declared error
- **WHEN** a business program fails with a declared error
- **THEN** the response uses the status code and error code that correspond to that error

#### Scenario: Unexpected defect
- **WHEN** a business program throws an undeclared defect
- **THEN** the response status code is 500, and the response body contains no error message or stack trace

### Requirement: Identity components behave the same on both databases
The same identity configuration and database schema MUST support admin login and the creation, verification and revocation of API Keys on both D1 and Bun SQLite.

#### Scenario: Admin login
- **WHEN** an administrator logs in on each of the two databases, once with the correct password and once with a wrong password
- **THEN** the correct password establishes a Session, and the wrong password is rejected without establishing a Session

#### Scenario: API Key lifecycle
- **WHEN** an API Key is created on each of the two databases, verified, revoked and then verified again
- **THEN** verification succeeds before revocation and fails after it, and the database does not store the Key in plaintext

### Requirement: Design system and frontend framework integration
The Dashboard production build MUST render the interactive components of the design system in SPA mode, and MUST NOT produce console errors at runtime. The production build SHALL be servable from both Workers static assets and Bun.

#### Scenario: Interactive components
- **WHEN** Playwright opens the example page of the production build and operates a Dialog and a Menu with the keyboard
- **THEN** the components open and close normally, focus returns to the trigger element, and the console shows no errors

#### Scenario: Deep routes
- **WHEN** the production build is served separately by the local Workers runtime and by Bun, and a deep route is opened directly
- **THEN** the page renders that route normally

### Requirement: Cloud Free limit measurements
The project SHALL measure, on a real Workers Free deployment, resource consumption including authenticated requests and the platform limits, and record the data in the findings document.

#### Scenario: CPU of authenticated requests (requires a real deployment)
- **WHEN** 100 consecutive probe requests carrying an API Key and 20 consecutive admin password login requests are sent
- **THEN** the findings document records the CPU time distribution of both kinds of requests and how many times they exceeded the limit

#### Scenario: Startup overhead (requires a real deployment)
- **WHEN** the probe Worker is deployed
- **THEN** the findings document records the compressed size and the startup time

#### Scenario: Request body limit (requires a real deployment)
- **WHEN** a 95 MB request body and a 105 MB request body are uploaded separately
- **THEN** the 95 MB upload is written successfully and the 105 MB upload returns 413

#### Scenario: Directory operation limit (requires a real deployment)
- **WHEN** the probe entry, within one authenticated request, copies and deletes the objects in a Durable Object one by one, until it hits a platform limit or reaches the configured measurement cap
- **THEN** the findings document records the maximum number of objects that one request completes, together with its CPU time and the number of rows written, and gives the synchronous processing limit for directory COPY/MOVE

#### Scenario: Quota consumption (requires a real deployment)
- **WHEN** one directory PROPFIND probe request carrying an API Key is sent
- **THEN** the findings document records the number of D1 rows read and written and the number of Durable Object rows read and written by that request

#### Scenario: Durable Object CPU limit (requires a real deployment)
- **WHEN** the CPU load of a single request inside a Durable Object on Workers Free is increased step by step until the request fails or exceeds the 30 seconds stated in the documentation
- **THEN** the findings document records the maximum CPU time that completed successfully and the behavior when the limit is exceeded, and judges whether the 30-second limit holds on Free

### Requirement: Probe entry isolation
The probe routes used by the compatibility tests MUST NOT enter the production entry. The probe Worker and test data in the cloud MUST be deleted after the measurement ends.

#### Scenario: No probe routes in the production entry
- **WHEN** a client requests a probe route from the production entry
- **THEN** the response status code is 404

#### Scenario: Cleanup after the measurement (requires a real deployment, manual verification)
- **WHEN** the measurement ends
- **THEN** the Cloudflare account no longer contains the probe Worker, its Durable Object namespace or the D1 test database

### Requirement: Traceable verification findings
Each round of compatibility verification MUST produce a findings document that records the result, data, dependency versions and follow-up actions of each item on the verification checklist. When a verification fails, the data and the available options MUST be recorded, and the failure MUST NOT be bypassed silently, for example by lowering security parameters.

#### Scenario: Checklist fully covered (manual verification)
- **WHEN** the Phase 0 findings document is reviewed
- **THEN** every item on the PRD Phase 0 verification checklist has a result, evidence and dependency versions

#### Scenario: Verification fails (manual verification)
- **WHEN** a verification item fails, for example admin password login exceeds the CPU limit
- **THEN** the document states the data and the available options, and the technology choice and the security parameters stay unchanged until the maintainer decides
