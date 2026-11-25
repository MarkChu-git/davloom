import { Button, type ButtonProps } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/Layout";
import * as stylex from "@stylexjs/stylex";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const styles = stylex.create({
  // A flex item keeps at least the width of its widest content, so a wide field among the actions
  // would push past a small window. Astryx stacks have no minimum-width prop, and a StackItem
  // either keeps its size or grows to fill the row, so the actions drop that minimum here.
  actions: {
    minWidth: 0,
  },
});

const IsCompact = createContext(false);

/**
 * A button among a title row's actions. Where the row has no room for the actions' words beside
 * the title, as on a phone, the button shows only its icon: its label still names it, and its
 * tooltip shows the label unless the button has a tooltip of its own.
 */
export const TitleAction = (props: ButtonProps) => {
  const isCompact = useContext(IsCompact);
  return (
    <Button
      {...props}
      isIconOnly={isCompact}
      tooltip={props.tooltip ?? (isCompact ? props.label : undefined)}
    />
  );
};

/**
 * A title and the actions for what it heads, on one row. TitleAction buttons keep their words
 * while the title and the actions fit side by side, and show only their icons once they do not.
 * The width they need is measured while the words show, so the row knows when the words fit again.
 * Anything else among the actions, such as a field, moves below the title when it has no room.
 * A row whose actions change while it is on screen needs a new key, so it measures them again.
 */
export const TitleRow = ({
  title,
  actions,
  gap = 4,
}: {
  title: ReactNode;
  actions?: ReactNode;
  gap?: 3 | 4 | 6;
}) => {
  // The row is a ref, not state: the page renders once as it is put on screen, not again once the
  // row exists.
  const row = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);
  // The width of the title, the gap and the actions with their words shown.
  const needed = useRef(0);
  useLayoutEffect(() => {
    const element = row.current;
    if (element === null) {
      return undefined;
    }
    const measure = () => {
      const [heading, group] = element.children;
      if (!isCompact && heading !== undefined && group !== undefined) {
        const space = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
        needed.current = heading.getBoundingClientRect().width + space + group.scrollWidth;
      }
      setIsCompact(needed.current > element.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(element);
    return () => observer.disconnect();
  }, [isCompact]);

  return (
    <HStack ref={row} hAlign="between" vAlign="center" gap={gap} wrap="wrap">
      {title}
      {actions === undefined ? null : (
        <HStack gap={2} vAlign="center" wrap="wrap" xstyle={styles.actions}>
          <IsCompact.Provider value={isCompact}>{actions}</IsCompact.Provider>
        </HStack>
      )}
    </HStack>
  );
};
