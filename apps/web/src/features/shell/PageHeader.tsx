import { Heading } from "@astryxdesign/core/Heading";
import type { ReactNode } from "react";
import { TitleRow } from "./TitleRow";

/**
 * The title row every Dashboard page starts with: its name and the actions for the whole page.
 * Buttons among the actions are TitleAction buttons, which show only their icons on a narrow page.
 */
export const PageHeader = ({ title, actions }: { title: string; actions?: ReactNode }) => (
  <TitleRow title={<Heading level={1}>{title}</Heading>} actions={actions} />
);
