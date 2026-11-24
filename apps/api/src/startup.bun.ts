import { configuredOrigin } from "@davloom/auth";

// What the Bun server says when it starts with settings that work but will surprise the owner.

/** The warnings for a self-hosted instance's settings, one sentence each. */
export const startupWarnings = (env: Readonly<Record<string, string | undefined>>): string[] => {
  const warnings: string[] = [];
  if (configuredOrigin(env.DAVLOOM_URL) === undefined) {
    warnings.push(
      env.DAVLOOM_URL === undefined || env.DAVLOOM_URL.trim() === ""
        ? "DAVLOOM_URL is not set: passkeys are off, and the API takes changes only from the address each request names in its Host header. Behind a reverse proxy that rewrites Host, every change of the Dashboard, registration included, is refused. Set DAVLOOM_URL to the address you open Davloom at."
        : `DAVLOOM_URL (${env.DAVLOOM_URL}) is no http or https address, so Davloom ignores it: passkeys are off. Set it to the address you open Davloom at, such as https://files.example.com.`,
    );
  }
  return warnings;
};
