import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { embeddedConfig, embedFiles } from "./deploy-embedded";
import { createAssetServer } from "./lib/embedded-assets";

// The fallback deploy's generator: what it embeds of a build, and the config it derives.

const build = mkdtempSync(join(tmpdir(), "davloom-embed-"));
mkdirSync(join(build, "assets"));
writeFileSync(join(build, "index.html"), "<!doctype html>index");
writeFileSync(join(build, "files.html"), "<!doctype html>files");
writeFileSync(join(build, "assets", "app-1.js"), "console.log('é')");
writeFileSync(join(build, "assets", "logo.png"), new Uint8Array([137, 80, 78, 71, 0, 255]));
writeFileSync(join(build, "_headers"), "/assets/*\n  Cache-Control: immutable\n");
writeFileSync(join(build, "_redirects"), "/a /b 302\n");
afterAll(() => rmSync(build, { recursive: true, force: true }));

describe("embedFiles", () => {
  it("embeds every file by its path, text as text, and keeps _headers apart", async () => {
    const { files, headers } = await embedFiles(build);
    expect(Object.keys(files).toSorted()).toEqual([
      "/assets/app-1.js",
      "/assets/logo.png",
      "/files.html",
      "/index.html",
    ]);
    expect(files["/assets/app-1.js"]?.text).toBe("console.log('é')");
    expect(files["/assets/logo.png"]?.base64).toBe("iVBORwD/");
    expect(files["/index.html"]?.etag).toMatch(/^"[0-9a-f]{32}"$/);
    expect(headers).toContain("Cache-Control: immutable");
  });

  it("serves what it embedded byte for byte", async () => {
    const { files, headers } = await embedFiles(build);
    const serve = createAssetServer(files, headers);
    const script = serve(new Request("https://davloom.example/assets/app-1.js"));
    expect(await script.text()).toBe("console.log('é')");
    expect(script.headers.get("cache-control")).toBe("immutable");
    const image = serve(new Request("https://davloom.example/assets/logo.png"));
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71, 0, 255]),
    );
    expect(await serve(new Request("https://davloom.example/files")).text()).toBe(
      "<!doctype html>files",
    );
  });
});

describe("embeddedConfig", () => {
  it("drops assets, names the generated entry and rebases relative paths", () => {
    expect(
      embeddedConfig({
        $schema: "./node_modules/wrangler/config-schema.json",
        name: "davloom",
        main: "src/entry.workers.ts",
        alias: { a: "./node_modules/a/index.js", b: "b-package" },
        assets: { directory: "../web/dist/client" },
        d1_databases: [
          { binding: "DB", migrations_dir: "../../packages/database/drizzle" },
          { binding: "OTHER" },
        ],
      }),
    ).toEqual({
      name: "davloom",
      main: "entry.ts",
      alias: { a: "../../node_modules/a/index.js", b: "b-package" },
      d1_databases: [
        { binding: "DB", migrations_dir: "../../../../packages/database/drizzle" },
        { binding: "OTHER" },
      ],
    });
  });
});
