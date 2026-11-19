# Spec Delta

## Purpose

Defines the file tree that every storage backend presents, so the WebDAV engine and the services above it behave the same on Durable Objects, R2 and S3-compatible storage.

## ADDED Requirements

### Requirement: A root that always exists
Every backend SHALL present a tree whose root is a collection. The root SHALL exist before anything is written to the backend, and removing or moving the root SHALL fail with a root error.

#### Scenario: The root of a new backend
- **WHEN** a client lists the root of a backend that has never been written to
- **THEN** the root is an empty collection

#### Scenario: Removing the root
- **WHEN** a client removes the root, and then moves it to `/elsewhere`
- **THEN** both operations fail with a root error and the tree is unchanged

### Requirement: Paths and names
A path SHALL be a sequence of names, and a backend SHALL store and list every name exactly as given, so names that differ in any code point name different entries. A name SHALL be well-formed Unicode of 1 to 255 bytes in UTF-8, not `.` or `..`, and free of `/` and NUL. A path SHALL take at most 900 bytes in UTF-8 with its names joined by `/`. Every operation SHALL check its paths before anything else, and fail with an invalid path error when one breaks these rules.

#### Scenario: Unicode and case
- **WHEN** a client creates the collections `Café`, `café`, `目录` and `🗂 2026` in the root and lists it
- **THEN** the listing holds four collections with exactly those names

#### Scenario: An invalid name
- **WHEN** a client writes files named `a/b`, `.`, `..`, an empty name, a name holding NUL, and a name holding a lone UTF-16 surrogate
- **THEN** each write fails with an invalid path error and the tree is unchanged

#### Scenario: The longest name and path
- **WHEN** a client creates a collection whose name takes 255 bytes in UTF-8 and one whose name takes 256, then a collection whose path takes 900 bytes and one whose path takes 901
- **THEN** the first and the third succeed, and the second and the fourth fail with an invalid path error

### Requirement: Creating a collection
Creating a collection SHALL add an empty collection at a path whose parent is a collection and which holds no entry. It SHALL fail, checking in this order, with an already-exists error when the path holds an entry, the root included, and with a missing-parent error when the parent does not exist or is a file.

#### Scenario: Creating nested collections
- **WHEN** a client creates `/a`, then `/a/b`, then `/a/b` again, then `/x/y`
- **THEN** the first two succeed, the third fails with an already-exists error, the fourth fails with a missing-parent error, and the root lists only `a`

### Requirement: Writing a file
Writing a file SHALL store the bytes of a stream at a path whose parent is a collection, creating the file or replacing the one there, and SHALL give the file a new etag whenever its bytes change. A write SHALL state its size in advance. It SHALL fail, checking in this order, with a collection error when the path holds a collection, the root included, and with a missing-parent error when the parent does not exist or is a file.

#### Scenario: Bytes across chunk boundaries
- **WHEN** a client writes files of 0, 1, 1,048,575, 1,048,576, 1,048,577 and 5,242,883 bytes of random data and reads each one back
- **THEN** each read returns the bytes that were written, with the same SHA-256, and reports the size that was written

#### Scenario: Replacing a file
- **WHEN** a client writes `/notes.txt`, writes different bytes to `/notes.txt`, and reads it
- **THEN** the read returns the second bytes, and the etag differs from the one the first write gave

#### Scenario: Writing where a collection is
- **WHEN** a client writes a file at `/a` while `/a` is a collection, and at `/x/y` while `/x` does not exist
- **THEN** the first write fails with a collection error, the second with a missing-parent error, and the tree is unchanged

### Requirement: A write delivers its stated size
A write whose stream ends before its stated size, or runs past it, SHALL fail with a size mismatch error and leave the path as it was: holding no entry, or the file that was there before.

#### Scenario: A short stream
- **WHEN** a client writes `/notes.txt`, then starts a second write to it that states 10 bytes and delivers 5
- **THEN** the second write fails with a size mismatch error, and a read of `/notes.txt` returns the bytes of the first write

#### Scenario: A long stream
- **WHEN** a client starts a write to `/new.txt` that states 5 bytes and delivers 10
- **THEN** the write fails with a size mismatch error, and `/new.txt` does not exist

