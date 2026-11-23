import { Icon } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import * as stylex from "@stylexjs/stylex";
import {
  File,
  FileArchive,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  Folder,
  Image,
  type LucideIcon,
} from "lucide-react";
import type { EntryKind } from "../api/dav";

const styles = stylex.create({
  row: { minWidth: 0 },
  stem: { minWidth: 0 },
  extension: { flexShrink: 0 },
});

const ICONS: Record<string, LucideIcon> = {
  md: FileText,
  txt: FileText,
  log: FileText,
  pdf: FileText,
  xlsx: FileSpreadsheet,
  heic: Image,
  mov: FileVideoCamera,
  mp4: FileVideoCamera,
  zst: FileArchive,
};

/** Up to eight letters or digits after the last dot, so "Meeting w. Bob" has no extension. */
const EXTENSION = /\.[\da-z]{1,8}$/i;

/** Splits "report.final.pdf" into "report.final" and ".pdf"; names without one keep it empty. */
export const splitExtension = (name: string): [stem: string, extension: string] => {
  const match = EXTENSION.exec(name);
  // A leading dot, as in ".env", starts the name rather than an extension.
  return match === null || match.index === 0 ? [name, ""] : [name.slice(0, match.index), match[0]];
};

export const iconFor = (name: string, kind: EntryKind): LucideIcon =>
  kind === "folder" ? Folder : (ICONS[splitExtension(name)[1].slice(1).toLowerCase()] ?? File);

/**
 * A file name on one line. A long stem ends in an ellipsis and shows itself whole on hover, while
 * the extension stays visible, so "Quarterly report … .pdf" still says what kind of file it is.
 * Where another picture already leads the name, as a failed operation's cause does, the name can
 * leave out the picture of its kind.
 */
export const FileName = ({
  name,
  kind,
  weight,
  hasIcon = true,
}: {
  name: string;
  kind: EntryKind;
  weight?: "semibold";
  hasIcon?: boolean;
}) => {
  const [stem, extension] = kind === "folder" ? [name, ""] : splitExtension(name);
  return (
    <HStack gap={2} vAlign="center" xstyle={styles.row}>
      {hasIcon ? (
        <Icon
          icon={iconFor(name, kind)}
          size="sm"
          color={kind === "folder" ? "primary" : "secondary"}
        />
      ) : null}
      {/* Two boxes on screen would read as two words, "report .pdf", so assistive technology
          gets the whole name once instead. */}
      <HStack vAlign="center" xstyle={styles.row} aria-hidden>
        <Text weight={weight} maxLines={1} xstyle={styles.stem}>
          {stem}
        </Text>
        {extension === "" ? null : (
          <Text weight={weight} xstyle={styles.extension}>
            {extension}
          </Text>
        )}
      </HStack>
      <VisuallyHidden>{name}</VisuallyHidden>
    </HStack>
  );
};
