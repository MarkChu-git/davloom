import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useState } from "react";
import { describeError, isApiError } from "../api/client";
import {
  kindLabel,
  useCreateBackend,
  useUpdateBackend,
  type Backend,
  type BackendConfig,
} from "../api/queries";

const identifier = {
  autoCapitalize: "none",
  hasAutoCorrect: false,
  hasSpellCheck: false,
} as const;

/** The fields of an S3-compatible backend's form. */
export interface S3Fields {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretKey: string;
  forcePathStyle: boolean;
}

type S3Problem = Partial<Record<keyof S3Fields | "name", string>>;

const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/**
 * What is wrong with an S3-compatible backend's fields, by field, as the API checks them. A form
 * that edits a backend may leave the secret key empty to keep the stored one.
 */
export const s3Problems = (fields: S3Fields, isEditing: boolean): S3Problem => {
  const problems: S3Problem = {};
  let url: URL | null = null;
  try {
    url = new URL(fields.endpoint.trim());
  } catch {
    url = null;
  }
  if (url === null || (url.protocol !== "https:" && url.protocol !== "http:")) {
    problems.endpoint = "Enter the endpoint's URL, such as https://s3.example.com.";
  } else if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    problems.endpoint = "Enter the endpoint without a user, a query or a fragment.";
  }
  const region = fields.region.trim();
  if (region !== "" && (region.length > 64 || !/^[a-z0-9-]+$/.test(region))) {
    problems.region = "Use lowercase letters, digits and hyphens, such as us-east-1.";
  }
  if (!BUCKET.test(fields.bucket.trim())) {
    problems.bucket = "Use 3 to 63 lowercase letters, digits, dots and hyphens.";
  }
  const prefix = fields.prefix.trim();
  if (prefix.startsWith("/") || prefix.includes("//") || prefix.length > 100) {
    problems.prefix = "Use a path without a leading or doubled slash, at most 100 characters.";
  }
  if (fields.accessKeyId.trim() === "" || fields.accessKeyId.length > 256) {
    problems.accessKeyId = "Enter the access key ID.";
  }
  if ((!isEditing && fields.secretKey === "") || fields.secretKey.length > 256) {
    problems.secretKey = "Enter the secret access key.";
  }
  return problems;
};

/** The configuration the API takes for the fields. */
export const s3Config = (fields: S3Fields): BackendConfig => ({
  endpoint: fields.endpoint.trim(),
  region: fields.region.trim(),
  bucket: fields.bucket.trim(),
  prefix: fields.prefix.trim(),
  forcePathStyle: fields.forcePathStyle,
  accessKeyId: fields.accessKeyId.trim(),
});

const fieldsOf = (backend: Backend | undefined): S3Fields => {
  const config = backend?.config ?? {};
  const text = (name: string) => {
    const value = config[name];
    return typeof value === "string" ? value : "";
  };
  return {
    endpoint: text("endpoint"),
    region: text("region"),
    bucket: text("bucket"),
    prefix: text("prefix"),
    accessKeyId: text("accessKeyId"),
    secretKey: "",
    forcePathStyle: config.forcePathStyle !== false,
  };
};

/**
 * Adds a backend, or edits one. A Durable Objects backend has only a name; an S3-compatible one
 * names its endpoint, bucket, prefix and keys. The secret key is never shown again once saved.
 */
