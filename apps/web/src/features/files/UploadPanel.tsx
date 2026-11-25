import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Text } from "@astryxdesign/core/Text";
import { useT } from "../i18n/I18nProvider";
import { buttonLabelled, refocusIfLost } from "../shell/focus";
import { StatusLabel } from "../shell/StatusLabel";
import { FileName } from "./FileName";
import { clearFinished, startUploads, useUploads, type Upload } from "./uploadStore";

const UploadRow = ({ upload }: { upload: Upload }) => {
  const t = useT();
  return (
    <VStack gap={1}>
      <HStack gap={3} vAlign="center" hAlign="between">
        <StackItem size="fill">
          <FileName name={upload.name} kind="file" />
        </StackItem>
        {upload.state === "uploading" ? (
          <Text type="supporting" color="secondary" hasTabularNumbers>
            {t("overview.bytesOf", {
              used: t.bytes(upload.sentBytes),
              capacity: t.bytes(upload.sizeBytes),
            })}
          </Text>
        ) : (
          <StatusLabel
            tone={upload.state === "done" ? "success" : "error"}
            label={
              upload.state === "done"
                ? t("upload.doneTo", { path: upload.path })
                : t("upload.failed")
            }
          />
        )}
      </HStack>
      {upload.state === "uploading" ? (
        <ProgressBar
          label={t("upload.uploading", { name: upload.name })}
          isLabelHidden
          value={upload.sentBytes}
          max={Math.max(upload.sizeBytes, 1)}
        />
      ) : null}
      {upload.problem === undefined ? null : (
        <Text type="supporting" color="secondary">
          {upload.problem(t)}
        </Text>
      )}
    </VStack>
  );
};

/** Upload UI (PRD §13, Phase 4 deliverable 3): a drop zone and the progress of every file. */
export const UploadPanel = ({
  path,
  folders,
  onSettled,
}: {
  path: string;
  /** The names of the folder's subfolders, which an upload cannot replace. */
  folders: ReadonlySet<string>;
  onSettled: (uploads: Upload[]) => void;
}) => {
  const t = useT();
  const uploads = useUploads();
  const hasFinished = uploads.some((upload) => upload.state !== "uploading");

  return (
    <Card elevation="low">
      <VStack gap={4}>
        <HStack hAlign="between" vAlign="center">
          <Heading level={2}>{t("files.upload")}</Heading>
          {hasFinished ? (
            <Button
              label={t("upload.clearFinished")}
              variant="ghost"
              size="sm"
              onClick={() => {
                clearFinished();
                // The button goes away with the finished uploads, so focus moves to the drop zone's
                // button. Its file input is hidden from assistive technology and never focused.
                refocusIfLost(() => buttonLabelled(t("upload.to", { path })));
              }}
            />
          ) : null}
        </HStack>
        <FileInput
          label={t("upload.to", { path })}
          isLabelHidden
          mode="dropzone"
          isMultiple
          value={null}
          onChange={(files) => {
            const list = Array.isArray(files) ? files : files === null ? [] : [files];
            if (list.length > 0) {
              startUploads(path, list, folders, onSettled);
            }
          }}
          placeholder={t("upload.drop")}
        />
        {uploads.map((upload) => (
          <UploadRow key={upload.id} upload={upload} />
        ))}
      </VStack>
    </Card>
  );
};
