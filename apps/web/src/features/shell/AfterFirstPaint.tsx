import { type ReactNode, startTransition, useEffect, useState } from "react";

/** The turn of the last part to ask for one; it settles once that part is on screen. */
let lastTurn: Promise<void> = Promise.resolve();

/**
 * Content that renders only once the rest of the page is on screen, in a render of its own that
 * React can pause for input. A page that would otherwise build everything in one long task puts
 * what lies below its header in one or more of these. They take turns, in the order they are put on
 * the page: each renders in a task of its own once the one before it is on screen, so no single
 * task builds the whole page and the browser paints and answers input in between. Each renders
 * nothing until its turn, so they belong at the end of the page, in order: content added below
 * the rest moves nothing that is already there.
 */
export const AfterFirstPaint = ({ children }: { children: ReactNode }) => {
  const [isShown, setIsShown] = useState(false);
  const [done, setDone] = useState<() => void>();

  useEffect(() => {
    let isCurrent = true;
    let finish = () => {};
    const previous = lastTurn;
    lastTurn = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    void previous.then(() => {
      if (!isCurrent) {
        finish();
        return;
      }
      timer = setTimeout(() => {
        startTransition(() => {
          setIsShown(true);
          setDone(() => finish);
        });
      }, 0);
    });
    return () => {
      isCurrent = false;
      clearTimeout(timer);
      // A part that leaves the page before its turn hands the turn on.
      finish();
    };
  }, []);

  useEffect(() => {
    // This part is on screen: the next one may start, in a task after this one.
    done?.();
  }, [done]);

  return isShown ? children : null;
};
