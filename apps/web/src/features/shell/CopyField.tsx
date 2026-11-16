import { Button } from "@astryxdesign/core/Button";
import { useAnnounce, useClipboard } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, StackItem } from "@astryxdesign/core/Layout";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Copy } from "lucide-react";
import { useState } from "react";

const BLOCKED = "This browser blocked copying here. Select the text and copy it yourself.";

/**
 * A value to copy, such as the WebDAV address or a new key. The field stays selectable, because
 * the clipboard API refuses plain-HTTP origins and copying by hand must still work there; when
 * the browser refuses, the field says so.
 */
export const CopyField = ({
  label,
  value,
  copyLabel,
  isLabelHidden = false,
}: {
  label: string;
  value: string;
  copyLabel: string;
  isLabelHidden?: boolean;
}) => {
  const { copy, isCopied } = useClipboard({ announce: `${label} copied` });
  const announce = useAnnounce();
  const [isBlocked, setIsBlocked] = useState(false);
  return (
    <HStack gap={2} vAlign="start" wrap="wrap">
      <StackItem size="fill">
        <TextInput
          label={label}
          isLabelHidden={isLabelHidden}
          value={value}
          isReadOnly
          autoComplete="off"
          hasSpellCheck={false}
          status={isBlocked ? { type: "warning", message: BLOCKED } : undefined}
          statusVariant="detached"
        />
      </StackItem>
      <Button
        label={isCopied ? "Copied" : copyLabel}
        icon={<Icon icon={Copy} size="sm" />}
        onClick={() =>
          void copy(value).then((isDone) => {
            setIsBlocked(!isDone);
            if (!isDone) {
              announce(BLOCKED, "assertive");
            }
          })
        }
      />
    </HStack>
  );
};
