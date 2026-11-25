# Management API

The Dashboard talks to Davloom through the management API under `/api`. Every route of it, apart from Better Auth's own routes under `/api/auth`, has a contract in `packages/schema`: the Effect Schema of the JSON body it takes, of its query parameters, and of its answer. The API decodes each request body with that schema and encodes each answer through it, and the OpenAPI document is generated from the same schemas, so the document cannot drift from what the server does.

## Getting the OpenAPI document

`GET /api/openapi.json` answers the OpenAPI 3.1 document. It needs a session, like every other route that is not public, so sign in first and send the session cookie:

```sh
# Sign in; the cookie jar keeps the session cookie.
curl -c jar.txt -H 'content-type: application/json' -H "origin: $DAVLOOM_URL" \
  -d '{"username":"owner","password":"…"}' "$DAVLOOM_URL/api/auth/sign-in/username"

# Read the document.
curl -b jar.txt "$DAVLOOM_URL/api/openapi.json" > davloom-openapi.json
```

A signed-in browser can also open `/api/openapi.json` directly. The document's schemas are JSON Schema draft 2020-12, the dialect OpenAPI 3.1 uses, with every named schema under `components/schemas`. A route without a session answers `401` with the code `unauthorized`; the document marks the public routes, such as registration, with an empty `security`.

Without a running instance, the same document comes from the code, run from `packages/schema`:

```sh
bun -e 'import { openApiDocument } from "./src/index.ts"; console.log(JSON.stringify(openApiDocument("dev"), null, 2))'
```

`apps/api/src/app.test.ts` checks in CI that every `/api` route of the app has a contract and appears in the document, and that the served document is the generated one.

## Errors

Every refusal answers JSON of the shape `{ "error": { "code": "…", "message": "…", "issues": [ … ] } }`, where only `code` is always present. The code is machine-readable and stable.

| Status | Code                    | When                                                                                                                                                                                                  |
| ------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `invalid_json`          | The body is not JSON. An empty body reads as `{}`.                                                                                                                                                    |
| 422    | `invalid_body`          | The body or the query is JSON of the wrong shape, such as a number where a string belongs. `issues` lists each place as `{ path, message }`, with `path` the keys and indexes that lead to the value. |
| 400    | `invalid_input`         | The value has the right type, but the service refuses it, such as an empty name or an unknown access level.                                                                                           |
| 401    | `unauthorized`          | No session.                                                                                                                                                                                           |
| 403    | `verification_required` | A step-up action without a recent verification; `POST /api/verify` proves presence again.                                                                                                             |

The other codes, such as `name_taken` or `mount_in_use`, are listed with each route's answers in the document.

## Typed clients

`@davloom/schema` exports every schema and the `ROUTES` table, which names each route's body, query and answer schemas. A typed client, such as an Eden Treaty client in `packages/client`, can decode the answers with the same schemas the server encodes them with.

## Audit trail

`GET /api/audit` answers the audit trail, newest first, a page at a time: `limit` takes 1 to 100 events (50 by default), and `before` takes the `next` of the page before. Each event names its action, its outcome (`success`, `failure` or `locked`), the client's address where the deployment knows it, what it acted on by a name or an id, and how many times it happened. The trail never holds a password, a key, a token or any other secret. Refused WebDAV credentials are counted per client address, key and minute, and the key appears only as the first characters Davloom shows of every key. Events are kept for 90 days; each write removes the ones that have aged out.