### Requirement: Reading a file
Reading a file SHALL return its bytes as a stream, with its size, its etag and the time it was last written. It SHALL fail with a not-found error when the path holds no entry, and with a collection error when the path holds a collection.

#### Scenario: Reading what is not a file
- **WHEN** a client reads `/missing.txt`, and then the collection `/a`
- **THEN** the first read fails with a not-found error and the second with a collection error

### Requirement: Reads and writes at the same time
A read SHALL return in full the bytes that the file held when the read began, even when the file is replaced while the read streams. When the file is removed while a read streams, the read SHALL either return those bytes in full or fail, and SHALL never end short. Writes to different paths at the same time SHALL each store their own bytes.

#### Scenario: A download during a replace
- **WHEN** a client starts reading a 5 MiB file, another client replaces the file with other bytes before the read ends, and the first client then reads the file again
- **THEN** the first read returns the old bytes in full, and the second returns the new bytes

#### Scenario: A download during a removal
- **WHEN** a client starts reading a 5 MiB file, and another client removes the file before the read ends
- **THEN** the removal succeeds, and the read either returns the file's bytes in full or fails, without ending short

#### Scenario: Two uploads at once
- **WHEN** two clients write different 3 MiB files to `/a.bin` and `/b.bin` at the same time
- **THEN** both writes succeed, and each file reads back with the bytes its own client wrote

### Requirement: Describing an entry
Describing a path SHALL return the kind of the entry there, and for a file its size, its etag and the time it was last written, without reading its bytes. It SHALL fail with a not-found error when the path holds no entry.

#### Scenario: Describing a file and a collection
- **WHEN** a client writes 3 bytes to `/a.txt`, creates `/docs`, and describes `/a.txt`, `/docs` and `/missing`
- **THEN** `/a.txt` is a file of 3 bytes with the etag its write gave, `/docs` is a collection, and describing `/missing` fails with a not-found error

### Requirement: Listing a collection
Listing a collection SHALL return each entry directly inside it once, with its name and its kind, and for a file its size, its etag and the time it was last written. It SHALL fail with a not-found error when the path holds no entry, and with a not-a-collection error when the path holds a file.

#### Scenario: A listing's entries
- **WHEN** a client creates `/docs` and `/docs/sub`, writes 3 bytes to `/docs/a.txt` and a file to `/docs/sub/b.txt`, and lists `/docs`
- **THEN** the listing holds the file `a.txt` of 3 bytes and the collection `sub`, and does not hold `b.txt`

#### Scenario: Listing what is not a collection
- **WHEN** a client lists `/missing`, and then the file `/docs/a.txt`
- **THEN** the first listing fails with a not-found error and the second with a not-a-collection error

### Requirement: Removing an entry
Removing an entry SHALL delete a file, or a collection with everything inside it. It SHALL fail, checking in this order, with a root error for the root and with a not-found error when the path holds no entry.

#### Scenario: Removing a collection
- **WHEN** a client removes `/docs`, which holds files and a collection with files in it
- **THEN** `/docs` and every entry inside it no longer exist, and every entry outside it is unchanged

#### Scenario: Removing what is missing
- **WHEN** a client removes `/missing`
- **THEN** the removal fails with a not-found error and the tree is unchanged

### Requirement: Copying an entry
Copying SHALL duplicate a file, or a collection with everything inside it, at a destination that holds no entry and whose parent is a collection, and SHALL leave the source unchanged. It SHALL fail, checking in this order, with a not-found error for a missing source, an into-itself error when a source collection's destination lies strictly inside it, an already-exists error for an occupied destination, and a missing-parent error when the destination's parent is missing or a file.

#### Scenario: Copying a collection
- **WHEN** a client copies `/docs`, which holds files and a nested collection with files in it, to `/backup`
- **THEN** `/backup` holds the same entries with the same bytes, and `/docs` is unchanged

#### Scenario: Copying to a bad destination
- **WHEN** a client copies `/docs` to `/docs/inner`, then to `/docs`, then to `/missing/docs`
- **THEN** the copies fail with an into-itself error, an already-exists error and a missing-parent error, in that order, and the tree is unchanged

