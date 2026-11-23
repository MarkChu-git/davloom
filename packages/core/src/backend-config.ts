// The configuration of a storage backend, by kind. A Durable Objects backend needs none. An
// S3-compatible backend names its endpoint, region, bucket, key prefix and access key; its secret
// key is stored apart, sealed by the credential cipher, and never returned by the API.

export interface S3BackendConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  /** Empty, or ending at `/`. */
  readonly prefix: string;
  readonly forcePathStyle: boolean;
  readonly accessKeyId: string;
}

export type ConfigCheck<T> =
  | { readonly ok: true; readonly config: T }
  | { readonly ok: false; readonly field: string };

const text = (value: unknown): string | null => (typeof value === "string" ? value.trim() : null);

// S3 bucket names: 3 to 63 lowercase letters, digits, dots and hyphens, starting and ending with a
// letter or digit. S3-compatible stores accept the same.
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/** Reads an S3-compatible backend's configuration; names the first field that is missing or invalid. */
export const checkS3Config = (raw: unknown): ConfigCheck<S3BackendConfig> => {
  const field = (name: string): unknown =>
    typeof raw === "object" && raw !== null ? Reflect.get(raw, name) : undefined;
  const fields = {
    endpoint: field("endpoint"),
    region: field("region"),
    bucket: field("bucket"),
    prefix: field("prefix"),
    forcePathStyle: field("forcePathStyle"),
    accessKeyId: field("accessKeyId"),
  };
  const endpoint = text(fields.endpoint);
  let url: URL | null = null;
  try {
    url = endpoint ? new URL(endpoint) : null;
  } catch {
    url = null;
  }
  if (
    !url ||
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return { ok: false, field: "endpoint" };
  }
  const region = text(fields.region) || "us-east-1";
  if (region.length > 64 || !/^[a-z0-9-]+$/.test(region)) return { ok: false, field: "region" };
  const bucket = text(fields.bucket);
  if (!bucket || !BUCKET.test(bucket)) return { ok: false, field: "bucket" };
  const prefixText = text(fields.prefix) ?? "";
  const prefix = prefixText === "" || prefixText.endsWith("/") ? prefixText : `${prefixText}/`;
  if (prefix.startsWith("/") || prefix.includes("//") || prefix.length > 100)
    return { ok: false, field: "prefix" };
  const forcePathStyle = fields.forcePathStyle === undefined ? true : fields.forcePathStyle;
  if (typeof forcePathStyle !== "boolean") return { ok: false, field: "forcePathStyle" };
  const accessKeyId = text(fields.accessKeyId);
  if (!accessKeyId || accessKeyId.length > 256) return { ok: false, field: "accessKeyId" };
  return {
    ok: true,
    config: {
      endpoint: url.href.replace(/\/$/, ""),
      region,
      bucket,
      prefix,
      forcePathStyle,
      accessKeyId,
    },
  };
};

export interface R2BackendConfig {
  /** The name of the Worker's R2 binding, such as R2. */
  readonly binding: string;
  /** Empty, or ending at `/`. */
  readonly prefix: string;
}

/** Reads an R2 backend's configuration; names the first field that is missing or invalid. */
export const checkR2Config = (raw: unknown): ConfigCheck<R2BackendConfig> => {
  const field = (name: string): unknown =>
    typeof raw === "object" && raw !== null ? Reflect.get(raw, name) : undefined;
  const binding = text(field("binding"));
  if (!binding || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(binding))
    return { ok: false, field: "binding" };
  const prefixText = text(field("prefix")) ?? "";
  const prefix = prefixText === "" || prefixText.endsWith("/") ? prefixText : `${prefixText}/`;
  if (prefix.startsWith("/") || prefix.includes("//") || prefix.length > 100)
    return { ok: false, field: "prefix" };
  return { ok: true, config: { binding, prefix } };
};
