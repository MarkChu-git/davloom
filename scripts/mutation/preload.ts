// Preloaded into Stryker's main process by scripts/mutation.ts (Decision 15 of add-phase-1-core).
// The test runner processes that Stryker forks need neither fix. Remove each once Bun fixes it.
import { Server } from "node:net";
import { networkInterfaces } from "node:os";

// Bun's native Error.prepareStackTrace throws "First argument must be an Error object" when a
// wrapper hands it an object that only inherits from Error (oven-sh/bun#41151). @babel/core, which
// Stryker loads, installs such a wrapper, and the Vite that the Vitest runner loads builds such
// objects, so without this the main process cannot load the runner. When the native function
// throws, the frames are formatted here instead.
const frameText = (frame: NodeJS.CallSite) =>
  `    at ${frame.getFunctionName() ?? "<anonymous>"} (${frame.getFileName() ?? "<unknown>"}:${frame.getLineNumber() ?? 0}:${frame.getColumnNumber() ?? 0})`;
const native: unknown = Reflect.get(Error, "prepareStackTrace");
if (typeof native === "function") {
  Error.prepareStackTrace = (error, frames) => {
    try {
      const formatted: unknown = Reflect.apply(native, undefined, [error, frames]);
      return formatted;
    } catch {
      return [String(error), ...frames.map(frameText)].join("\n");
    }
  };
}

// Stryker's logging server calls `server.listen(callback)` with no host. Node then listens on `::`
// where the machine has IPv6 and on 0.0.0.0 otherwise; Bun always listens on `::` and fails with
// "Failed to listen at ::" where there is none, as in containers without IPv6. On such a machine
// a listen without a host gets Node's fallback; everywhere else nothing changes.
const hasIPv6 = Object.values(networkInterfaces()).some((addresses) =>
  (addresses ?? []).some((address) => address.family === "IPv6"),
);
// A host is a string first or second argument, or part of an options object; the forms Stryker
// uses, `listen(callback)` and `listen(port, callback)`, have none.
const namesHost = (args: unknown[]): boolean =>
  typeof args[0] === "object" || typeof args[0] === "string" || typeof args[1] === "string";
const listen: unknown = Reflect.get(Server.prototype, "listen");
if (!hasIPv6 && typeof listen === "function") {
  Reflect.set(
    Server.prototype,
    "listen",
    function listenWithIPv4Fallback(this: Server, ...args: unknown[]): unknown {
      if (namesHost(args)) return Reflect.apply(listen, this, args);
      const port = typeof args[0] === "number" ? args[0] : 0;
      const callbacks = args.filter((arg) => typeof arg === "function");
      return Reflect.apply(listen, this, [port, "0.0.0.0", ...callbacks]);
    },
  );
}
