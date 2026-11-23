import { createAdmin, type Auth } from "./auth";

// The Identity Port of @davloom/core, implemented with Better Auth.

export interface KeyMetadata {
  readonly access: "read-only" | "read-write";
  readonly paths?: readonly string[];
}

export const createIdentity = (auth: Auth) => ({
  createAdmin: async (details: { name: string; email: string; password: string }) => {
    const user = await createAdmin(auth, details);
    return { id: user.id };
  },
  sessionUser: async (headers: Headers) => {
    const session = await auth.api.getSession({ headers });
    return session
      ? { id: session.user.id, name: session.user.name, email: session.user.email }
      : null;
  },
  createApiKey: async (details: {
    userId: string;
    name: string;
    expiresIn: number | null;
    metadata: KeyMetadata;
  }) => {
    const created = await auth.api.createApiKey({
      body: {
        userId: details.userId,
        name: details.name,
        metadata: { ...details.metadata },
        ...(details.expiresIn === null ? {} : { expiresIn: details.expiresIn }),
      },
    });
    return { id: created.id, key: created.key };
  },
});
