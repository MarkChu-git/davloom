// Serves the production Worker in local workerd with an administrator and two API Keys, for real
// WebDAV clients: `bun scripts/serve-davloom.ts`. Prints the URL and the keys, then runs until killed.
import { startDavloom } from "../http/davloom";

const davloom = await startDavloom();
console.log(
  JSON.stringify({
    url: davloom.server.url,
    readWriteKey: davloom.readWriteKey,
    readOnlyKey: davloom.readOnlyKey,
  }),
);
process.on("SIGTERM", () => void davloom.server.stop().then(() => process.exit(0)));
process.on("SIGINT", () => void davloom.server.stop().then(() => process.exit(0)));
await new Promise(() => undefined);
