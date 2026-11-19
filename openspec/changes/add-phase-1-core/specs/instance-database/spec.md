# Spec Delta

## Purpose

Keeps Davloom's own records in the instance database, with the same behavior on Cloudflare D1 and on Bun SQLite, and with upgrades that keep the data already there.

## ADDED Requirements

### Requirement: The same records on D1 and Bun SQLite
Every read and write of Davloom's tables SHALL give the same result on D1 and on Bun SQLite, and a record SHALL stay as it was saved until it is changed or removed.

#### Scenario: One contract on both databases
- **WHEN** the database contract suite saves, lists, reads and removes storage backend records on D1 and on Bun SQLite
- **THEN** every case passes on both databases

#### Scenario: Records after a restart
- **WHEN** a caller saves a storage backend, and the instance restarts on the same database and lists the backends
- **THEN** the list holds the backend with the configuration that was saved

### Requirement: One schema from one set of migrations
D1 and Bun SQLite SHALL be built from the same migration files, and SHALL end up with the same tables, columns and indexes, apart from the tables that each database or migration runner keeps for itself: `d1_migrations`, `__drizzle_migrations`, and those whose names start with `_cf_` or `sqlite_`.

#### Scenario: The schema on both databases
- **WHEN** the migrations are applied to an empty D1 database and to an empty Bun SQLite database, and their schemas are read back without the tables each keeps for itself
- **THEN** both hold the same tables, columns and indexes

### Requirement: Upgrades keep existing data
Applying a newer release's migrations to a database that an older release created SHALL keep every existing row, and sign-in and API keys SHALL keep working. Applying migrations that are already applied SHALL change nothing.

#### Scenario: Upgrading a Phase 0 database
- **WHEN** a D1 database and a Bun SQLite database are created with the Phase 0 schema, each gets an administrator and an API key, and both are upgraded
- **THEN** on each database the administrator can still sign in, the API key still verifies, and a storage backend can be saved

#### Scenario: Applying migrations twice
- **WHEN** the migrations are applied again to an upgraded database
- **THEN** no error is raised and every table holds the rows it held before
