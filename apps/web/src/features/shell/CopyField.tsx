import { Button } from "@astryxdesign/core/Button";
import { useAnnounce, useClipboard } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { InputGroup } from "@astryxdesign/core/InputGroup";
import { VStack } from "@astryxdesign/core/Layout";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Copy } from "lucide-react";
import { useState } from "react";
import { useT } from "../i18n/I18nProvider";
import { useNarrowerThan } from "./useNarrowerThan";

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
  frameSlot,
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
  /** The slot the frame's script (features/frame/fill.ts) writes the value into, if any. */
  frameSlot?: string;
}) => {
  const t = useT();
  const blocked = t("copy.blocked");
  const { copy, isCopied } = useClipboard({ announce: t("copy.announce", { label }) });
  const announce = useAnnounce();
  const [isBlocked, setIsBlocked] = useState(false);
  const [ref, isNarrow] = useNarrowerThan(ROOM_FOR_WORDS);
  const buttonLabel = isCopied ? t("copy.copied") : copyLabel;
  return (
    <VStack ref={ref} width={width} maxWidth="100%">
      <InputGroup
        label={label}
        isLabelHidden={isLabelHidden}
        status={isBlocked ? { type: "warning", message: blocked } : undefined}
      >
        {/* InputGroup names its field with the group's label and then the field's own, so the
            field's own stays empty: a screen reader hears "WebDAV address", not "WebDAV address
            Value". The field is the group's only one, so no word would tell it apart. */}
        <TextInput
          label=""
          isLabelHidden
          value={value}
          isReadOnly
          autoComplete="off"
          hasSpellCheck={false}
          {...(frameSlot === undefined ? {} : { "data-frame-slot": frameSlot })}
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
                announce(blocked, "assertive");
              }
            })
          }
        />
      </InputGroup>
    </VStack>
  );
};
