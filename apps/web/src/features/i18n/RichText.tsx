import { Fragment, type ReactNode } from "react";

const TAG = /<(\w+)>(.*?)<\/\1>/g;

/**
 * A message whose words hold markup, such as "Create a key on <link>Credentials</link>.": each
 * tag's words go to the renderer of that name, so a translation can move the link within its
 * sentence. A tag without a renderer keeps its words as text.
 */
export const RichText = ({
  text,
  tags,
}: {
  text: string;
  tags: Readonly<Record<string, (words: string) => ReactNode>>;
}) => {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(TAG)) {
    const [whole, name = "", words = ""] = match;
    parts.push(text.slice(at, match.index));
    const render = tags[name];
    parts.push(
      <Fragment key={match.index}>{render === undefined ? words : render(words)}</Fragment>,
    );
    at = match.index + whole.length;
  }
  parts.push(text.slice(at));
  return parts;
};