export const BackendForm = ({
  backend,
  kinds,
  takenNames,
  onCancel,
  onSaved,
}: {
  backend?: Backend;
  /** The kinds a new backend may take on this instance. */
  kinds: readonly string[];
  takenNames: readonly string[];
  onCancel: () => void;
  onSaved: (name: string) => void;
}) => {
  const create = useCreateBackend();
  const update = useUpdateBackend();
  const isEditing = backend !== undefined;
  const offered = kinds.filter((kind) => kind === "durable-object" || kind === "s3");
  const [kind, setKind] = useState(backend?.kind ?? offered[0] ?? "durable-object");
  const [name, setName] = useState(backend?.name ?? "");
  const [s3, setS3] = useState<S3Fields>(() => fieldsOf(backend));
  const [problems, setProblems] = useState<S3Problem>({});
  const [failure, setFailure] = useState<string>();
  const isSaving = create.isPending || update.isPending;

  const change = (field: keyof S3Fields, value: string | boolean) => {
    setS3((current) => ({ ...current, [field]: value }));
    setProblems((current) => ({ ...current, [field]: undefined }));
    setFailure(undefined);
  };

  const submit = () => {
    const trimmed = name.trim();
    const next: S3Problem = kind === "s3" ? s3Problems(s3, isEditing) : {};
    if (trimmed === "") next.name = "Enter a name for the backend.";
    else if (trimmed.length > 64) next.name = "Use at most 64 characters.";
    else if (takenNames.includes(trimmed)) next.name = "Another backend already has this name.";
    setProblems(next);
    setFailure(undefined);
    if (Object.values(next).some((problem) => problem !== undefined) || isSaving) {
      return;
    }
    const onError = (error: Error) => {
      if (isApiError(error) && error.code === "name_taken") {
        setProblems({ name: "Another backend already has this name." });
      } else if (isApiError(error) && error.code === "invalid_input") {
        setFailure("The server refused these values. Check each field.");
      } else {
        setFailure(describeError(error));
      }
    };
    const s3Body =
      kind === "s3"
        ? { config: s3Config(s3), ...(s3.secretKey === "" ? {} : { secretKey: s3.secretKey }) }
        : {};
    if (backend === undefined) {
      create.mutate(
        { name: trimmed, kind, ...s3Body },
        { onSuccess: () => onSaved(trimmed), onError },
      );
    } else {
      update.mutate(
        { id: backend.id, name: trimmed, ...s3Body },
        { onSuccess: () => onSaved(trimmed), onError },
      );
    }
  };

  const status = (field: keyof S3Problem) => {
    const message = problems[field];
    return message === undefined ? undefined : ({ type: "error", message } as const);
  };

  const s3Input = (
    field: Exclude<keyof S3Fields, "forcePathStyle">,
    label: string,
    options: { isOptional?: boolean; type?: "password" | "url"; placeholder?: string } = {},
  ) => (
    <TextInput
      label={label}
      value={s3[field]}
      onChange={(value) => change(field, value)}
      onEnter={submit}
      isRequired={options.isOptional !== true}
      isOptional={options.isOptional}
      type={options.type}
      placeholder={options.placeholder}
      autoComplete={options.type === "password" ? "new-password" : "off"}
      status={status(field)}
      {...identifier}
    />
  );

  return (
    <Layout
      header={
        <DialogHeader
          title={isEditing ? `Edit ${backend.name}` : "Add a backend"}
          onOpenChange={onCancel}
        />
      }
      content={
        <LayoutContent>
          <VStack gap={4}>
            {failure === undefined ? null : (
              <Banner status="error" title={failure} container="card" />
            )}
            <TextInput
              label="Name"
              value={name}
              onChange={(value) => {
                setName(value);
                setProblems((current) => ({ ...current, name: undefined }));
              }}
              onEnter={submit}
              isRequired
              hasAutoFocus
              hasSpellCheck={false}
              status={status("name")}
            />
            {isEditing || offered.length < 2 ? (
              <MetadataList>
                <MetadataListItem label="Kind">{kindLabel(kind)}</MetadataListItem>
              </MetadataList>
            ) : (
              <Selector
                label="Kind"
                value={kind}
                onChange={(next) => {
                  setKind(next);
                  setProblems({});
                }}
                options={offered.map((value) => ({ value, label: kindLabel(value) }))}
              />
            )}
            {kind === "s3" ? (
              <>
                {s3Input("endpoint", "Endpoint", { type: "url" })}
                {s3Input("bucket", "Bucket")}
                {s3Input("prefix", "Prefix", { isOptional: true })}
                {s3Input("region", "Region", { isOptional: true, placeholder: "us-east-1" })}
                {s3Input("accessKeyId", "Access key ID")}
                {s3Input("secretKey", "Secret access key", {
                  type: "password",
                  ...(isEditing ? { isOptional: true, placeholder: "Unchanged" } : {}),
                })}
                <Switch
                  label="Path-style addresses"
                  value={s3.forcePathStyle}
                  onChange={(value) => change("forcePathStyle", value)}
                />
              </>
            ) : null}
          </VStack>
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" variant="secondary" onClick={onCancel} />
            <Button
              label={isEditing ? "Save" : "Add backend"}
              variant="primary"
              isLoading={isSaving}
              onClick={submit}
            />
          </HStack>
        </LayoutFooter>
      }
    />
  );
};
