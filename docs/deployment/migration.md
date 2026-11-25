# Moving an instance

An export moves an instance's records to a new deployment: from Cloudflare Workers (D1) to Docker
(SQLite), from Docker to Workers, or between two deployments of the same kind. It holds:

- the administrator and their password login, so they sign in with the same password;
- the API Keys, which keep working with the same values and scopes;
- the storage backends with their settings and secret keys, and the Mounts;
- the dead properties that Davloom keeps for S3 and R2 backends.

It leaves out sessions and locks, which expire, and the files themselves, which stay in their
backends.

## Export

In the Dashboard, open Settings, Data export, and choose Export. The browser downloads
`davloom-export-<date>.json`, and the page shows the export key once.

The file is encrypted with AES-256-GCM under that key, so neither the secret keys of backends nor
the hashes of passwords and API Keys appear in plaintext. Keep the key apart from the file: anyone
with both can read every record.

## Import

Deploy the new instance with its own `DAVLOOM_SECRET`, and open it. On the Create account page,
choose From an export, pick the file, and enter the export key. The import writes every record or none: a wrong key, a damaged file, or records that do
not fit together, such as a Mount whose backend is missing, change nothing and say what is wrong.
Then sign in with the password from the old instance.

Only an instance without an account imports, like registration: import right after deploying,
before anyone else opens the instance. The import leaves two-step verification off; set it up
again in Settings.

The new instance seals each backend's secret key again with its own `DAVLOOM_SECRET`.

## Files

A backend the new deployment can open keeps serving its files: an S3-compatible bucket, for
example, works from Workers and from Docker alike. A Durable Objects backend runs only on Workers.
When an export holds no backend the new deployment can open, and the deployment names a default
backend, as the Docker image does with `DAVLOOM_S3_*`, the import adds that backend as well.

To move a Mount's files to another backend, on the same instance or across two:

1. Add a Mount of the new backend, for example `/incoming`, on the instance that will serve it.
2. Copy the files from a checkout of this repository, with an API Key of each side in the
   environment so they stay out of the shell's history:

   ```bash
   DAVLOOM_SOURCE_KEY=dav_… DAVLOOM_TARGET_KEY=dav_… bun run migrate -- https://old.example/dav/files/ https://new.example/dav/incoming/
   ```

   It copies every folder, file and dead property, reads each written file back and checks its
   SHA-256, and stops at the first error. Running it again copies only what is missing. Where
   the target holds something else, it leaves it and names it at the end; `--overwrite` replaces
   target files that differ. Modification times are not carried over.

3. In Storage & Mounts, open the menu of the old Mount, choose Move to another backend, and pick
   the new backend and its folder. The Mount keeps its name, so clients and API Keys limited to
   it keep working. Then remove the helper Mount.

On Workers Free, D1 runs at most 50 statements in one request, and an import writes up to 100
values per statement, so an export with more than about a thousand dead properties can be too
large to import there; the import then changes nothing.
