import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Text } from "@astryxdesign/core/Text";
import { formatBytes } from "../shell/format";
import { buttonLabelled, refocusIfLost } from "../shell/focus";
import { StatusLabel } from "../shell/StatusLabel";
import { FileName } from "./FileName";
import { clearFinished, startUploads, useUploads, type Upload } from "./uploadStore";

const UploadRow = ({ upload }: { upload: Upload }) => (
  <VStack gap={1}>
    <HStack gap={3} vAlign="center" hAlign="between">
      <StackItem size="fill">
        <FileName name={upload.name} kind="file" />
      </StackItem>
      {upload.state === "uploading" ? (
        <Text type="supporting" color="secondary" hasTabularNumbers>
          {`${formatBytes(upload.sentBytes)} of ${formatBytes(upload.sizeBytes)}`}
        </Text>
      ) : (
        <StatusLabel
          tone={upload.state === "done" ? "success" : "error"}
          label={upload.state === "done" ? `Uploaded to ${upload.path}` : "Failed"}
        />
      )}
    </HStack>
    {upload.state === "uploading" ? (
      <ProgressBar
        label={`Uploading ${upload.name}`}
        isLabelHidden
        value={upload.sentBytes}
        max={Math.max(upload.sizeBytes, 1)}
      />
    ) : null}
    {upload.problem === undefined ? null : (
      <Text type="supporting" color="secondary">
        {upload.problem}
      </Text>
    )}
  </VStack>
);

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
  const uploads = useUploads();
  const hasFinished = uploads.some((upload) => upload.state !== "uploading");

  return (
    <Card elevation="low">
      <VStack gap={4}>
        <HStack hAlign="between" vAlign="center">
          <Heading level={2}>Upload</Heading>
          {hasFinished ? (
            <Button
              label="Clear finished"
              variant="ghost"
              size="sm"
              onClick={() => {
                clearFinished();
                // The button goes away with the finished uploads, so focus moves to the drop zone's
                // button. Its file input is hidden from assistive technology and never focused.
                refocusIfLost(() => buttonLabelled(`Upload files to ${path}`));
              }}
            />
          ) : null}
        </HStack>
        <FileInput
          label={`Upload files to ${path}`}
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
          placeholder="Drop files here or choose them"
        />
        {uploads.map((upload) => (
          <UploadRow key={upload.id} upload={upload} />
        ))}
      </VStack>
    </Card>
  );
};
