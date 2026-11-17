import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/Layout";
import type { ReactNode } from "react";
import { TitleRow } from "./TitleRow";

/**
 * The line a title sits on: as tall as the side navigation's brand row, with the title centered in
 * it. A page's title, the brand and a heading beside the title then share one line, even where a
 * touch screen's type scale makes the title's own line taller. A title that can wrap, such as a
 * file's name, grows the line instead.
 */
export const TitleLine = ({
  children,
  canWrap = false,
}: {
  children: ReactNode;
  canWrap?: boolean;
}) =>
  canWrap ? (
    <HStack minHeight="var(--spacing-8)" vAlign="center">
      {children}
    </HStack>
  ) : (
    <HStack height="var(--spacing-8)" vAlign="center">
      {children}
    </HStack>
  );

/**
 * The title row every Dashboard page starts with: its name and the actions for the whole page.
 * Buttons among the actions are TitleAction buttons, which show only their icons on a narrow page.
 * An action that moves below the title, such as the Overview's address, sits a gutter below it, on
 * the line where the side navigation's first row starts.
 */
export const PageHeader = ({ title, actions }: { title: string; actions?: ReactNode }) => (
  <TitleRow
    title={
      <TitleLine>
        <Heading level={1}>{title}</Heading>
      </TitleLine>
    }
    actions={actions}
    gap={6}
  />
);
