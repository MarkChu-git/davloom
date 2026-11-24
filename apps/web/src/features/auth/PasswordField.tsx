import { Button } from "@astryxdesign/core/Button";
import { useClipboard } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { InputGroup } from "@astryxdesign/core/InputGroup";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Copy, Dices } from "lucide-react";
import { useState } from "react";
import { generatePassword } from "../api/account";

/**
 * A new password, with Generate, which fills in a random one from Better Auth's generator and
 * shows it, and Copy for the generated one.
 */
export const NewPasswordField = ({
  label,
  value,
  onChange,
  onEnter,
  problem,
  hasAutoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  problem?: string;
  hasAutoFocus?: boolean;
}) => {
  const [generated, setGenerated] = useState<string>();
  const { copy, isCopied } = useClipboard({ announce: "Password copied" });
  const isGenerated = generated !== undefined && generated === value;
  return (
    <InputGroup
      label={label}
      status={problem === undefined ? undefined : { type: "error", message: problem }}
    >
      <TextInput
        label=""
        isLabelHidden
        type={isGenerated ? "text" : "password"}
        value={value}
        onChange={(next) => {
          onChange(next);
        }}
        onEnter={onEnter}
        autoComplete="new-password"
        hasSpellCheck={false}
        autoCapitalize="none"
        hasAutoFocus={hasAutoFocus}
      />
      <Button
        label="Generate"
        icon={<Icon icon={Dices} size="sm" />}
        onClick={() => {
          const next = generatePassword();
          setGenerated(next);
          onChange(next);
        }}
      />
      {isGenerated ? (
        <Button
          label={isCopied ? "Copied" : "Copy"}
          icon={<Icon icon={Copy} size="sm" />}
          onClick={() => void copy(value)}
        />
      ) : null}
    </InputGroup>
  );
};
