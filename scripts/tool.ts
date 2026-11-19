// Runs a third-party CLI at the version scripts/lib/tools.ts pins, downloading and checking it
// first: `bun scripts/tool.ts <name> [arguments...]`. Exits with the tool's exit status.
import { TOOLS, ensureTool, platformOf, toolCacheDir } from "./lib/tools";

const [name, ...args] = process.argv.slice(2);
const tool = name === undefined ? undefined : TOOLS[name];
if (name === undefined || tool === undefined) {
  console.error(`Usage: bun scripts/tool.ts <${Object.keys(TOOLS).join("|")}> [arguments...]`);
  process.exit(2);
}

let executable: string;
try {
  executable = await ensureTool(name, tool, {
    cacheDir: toolCacheDir(process.env),
    platform: platformOf(process.platform, process.arch),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const child = Bun.spawn([executable, ...args], { stdio: ["inherit", "inherit", "inherit"] });
process.exit(await child.exited);
