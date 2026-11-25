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
import { useT } from "../i18n/I18nProvider";
import type { Translator } from "../i18n/translate";

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
export const s3Problems = (t: Translator, fields: S3Fields, isEditing: boolean): S3Problem => {
  const problems: S3Problem = {};
  let url: URL | null = null;
  try {
    url = new URL(fields.endpoint.trim());
  } catch {
    url = null;
  }
  if (url === null || (url.protocol !== "https:" && url.protocol !== "http:")) {
    problems.endpoint = t("s3.endpointInvalid");
  } else if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    problems.endpoint = t("s3.endpointExtra");
  }
  const region = fields.region.trim();
  if (region !== "" && (region.length > 64 || !/^[a-z0-9-]+$/.test(region))) {
    problems.region = t("s3.regionInvalid");
  }
  if (!BUCKET.test(fields.bucket.trim())) {
    problems.bucket = t("s3.bucketInvalid");
  }
  const prefix = fields.prefix.trim();
  if (prefix.startsWith("/") || prefix.includes("//") || prefix.length > 100) {
    problems.prefix = t("s3.prefixInvalid");
  }
  if (fields.accessKeyId.trim() === "" || fields.accessKeyId.length > 256) {
    problems.accessKeyId = t("s3.accessKeyMissing");
  }
  if ((!isEditing && fields.secretKey === "") || fields.secretKey.length > 256) {
    problems.secretKey = t("s3.secretKeyMissing");
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
  const t = useT();
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
    const next: S3Problem = kind === "s3" ? s3Problems(t, s3, isEditing) : {};
    if (trimmed === "") next.name = t("backendForm.nameMissing");
    else if (trimmed.length > 64) next.name = t("form.atMost", { count: 64 });
    else if (takenNames.includes(trimmed)) next.name = t("backendForm.nameTaken");
    setProblems(next);
    setFailure(undefined);
    if (Object.values(next).some((problem) => problem !== undefined) || isSaving) {
      return;
    }
    const onError = (error: Error) => {
      if (isApiError(error) && error.code === "name_taken") {
        setProblems({ name: t("backendForm.nameTaken") });
      } else if (isApiError(error) && error.code === "invalid_input") {
        setFailure(t("backendForm.refused"));
      } else {
        setFailure(describeError(t, error));
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
          title={
            isEditing
              ? t("backendForm.editTitle", { name: backend.name })
              : t("backendForm.addTitle")
          }
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
              label={t("field.name")}
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
                <MetadataListItem label={t("backendForm.kind")}>
                  {kindLabel(t, kind)}
                </MetadataListItem>
              </MetadataList>
            ) : (
              <Selector
                label={t("backendForm.kind")}
                value={kind}
                onChange={(next) => {
                  setKind(next);
                  setProblems({});
                }}
                options={offered.map((value) => ({ value, label: kindLabel(t, value) }))}
              />
            )}
            {kind === "s3" ? (
              <>
                {s3Input("endpoint", t("backendCard.endpoint"), { type: "url" })}
                {s3Input("bucket", t("s3.bucket"))}
                {s3Input("prefix", t("s3.prefix"), { isOptional: true })}
                {s3Input("region", t("s3.region"), { isOptional: true, placeholder: "us-east-1" })}
                {s3Input("accessKeyId", t("s3.accessKeyId"))}
                {s3Input("secretKey", t("s3.secretKey"), {
                  type: "password",
                  ...(isEditing ? { isOptional: true, placeholder: t("s3.unchanged") } : {}),
                })}
                <Switch
                  label={t("s3.pathStyle")}
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
            <Button label={t("action.cancel")} variant="secondary" onClick={onCancel} />
            <Button
              label={isEditing ? t("action.save") : t("backendForm.add")}
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