### Requirement: Moving an entry
Moving SHALL put a file, or a collection with everything inside it, at a destination that holds no entry and whose parent is a collection, and SHALL remove it from its source. It SHALL fail with a root error when the source is the root, and otherwise with the errors of copying, checked in the same order.

#### Scenario: Renaming a collection
- **WHEN** a client creates `/archive` and moves `/docs`, which holds files and a nested collection with files in it, to `/archive/docs-2026`
- **THEN** `/archive/docs-2026` holds the same entries with the same bytes, and `/docs` no longer exists

### Requirement: Paths that copies and moves create
Copying or moving a collection SHALL fail with a path-too-long error, and change nothing, when a path that it would create under the destination takes more than 900 bytes in UTF-8. Of the errors of copying and moving, this one SHALL be checked last.

#### Scenario: Copies and moves that would make a path too long
- **WHEN** a client creates `/a` holding a file whose path takes 900 bytes, copies `/a` to `/ab`, moves `/a` to `/ab`, and then moves `/a` to `/b`
- **THEN** the copy and the first move fail with a path-too-long error, and the second move succeeds, leaving the file at a path of 900 bytes under `/b`

### Requirement: An unavailable backend
When a backend cannot be reached, or answers with an error that is not one of this capability's errors, the operation SHALL fail with an unavailable error that names the backend and carries none of its credentials.

#### Scenario: An S3 endpoint that does not answer
- **WHEN** a client lists the root of an S3-compatible backend whose endpoint refuses connections
- **THEN** the listing fails with an unavailable error that names the backend, and the error's text holds neither the backend's access key nor its secret key

### Requirement: A valid namespace
The namespace model SHALL count a namespace as valid when every entry has an id that neither the root nor any other entry has, and that no new entry can be given; every entry except the root has a parent that is a collection; no collection holds two entries with the same name; following the parents from any entry reaches the root, so there is no cycle; and every entry's path keeps the rules of paths and names.

#### Scenario: Namespaces that are not valid
- **WHEN** the tests check, with the predicate that `LAWS.bend` states, namespaces in which two entries share an id, an entry has the root's id or one that a new entry could be given, a file is a parent, two entries in one collection share a name, the parents form a cycle, or a path takes 901 bytes
- **THEN** none of them is valid, while the namespace after every step of the other scenarios run on the model is valid

### Requirement: The namespace laws
Davloom's namespace model SHALL keep these laws, stated in `LAWS.bend` and proven in `PROOF.bend`: a new namespace, which holds only the root, is valid, and every operation keeps a valid namespace valid.

#### Scenario: Laws under generated operations
- **WHEN** the property tests apply generated sequences of creating, writing, removing, copying and moving to the compiled namespace model, including moves of a collection into its own subtree and moves that lengthen the paths under it
- **THEN** the namespace is valid after every step

### Requirement: The decision laws
The model's decisions SHALL keep two more laws, stated in `LAWS.bend` and proven in `PROOF.bend`: the model accepts a path exactly when it keeps the rules of paths and names, and each operation, given the facts it reads, gives the outcome and the first error that this capability's requirements state.

#### Scenario: Paths under generated strings
- **WHEN** the property tests give the compiled namespace model generated paths, including names with `/`, NUL, lone surrogates, `.` and `..`, names near 255 bytes and paths near 900 bytes
- **THEN** the model accepts each path exactly when it keeps the rules of paths and names

#### Scenario: Outcomes under generated facts
- **WHEN** the property tests give each decision function of the compiled namespace model generated facts
- **THEN** each gives the outcome, and the first error, that this capability's requirements state for those facts

### Requirement: Every backend matches the model
Every storage adapter SHALL behave as the namespace model does, on each runtime it supports. Apart from the insufficient-storage, too-large, hidden-objects and unavailable errors, which the model does not give, an operation SHALL succeed on the adapter exactly when it succeeds on the model, fail with the model's error otherwise, and leave the adapter's tree and file bytes equal to the model's.

#### Scenario: Backends match the model
- **WHEN** the contract suite runs the same generated sequences of operations on the model and on the Durable Objects, R2 and S3-compatible adapters on Workers, and on the S3-compatible adapter on Bun, starting from empty backends
- **THEN** every operation has the same outcome on the model and on each adapter, and each adapter's tree and file bytes equal the model's after every step
