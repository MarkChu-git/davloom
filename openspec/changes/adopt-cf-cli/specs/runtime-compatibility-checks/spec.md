# Spec Delta

## ADDED Requirements

### Requirement: Cleanup listings are checked against the deployment
The Cloud Free flow MUST check, right after it creates the D1 test database and right after it uploads the probe Worker, that the listings it later uses to confirm the cleanup show the database, the Worker and the Worker's Durable Object namespace, retrying as the cleanup does, and MUST record what each listing showed in its state file. When a listing still misses its resource after the last retry, the flow MUST stop before measuring, and the cleanup MUST still run.

#### Scenario: Listings see the deployment (requires a real deployment)
- **WHEN** the D1 test database has been created and the probe Worker has been deployed
- **THEN** the listings of D1 databases, Workers and Durable Object namespaces each show the probe's resource before any measurement starts, and the state file records that they did

#### Scenario: A listing catches up
- **WHEN** the Workers listing shows the probe Worker only on a retry after the upload
- **THEN** the deploy step goes on, and the state file records that the listing showed the Worker

#### Scenario: A listing misses the deployment
- **WHEN** the Workers listing still does not show the probe Worker after the last retry that follows its upload
- **THEN** the deploy step exits with a non-zero status and names that listing, no measurement runs, and the full run still runs the cleanup

### Requirement: Absence counts only from a listing that showed the resource
The cleanup MUST count a probe resource as deleted only when a listing that showed it earlier in the same run no longer shows it. For a resource that the run started to create but that no listing showed, the cleanup MUST exit with an error that names the resource and keep the state file. A resource that the run never started to create needs no confirmation.

#### Scenario: A listing never showed the resource
- **WHEN** the cleanup runs after a deploy in which the Workers listing never showed the probe Worker
- **THEN** the cleanup exits with a non-zero status, names the Worker as unconfirmed and keeps the state file, although the listing does not show the Worker

#### Scenario: The run never started to upload the Worker
- **WHEN** a deploy stops after the D1 listing showed the test database but before it starts to upload the Worker, and the cleanup then runs
- **THEN** the cleanup neither deploys the tombstone nor deletes or confirms a Worker or a Durable Object namespace, and it counts the database as deleted only once the D1 listing no longer shows it

## MODIFIED Requirements

### Requirement: Probe entry isolation
The probe routes used by the compatibility tests MUST NOT enter the production entry. The probe Worker and test data in the cloud MUST be deleted after the measurement ends, and the deletion MUST be confirmed by listing the account's Workers, Durable Object namespaces and D1 databases. A listing that fails MUST stop the cleanup with an error and MUST NOT count as proof that a resource is gone.

#### Scenario: No probe routes in the production entry
- **WHEN** a client requests a probe route from the production entry
- **THEN** the response status code is 404

#### Scenario: Cleanup after the measurement (requires a real deployment, manual verification)
- **WHEN** the measurement ends
- **THEN** listings of the account's Workers, Durable Object namespaces and D1 databases show no probe Worker, no namespace of the probe's Durable Object class and no D1 test database, and the run removes its state file

#### Scenario: A listing fails during the cleanup
- **WHEN** a listing of Workers, Durable Object namespaces or D1 databases fails while the cleanup is being confirmed
- **THEN** the cleanup exits with a non-zero status, names the listing that failed, and keeps its state file so that a rerun can finish the cleanup

#### Scenario: A probe resource remains
- **WHEN** a listing still shows a probe resource after the last retry
- **THEN** the cleanup exits with a non-zero status, names the resource, and keeps its state file
