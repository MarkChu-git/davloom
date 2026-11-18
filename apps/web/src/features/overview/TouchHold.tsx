import { useLongPress } from "@astryxdesign/core/hooks";
import { VStack } from "@astryxdesign/core/Layout";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

const styles = stylex.create({
  // A held finger would otherwise select the chart's labels or open the system's callout.
  hold: {
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
  },
});

/** How long after a finger lifts its click and focus still count as the finger's, in ms. */
const TOUCH_CLICK_WINDOW = 1000;

/**
 * On a touch screen a chart shows a point's values only while a finger holds the chart, as the
 * owner asked: a press held for half a second shows the point under the finger, sliding the
 * finger moves along the chart while the page stays still, and lifting it hides the values. A tap,
 * or a scroll that crosses the chart, shows nothing. TanStack Charts treats a finger like a mouse,
 * so a tap left its tooltip open, since a finger never leaves the chart the way a mouse does. Here
 * the chart never sees a finger: it sees the pointer moves that a hold sends it, and the cancel
 * that a lift sends. A mouse, a pen and the keyboard reach the values as before.
 */
export const TouchHold = ({ children }: { children: ReactNode }) => {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const isHolding = useRef(false);
  const isForwarding = useRef(false);
  const isTouching = useRef(false);
  const touchEndedAt = useRef(Number.NEGATIVE_INFINITY);

  // Sends the chart a pointer event of its own, which the guard below lets through.
  const forward = (type: "pointermove" | "pointercancel", x = 0, y = 0) => {
    const target = element?.querySelector("svg");
    if (target === null || target === undefined) {
      return;
    }
    isForwarding.current = true;
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerType: "touch" }),
    );
    isForwarding.current = false;
  };

  const press = useLongPress({
    onLongPress: ({ x, y }) => {
      isHolding.current = true;
      forward("pointermove", x, y);
    },
  });
  // The listeners below outlive renders, so they ask for the latest handlers each time.
  const latest = useEffectEvent(() => ({ press, forward }));

  useEffect(() => {
    if (element === null) {
      return () => undefined;
    }
    // A finger's own pointer events stop here, before the chart's listeners see them.
    const guard = (event: PointerEvent) => {
      if (event.pointerType === "touch" && !isForwarding.current) {
        event.stopPropagation();
      }
    };
    // A tap would also give the chart focus, and with it the browser's own focus ring. Cancelling
    // the finger's press keeps focus where it was and leaves scrolling alone.
    const guardPress = (event: PointerEvent) => {
      guard(event);
      if (event.pointerType === "touch") {
        event.preventDefault();
      }
    };
    const isFromTouch = (event: Event) =>
      isTouching.current || event.timeStamp - touchEndedAt.current < TOUCH_CLICK_WINDOW;
    // So do the click a tap ends with and the focus the tap gives the chart. The click would show
    // the point tapped for good, and the focus the chart's first point, as Tab does.
    const guardClick = (event: MouseEvent) => {
      const pointerType = event instanceof PointerEvent ? event.pointerType : "";
      if (pointerType === "touch" || isFromTouch(event)) {
        event.stopPropagation();
      }
    };
    const guardFocus = (event: FocusEvent) => {
      if (isFromTouch(event)) {
        event.stopPropagation();
      }
    };
    const begin = (event: TouchEvent) => {
      isTouching.current = true;
      const touch = event.touches[0];
      if (event.touches.length === 1 && touch !== undefined) {
        latest().press.start({ x: touch.clientX, y: touch.clientY });
      } else {
        latest().press.cancel();
      }
    };
    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch === undefined) {
        return;
      }
      if (isHolding.current) {
        // The finger moves along the chart, not the page.
        event.preventDefault();
        latest().forward("pointermove", touch.clientX, touch.clientY);
      } else {
        latest().press.moveTo({ x: touch.clientX, y: touch.clientY });
      }
    };
    const end = (event: TouchEvent) => {
      isTouching.current = event.touches.length > 0;
      touchEndedAt.current = event.timeStamp;
      latest().press.cancel();
      if (isHolding.current) {
        isHolding.current = false;
        latest().forward("pointercancel");
      }
    };
    // Android opens a context menu on a long press.
    const keepMenuShut = (event: MouseEvent) => {
      if (isHolding.current) {
        event.preventDefault();
      }
    };
    // Chromium can send the chart a mouseleave just after the values appear, and the chart hides
    // them on it, under a finger that still holds the chart.
    const keepValuesUp = (event: MouseEvent) => {
      if (isHolding.current) {
        event.stopPropagation();
      }
    };

    const capture = { capture: true };
    element.addEventListener("pointerdown", guardPress, capture);
    element.addEventListener("pointermove", guard, capture);
    element.addEventListener("pointercancel", guard, capture);
    element.addEventListener("click", guardClick, capture);
    element.addEventListener("focusin", guardFocus, capture);
    element.addEventListener("touchstart", begin, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end, { passive: true });
    element.addEventListener("touchcancel", end, { passive: true });
    element.addEventListener("contextmenu", keepMenuShut);
    element.addEventListener("mouseleave", keepValuesUp, capture);
    return () => {
      element.removeEventListener("pointerdown", guardPress, capture);
      element.removeEventListener("pointermove", guard, capture);
      element.removeEventListener("pointercancel", guard, capture);
      element.removeEventListener("click", guardClick, capture);
      element.removeEventListener("focusin", guardFocus, capture);
      element.removeEventListener("touchstart", begin);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", end);
      element.removeEventListener("contextmenu", keepMenuShut);
      element.removeEventListener("mouseleave", keepValuesUp, capture);
    };
  }, [element]);

  return (
    <VStack ref={setElement} xstyle={styles.hold}>
      {children}
    </VStack>
  );
};
