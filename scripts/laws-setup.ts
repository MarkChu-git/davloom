// Installs Bend and Lean at the versions packages/laws/toolchain.json pins, refusing any archive
// whose SHA-256 differs from its pin, and builds Bend's --verdict kernel with that Lean:
// `bun run laws:setup`. A second run downloads nothing. Prints where each one is.
import { fileURLToPath } from "node:url";
import { readToolchain, setupToolchain } from "./lib/laws-toolchain";
import { platformOf, toolCacheDir } from "./lib/tools";

const root = fileURLToPath(new URL("..", import.meta.url));

try {
  const toolchain = await readToolchain(root);
  const { paths, downloaded } = await setupToolchain(toolchain, {
    cacheDir: toolCacheDir(process.env),
    platform: platformOf(process.platform, process.arch),
    log: (line) => console.error(line),
  });
  if (downloaded.length === 0) {
    console.error("Downloaded nothing: the cache already holds both releases.");
  }
  console.log(`Bend ${toolchain.bend.version}: ${paths.bend}`);
  console.log(`Lean ${toolchain.lean.version}: ${paths.lean}`);
  console.log(`Kernel, for bend's $BENDTT: ${paths.kernel}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
