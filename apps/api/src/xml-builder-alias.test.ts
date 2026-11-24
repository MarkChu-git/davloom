import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The Worker bundle takes the AWS SDK's XML utilities from the module that wrangler.jsonc aliases,
// so that S3 answers parse without DOMParser, which workerd lacks (tests/integration/compat/http/
// s3-workers.test.ts runs it end to end). The alias names this app's copy of the package; these
// tests fail when that copy is not the one the SDK uses, or stops parsing on its own.

const API = resolve(import.meta.dirname, "..");
const REPO = resolve(API, "../..");

const aliasTarget = () => {
  const config = readFileSync(resolve(API, "wrangler.jsonc"), "utf8");
  const match = /"@aws-sdk\/xml-builder":\s*"([^"]+)"/.exec(config);
  if (!match?.[1]) throw new Error("wrangler.jsonc aliases no @aws-sdk/xml-builder");
  return resolve(API, match[1]);
};

const lockedVersion = () => {
  const lock = readFileSync(resolve(REPO, "bun.lock"), "utf8");
  const match = /"@aws-sdk\/xml-builder": \["@aws-sdk\/xml-builder@([^"]+)"/.exec(lock);
  if (!match?.[1]) throw new Error("bun.lock records no @aws-sdk/xml-builder");
  return match[1];
};

interface XmlBuilder {
  readonly parseXML: (xml: string) => unknown;
  readonly XmlNode: unknown;
  readonly XmlText: unknown;
}

const isXmlBuilder = (value: unknown): value is XmlBuilder =>
  typeof value === "object" && value !== null && "parseXML" in value && "XmlNode" in value;

describe("the Worker's alias of @aws-sdk/xml-builder", () => {
  it("names the version that bun.lock records", () => {
    const target = aliasTarget();
    expect(existsSync(target), target).toBe(true);
    const manifest: unknown = JSON.parse(
      readFileSync(resolve(dirname(target), "../package.json"), "utf8"),
    );
    expect(manifest).toMatchObject({ name: "@aws-sdk/xml-builder", version: lockedVersion() });
    const app: unknown = JSON.parse(readFileSync(resolve(API, "package.json"), "utf8"));
    expect(app).toMatchObject({ dependencies: { "@aws-sdk/xml-builder": lockedVersion() } });
  });

  it("parses XML without DOMParser", async () => {
    expect(Reflect.get(globalThis, "DOMParser")).toBeUndefined();
    const module: unknown = await import(aliasTarget());
    if (!isXmlBuilder(module)) throw new Error("the alias exports no parseXML and XmlNode");
    expect(
      module.parseXML(
        '<?xml version="1.0"?><ListBucketResult><Key>a &amp; b</Key><Key>c</Key><IsTruncated>false</IsTruncated></ListBucketResult>',
      ),
    ).toEqual({ ListBucketResult: { Key: ["a & b", "c"], IsTruncated: "false" } });
    expect(module.XmlText).toBeDefined();
  });
});
