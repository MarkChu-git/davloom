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

/** Whether a title row shows its buttons' icons alone, for the buttons to follow. */
interface CompactStore {
  get: () => boolean;
  set: (isCompact: boolean) => void;
  subscribe: (onChange: () => void) => () => void;
}

const createCompactStore = (): CompactStore => {
  let isCompact = false;
  const listeners = new Set<() => void>();
  return {
    get: () => isCompact,
    set: (next) => {
      if (next === isCompact) return;
      isCompact = next;
      for (const listener of listeners) listener();
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
};

/** Outside a title row, a button keeps its words. */
const IsCompact = createContext<CompactStore>(createCompactStore());

/**
 * Whether the title row around the button shows icons alone. The button follows the row from its
 * layout effect, which runs before the row's measures, so the row's first answer reaches it before
 * the browser paints.
 */
const useIsCompact = (): boolean => {
  const store = useContext(IsCompact);
  const [isCompact, setIsCompact] = useState(store.get);
  useLayoutEffect(() => {
    const follow = () => setIsCompact(store.get());
    follow();
    return store.subscribe(follow);
  }, [store]);
  return isCompact;
};

/**
 * A button among a title row's actions. Where the row has no room for the actions' words beside
 * the title, as on a phone, the button shows only its icon: its label still names it, and its
 * tooltip shows the label unless the button has a tooltip of its own.
 */
export const TitleAction = (props: ButtonProps) => {
  const isCompact = useIsCompact();
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
  // row exists. Whether it is compact is not state of the row either: only its TitleAction buttons
  // render again when it changes, and a row without any, such as the Overview's, renders once.
  const row = useRef<HTMLDivElement>(null);
  const [compact] = useState(createCompactStore);
  // The width of the title, the gap and the actions with their words shown.
  const needed = useRef(0);
  useLayoutEffect(() => {
    const element = row.current;
    if (element === null) {
      return undefined;
    }
    const measure = () => {
      const [heading, group] = element.children;
      if (!compact.get() && heading !== undefined && group !== undefined) {
        const space = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
        needed.current = heading.getBoundingClientRect().width + space + group.scrollWidth;
      }
      compact.set(needed.current > element.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact]);

  return (
    <HStack ref={row} hAlign="between" vAlign="center" gap={gap} wrap="wrap">
      {title}
      {actions === undefined ? null : (
        <HStack gap={2} vAlign="center" wrap="wrap" xstyle={styles.actions}>
          <IsCompact.Provider value={compact}>{actions}</IsCompact.Provider>
        </HStack>
      )}
    </HStack>
  );
};
