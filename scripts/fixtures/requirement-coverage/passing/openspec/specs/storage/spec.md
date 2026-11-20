# storage Specification

## Purpose

A fixture spec for the requirement coverage tests.

## Requirements

### Requirement: Files

The fixture SHALL replace files and create collections.

#### Scenario: Replacing a file

- **WHEN** a file is replaced
- **THEN** it holds the new bytes

#### Scenario: Creating a collection

- **WHEN** a collection is created
- **THEN** it is empty

### Requirement: Listings

The fixture SHALL be listed without starting containers.

#### Scenario: Listing without containers

- **WHEN** the check lists the fixture's tests
- **THEN** no container starts

### Requirement: Mounts

The fixture SHALL be mounted by hand.

#### Scenario: Mounting by hand

- **WHEN** a maintainer mounts the fixture
- **THEN** it shows its files
