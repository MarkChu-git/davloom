# Spec Delta

## Purpose

Lets an instance keep the configuration of each storage backend it uses, protect the credentials in it, and reach each backend from the runtimes that support it.

## ADDED Requirements

### Requirement: Backend configurations
An instance SHALL keep a configuration for each storage backend, with an id, a name and one kind: Durable Objects; R2, with a Workers binding and a key prefix; or S3-compatible, with an endpoint, a region, a bucket, a key prefix, a path-style flag, an access key and a secret key. A prefix SHALL default to empty and path-style to off. Saving a configuration that lacks a field its kind needs, or holds an invalid one, SHALL fail with an error naming the field and store nothing.

#### Scenario: Saving each kind of backend
- **WHEN** a caller saves a Durable Objects backend, an R2 backend that names the binding `PHOTOS`, and an S3-compatible backend for the bucket `archive` at `http://localhost:9000` with path-style on, and lists the backends
- **THEN** the list holds the three backends with their names, kinds and fields, and no secret key

#### Scenario: A backend missing a field
- **WHEN** a caller saves an S3-compatible backend without a bucket
- **THEN** the save fails with an error that names `bucket`, and the list of backends is unchanged

### Requirement: Valid backend fields
A backend name SHALL be well-formed Unicode of 1 to 100 bytes in UTF-8 with no control characters. A key prefix SHALL be empty, or end with `/`, take at most 100 bytes in UTF-8, and have only valid storage-namespace names between its slashes. An endpoint SHALL be an absolute `http` or `https` URL with no user, password, query or fragment. A binding SHALL hold only ASCII letters, digits and underscores, not first a digit. A bucket, region, access key and secret key SHALL not be empty.

#### Scenario: Invalid backend fields
- **WHEN** a caller saves backends whose key prefix is `davloom`, `a//b/` or `../`, whose endpoint is `ftp://host`, `https://user:pass@host` or `not a url`, and whose binding is `9PHOTOS`
- **THEN** each save fails with an error that names the field, no error's text holds `pass`, and the list of backends is unchanged

### Requirement: Field types
A backend's path-style flag SHALL be a boolean, and each of its other fields a string. A field of another type SHALL count as invalid.

#### Scenario: A field of the wrong type
- **WHEN** a caller saves an S3-compatible backend whose path-style flag is the string `yes`, and one whose bucket is the number 7
- **THEN** both saves fail with an error that names the field, and the list of backends is unchanged

### Requirement: Backend names are unique
No two backends of an instance SHALL share a name, comparing names code point by code point.

#### Scenario: Two backends with one name
- **WHEN** a caller saves a backend named `Photos`, and then another backend named `Photos`
- **THEN** the second save fails with a name-taken error, and only the first backend is listed

### Requirement: One Durable Object per backend
Each Durable Objects backend SHALL keep its tree and file bytes in a Durable Object of its own, and two Durable Objects backends SHALL never share an entry.

#### Scenario: Two Durable Objects backends
- **WHEN** a caller writes `/a.txt` to one Durable Objects backend and lists the root of another
- **THEN** the second backend's root is empty

### Requirement: A full Durable Objects backend
When a Durable Objects backend's object is full, creating a collection, writing, copying and moving SHALL fail with an insufficient-storage error and change nothing, while describing, reading, listing and removing keep working, so that removing entries frees space.

#### Scenario: Writing to a full backend
- **WHEN** the object's storage is full while a caller writes `/big.bin`, and the caller then moves `/old.bin` to `/older.bin`, reads `/old.bin` and removes it
- **THEN** the write and the move fail with an insufficient-storage error and leave the tree unchanged, and the read and the removal succeed

### Requirement: Removing a backend
Removing an R2 or S3-compatible backend's configuration SHALL leave the objects in its bucket untouched. A Durable Objects backend SHALL be removable only while its tree is empty, and removing it SHALL delete everything its object stores, because no configuration can reach that object again.

#### Scenario: Removing a Durable Objects backend that holds files
- **WHEN** a caller removes a Durable Objects backend whose root holds `/a.txt`, then removes `/a.txt`, and removes the backend again
- **THEN** the first removal fails with a not-empty error and the backend is still listed, and the second removal succeeds and leaves the object's storage holding no data

#### Scenario: Removing an S3-compatible backend
- **WHEN** a caller removes an S3-compatible backend whose bucket holds files
- **THEN** the backend is no longer listed, and the bucket still holds the files

### Requirement: Credentials stored encrypted
An S3-compatible backend's secret key SHALL be stored only encrypted, under a key derived from the instance secret, and SHALL never be returned after it is saved. Opening the backend under a different instance secret SHALL fail with a credentials error rather than use a wrong key.

#### Scenario: The stored secret key
- **WHEN** a caller saves an S3-compatible backend, reads its row in the database directly, and lists the backends
- **THEN** the row does not hold the secret key in plaintext, and the list shows the backend's access key and no part of its secret key

#### Scenario: A different instance secret
- **WHEN** an instance that saved an S3-compatible backend restarts with a different instance secret and opens that backend
- **THEN** opening fails with a credentials error whose text holds no secret

### Requirement: Backends on each runtime
An S3-compatible backend SHALL open on Workers and on Bun. Durable Objects and R2 backends SHALL open only on Workers, and opening one on Bun SHALL fail with an unsupported-runtime error. Opening an R2 backend whose binding the Worker lacks SHALL fail with a missing-binding error that names the binding.

#### Scenario: A Durable Objects backend on Bun
- **WHEN** an instance on Bun opens a Durable Objects backend, and then an R2 backend
- **THEN** both fail with an unsupported-runtime error

