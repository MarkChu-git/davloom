import { Button } from "@astryxdesign/core/Button";
import { useAnnounce, useClipboard } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { InputGroup } from "@astryxdesign/core/InputGroup";
import { VStack } from "@astryxdesign/core/Layout";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Copy } from "lucide-react";
import { useState } from "react";
import { useNarrowerThan } from "./useNarrowerThan";

const BLOCKED = "This browser blocked copying here. Select the text and copy it yourself.";

/**
 * The narrowest field, in rem, whose Copy button still shows its words beside the whole WebDAV
 * address. A narrower field, as on a phone, keeps only the button's icon and leaves the room to
 * the address; the words remain the button's name and its tooltip.
 */
const ROOM_FOR_WORDS = 24;

/**
 * A value to copy, such as the WebDAV address or a new key. An Astryx InputGroup joins the field
 * and its Copy button in one row under the label, so the button lines up with the field, and puts
 * a status under the row. The field stays selectable, because the clipboard API refuses plain-HTTP
 * origins and copying by hand must still work there; when the browser refuses, the field says so.
 */
export const CopyField = ({
  label,
  value,
  copyLabel,
  isLabelHidden = false,
  width,
}: {
  label: string;
  value: string;
  copyLabel: string;
  isLabelHidden?: boolean;
  /**
   * The widest the field and its button grow, narrowing to fit a smaller row. Without one, they
   * fill the row.
   */
  width?: string;
}) => {
  const { copy, isCopied } = useClipboard({ announce: `${label} copied` });
  const announce = useAnnounce();
  const [isBlocked, setIsBlocked] = useState(false);
  const [ref, isNarrow] = useNarrowerThan(ROOM_FOR_WORDS);
  const buttonLabel = isCopied ? "Copied" : copyLabel;
  return (
    <VStack ref={ref} width={width} maxWidth="100%">
      <InputGroup
        label={label}
        isLabelHidden={isLabelHidden}
        status={isBlocked ? { type: "warning", message: BLOCKED } : undefined}
      >
        <TextInput
          label="Value"
          isLabelHidden
          value={value}
          isReadOnly
          autoComplete="off"
          hasSpellCheck={false}
        />
        <Button
          label={buttonLabel}
          isIconOnly={isNarrow}
          tooltip={isNarrow ? buttonLabel : undefined}
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
      </InputGroup>
    </VStack>
  );
};
