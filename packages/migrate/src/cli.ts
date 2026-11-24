#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { migrate, MigrationError } from "./migrate";

// Copies the files of one WebDAV collection to another:
//
//   DAVLOOM_SOURCE_KEY=dav_… DAVLOOM_TARGET_KEY=dav_… bun run migrate -- \
//     https://old.example/dav/files/ https://new.example/dav/files/
//
// The keys come from the environment, so they stay out of the shell's history.

const USAGE = `Usage: bun run migrate -- [--overwrite] [--quiet] <source URL> <target URL>

Copies every folder, file and dead property from the source collection to the target collection,
and checks each written file's SHA-256. Running it again copies only what is missing.

Environment:
  DAVLOOM_SOURCE_KEY  an API Key of the source (Read Only is enough)
  DAVLOOM_TARGET_KEY  a Read/Write API Key of the target

Options:
  --overwrite  replace target files that differ from the source's
  --quiet      print only the summary`;

export const main = async (argv: readonly string[], env: Record<string, string | undefined>) => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      overwrite: { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  const [from, to] = positionals;
  const sourceKey = env.DAVLOOM_SOURCE_KEY;
  const targetKey = env.DAVLOOM_TARGET_KEY;
  if (values.help || from === undefined || to === undefined || positionals.length > 2) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  if (!sourceKey || !targetKey) {
    console.error("Set DAVLOOM_SOURCE_KEY and DAVLOOM_TARGET_KEY to an API Key of each side.");
    return 2;
  }
  try {
    const report = await migrate({
      source: { url: from, key: sourceKey },
      target: { url: to, key: targetKey },
      overwrite: values.overwrite,
      onEntry: values.quiet
        ? undefined
        : ({ path, action }) => console.log(`${action.padEnd(8)} ${path}`),
    });
    console.log(
      `${report.created} folders created, ${report.written} files written (${report.bytes} bytes), ${report.skipped} already there, ${report.properties} properties set.`,
    );
    if (report.conflicts.length > 0) {
      console.error(
        `${report.conflicts.length} left as they are, because the target holds something else there:\n${report.conflicts.join("\n")}`,
      );
      return 1;
    }
    return 0;
  } catch (error) {
    console.error(error instanceof MigrationError ? error.message : error);
    return 1;
  }
};

if (import.meta.main) process.exit(await main(Bun.argv.slice(2), process.env));