#### Scenario: An R2 binding the Worker lacks
- **WHEN** a Worker without a `PHOTOS` binding opens an R2 backend that names `PHOTOS`
- **THEN** opening fails with a missing-binding error that names `PHOTOS`

### Requirement: A key prefix in a shared bucket
An R2 or S3-compatible backend SHALL keep its whole tree under its key prefix, and SHALL never list, change or remove an object outside it.

#### Scenario: A prefix inside a shared bucket
- **WHEN** a bucket holds `other/x.txt`, and a caller writes `/a.txt` to an R2 or S3-compatible backend with the prefix `davloom/` in that bucket, lists its root, and removes every entry in it
- **THEN** no listing shows `x.txt`, and the bucket still holds `other/x.txt`

### Requirement: Objects that other tools wrote
An R2 or S3-compatible backend SHALL show the objects that other tools put under its prefix: an object's key SHALL be a file, and each part of a key that ends at a `/` SHALL be a collection, whether or not a marker object exists for it. When a collection and a file would share a path, the collection SHALL be shown and the file hidden. An object whose key does not form a valid path SHALL be hidden.

#### Scenario: Objects from other tools
- **WHEN** another tool puts `photos/2026/a.jpg` in a bucket, and a caller lists the root and then `/photos/2026` of a backend for that bucket
- **THEN** the root holds the collection `photos`, and `/photos/2026` holds the file `a.jpg`

#### Scenario: A file and a collection with one name
- **WHEN** another tool puts `photos` and `photos/a.jpg` in a bucket, and a caller lists the root, reads `/photos` and removes `/photos`
- **THEN** the root holds `photos` once, as a collection that holds `a.jpg`, the read fails with a collection error, and the removal fails with a hidden-objects error

#### Scenario: Keys that form no path
- **WHEN** another tool puts `docs/a.txt`, `docs//b.txt`, `docs/../c.txt` and `./d.txt` in a bucket, and a caller lists the root and `/docs`
- **THEN** the root holds only the collection `docs`, and `/docs` holds only the file `a.txt`

### Requirement: Hidden objects block changes
Removing, copying or moving a collection of an R2 or S3-compatible backend SHALL fail with a hidden-objects error and change nothing when an object under the collection's key is hidden, or when a file hidden by the collection shares its path.

#### Scenario: Changing a collection with hidden objects
- **WHEN** another tool puts `docs/a.txt` and `docs//b.txt` in a bucket, and a caller removes `/docs`, copies it to `/copy` and moves it to `/moved`
- **THEN** each operation fails with a hidden-objects error, the bucket still holds both objects, and it holds no key under `copy/` or `moved/`

### Requirement: Collections without a marker
When an entry is removed from, or moved out of, a collection other than the root of an R2 or S3-compatible backend, and that collection has no marker object, the backend SHALL first write the collection's marker, so the collection stays when its last entry goes.

#### Scenario: Removing the last file of a collection without a marker
- **WHEN** another tool puts `photos/2026/a.jpg` in a bucket, and a caller removes `/photos/2026/a.jpg` and lists `/photos/2026`
- **THEN** `/photos/2026` is an empty collection, and the root still holds `photos`

### Requirement: The object key laws
The rules that turn an object store into a tree SHALL keep these laws, stated in `LAWS.bend` and proven in `PROOF.bend`: every valid path other than the root maps to a key under the prefix and back to the same path; the entries read from a listing have valid names, and no two share a name; and the rules find hidden objects, and refuse a write as too large, exactly as this capability's requirements state.

#### Scenario: Key laws under generated keys
- **WHEN** the property tests give the compiled objects module generated paths, prefixes, write sizes and listings of arbitrary keys
- **THEN** every valid path other than the root maps to a key and back unchanged, every listing gives entries with valid names that no two entries share, and hidden objects and writes that are too large are found exactly as the requirements state

### Requirement: The instance secret
The backend service SHALL refuse to start when the instance secret `DAVLOOM_SECRET` is missing or shorter than 32 bytes in UTF-8, with an error that names the variable and holds no part of its value.

#### Scenario: A missing or short instance secret
- **WHEN** an instance starts its backend service without `DAVLOOM_SECRET`, and then with a value of 31 bytes
- **THEN** both starts fail with an error that names `DAVLOOM_SECRET`, and neither error's text holds the value

### Requirement: The backend field law
The rules that check a backend's configuration SHALL keep a law, stated in `LAWS.bend` and proven in `PROOF.bend`: for every configuration they report the first field that is missing or invalid, in the order that "Backend configurations" lists the fields a caller supplies, or none, and they accept an instance secret exactly when it has at least 32 bytes in UTF-8.

#### Scenario: Field laws under generated fields
- **WHEN** the property tests give the compiled backends module generated configurations of every kind, with fields missing, invalid and valid, and generated lengths of the instance secret
- **THEN** it reports the first field that is missing or invalid exactly as the rules state, or none, and accepts exactly the secrets of at least 32 bytes

### Requirement: The largest R2 and S3 write
Writing a file to an R2 or S3-compatible backend SHALL fail with a too-large error, before any byte of the stream is read, when the write states more than 5 GiB less 5 MiB, the most that one upload to R2 holds and less than one upload to S3 holds.

#### Scenario: A write above the upload limit
- **WHEN** a caller writes `/huge.bin` to an R2 backend and to an S3-compatible backend with a stream that states 5,363,466,241 bytes, one more than 5 GiB less 5 MiB
- **THEN** both writes fail with a too-large error, neither reads a byte of its stream, and `/huge.bin` does not exist on either backend
