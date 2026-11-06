import { createAdmin, parseBasicCredentials, type Auth } from "@davloom/auth";
import { Elysia } from "elysia";

// A fixed account is fine here: the probe's database is thrown away after each run.
const TEST_ADMIN = {
  name: "Admin",
  email: "admin@davloom.test",
  password: "correct horse battery staple",
};

const ensureAdmin = async (auth: Auth): Promise<string> => {
  const context = await auth.$context;
  const existing = await context.internalAdapter.findUserByEmail(TEST_ADMIN.email);
  return existing ? existing.user.id : (await createAdmin(auth, TEST_ADMIN)).id;
};

/**
 * Creating the administrator hashes a password, which may not fit the Free plan's CPU limit, and
 * logins are measured separately. So a deployed probe stores a hash that the client computed.
 */
const ensureAdminWithHash = async (auth: Auth, passwordHash: string): Promise<string> => {
  const context = await auth.$context;
  const existing = await context.internalAdapter.findUserByEmail(TEST_ADMIN.email);
  if (existing) {
    return existing.user.id;
  }
  const user = await context.internalAdapter.createUser(
    { name: TEST_ADMIN.name, email: TEST_ADMIN.email, emailVerified: true },
    { method: "admin" },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: passwordHash,
  });
  return user.id;
};

export const unauthorized = () =>
  new Response(null, {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="Davloom", charset="UTF-8"' },
  });

/** The authenticated request chain that real WebDAV traffic will use: Basic Auth carrying an API key. */
export const authenticate = async (
  auth: Auth,
  request: Request,
): Promise<{ username: string } | null> => {
  const credentials = parseBasicCredentials(request.headers.get("authorization"));
  if (!credentials) {
    return null;
  }
  const { valid } = await auth.api.verifyApiKey({ body: { key: credentials.password } });
  return valid ? { username: credentials.username } : null;
};

const respondToIdentity = async (auth: Auth, request: Request): Promise<Response> => {
  const identity = await authenticate(auth, request);
  return identity
    ? Response.json({ authenticated: true, username: identity.username })
    : unauthorized();
};

export const identityRoutes = (getAuth: () => Auth) =>
  new Elysia()
    .post("/api/__probe/auth/setup", async () => ({ adminId: await ensureAdmin(getAuth()) }))
    .post("/api/__probe/auth/setup-with-hash", async ({ body }) => ({
      adminId: await ensureAdminWithHash(
        getAuth(),
        (body as { passwordHash: string }).passwordHash,
      ),
    }))
    .post("/api/__probe/auth/login", ({ body }) =>
      getAuth().api.signInEmail({
        body: body as { email: string; password: string },
        asResponse: true,
      }),
    )
    .post("/api/__probe/auth/api-keys", async () => {
      const auth = getAuth();
      const { id, key } = await auth.api.createApiKey({
        body: { userId: await ensureAdmin(auth), name: "probe client" },
      });
      return { id, key };
    })
    .delete("/api/__probe/auth/api-keys/:id", ({ params, request }) =>
      getAuth().api.deleteApiKey({
        body: { keyId: params.id },
        headers: request.headers,
        asResponse: true,
      }),
    )
    .all("/api/__probe/auth/dav/*", ({ request }) => respondToIdentity(getAuth(), request), {
      parse: "none",
    });
