import { runSmoke } from "./smoke";

// The smoke test of a fresh instance, such as the release image in the release workflow:
//
//   DAVLOOM_SETUP_TOKEN=… bun scripts/image-smoke.ts http://127.0.0.1:3000
//
// It waits for the instance to answer, creates its administrator through first-run setup with a
// password of its own, signs in, creates a Read/Write API Key and runs scripts/smoke.ts with it.

const STARTUP_TIMEOUT_MS = 60_000;

const waitForHealth = async (origin: string) => {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(500);
  }
  throw new Error(`${origin}/api/health did not answer within ${STARTUP_TIMEOUT_MS / 1000} s`);
};

const field = (value: unknown, name: string): string => {
  const found: unknown =
    typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
  if (typeof found !== "string") throw new Error(`no ${name} in ${JSON.stringify(value)}`);
  return found;
};

const expectOk = async (response: Response, what: string) => {
  if (!response.ok) throw new Error(`${what}: ${response.status} ${await response.text()}`);
  return response;
};

const [url] = Bun.argv.slice(2);
const token = process.env.DAVLOOM_SETUP_TOKEN;
if (!url || !token) {
  console.error("Usage: DAVLOOM_SETUP_TOKEN=… bun scripts/image-smoke.ts <origin>");
  process.exit(2);
}
const origin = url.replace(/\/+$/, "");
await waitForHealth(origin);
const admin = {
  name: "Release smoke test",
  email: "smoke@example.com",
  password: crypto.randomUUID(),
};
const json = { "content-type": "application/json", origin };
await expectOk(
  await fetch(`${origin}/api/setup`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ ...admin, token }),
  }),
  "first-run setup",
);
const signIn = await expectOk(
  await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email: admin.email, password: admin.password }),
  }),
  "sign-in",
);
const cookie = signIn.headers
  .getSetCookie()
  .map((pair) => pair.split(";")[0])
  .join("; ");
const created = await expectOk(
  await fetch(`${origin}/api/keys`, {
    method: "POST",
    headers: { ...json, cookie },
    body: JSON.stringify({ name: "Release smoke test", access: "read-write" }),
  }),
  "creating an API Key",
);
const key = field(await created.json(), "key");
const result = await runSmoke({ url: origin, key, log: (line) => console.log(line) });
console.log(`${result.passed.length} passed, ${result.failed.length} failed`);
process.exit(result.failed.length === 0 ? 0 : 1);
