import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TouchHold } from "./TouchHold";

// TouchHold stands between a finger and the chart inside it. The chart here is a bare <svg> that
// records the events that reach it.

type Point = { x: number; y: number };

const seen: string[] = [];

const record = (event: Event) => {
  const pointer = event instanceof PointerEvent ? `:${event.pointerType}` : "";
  const at = event instanceof MouseEvent ? `@${event.clientX},${event.clientY}` : "";
  seen.push(`${event.type}${pointer}${at}`);
};

const RECORDED = ["pointerdown", "pointermove", "pointercancel", "click", "focusin", "mouseleave"];

const renderHold = (withChart = true) => {
  render(<TouchHold>{withChart ? <svg data-testid="chart" /> : <p>No chart</p>}</TouchHold>);
  if (withChart) {
    const chart = screen.getByTestId("chart");
    for (const type of RECORDED) {
      chart.addEventListener(type, record);
    }
    return chart;
  }
  return screen.getByText("No chart");
};

/** A touch event as the browser sends it, with the fingers on the screen and its time. */
const touch = (type: string, points: Point[], timeStamp?: number): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: points.map(({ x, y }) => ({ clientX: x, clientY: y })),
  });
  if (timeStamp !== undefined) {
    Object.defineProperty(event, "timeStamp", { value: timeStamp });
  }
  return event;
};

const pointer = (type: string, pointerType: string, at: Point = { x: 1, y: 2 }) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerType,
    clientX: at.x,
    clientY: at.y,
  });

const at = (event: Event, timeStamp: number): Event => {
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  return event;
};

const send = (target: Element, event: Event): boolean => {
  let result = true;
  act(() => {
    result = target.dispatchEvent(event);
  });
  return result;
};

const hold = (target: Element, point: Point) => {
  send(target, touch("touchstart", [point]));
  act(() => {
    vi.advanceTimersByTime(500);
  });
};

beforeEach(() => {
  seen.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TouchHold, guards", () => {
  it.each(["pointerdown", "pointermove", "pointercancel"])(
    "keeps a finger's own %s from the chart",
    (type) => {
      const chart = renderHold();
      const allowed = send(chart, pointer(type, "touch"));
      expect(seen).toEqual([]);
      // A finger's press is cancelled, so it neither focuses the chart nor selects its labels.
      expect(allowed).toBe(type !== "pointerdown");
    },
  );

  it.each(["mouse", "pen"])("lets a %s through to the chart", (pointerType) => {
    const chart = renderHold();
    for (const type of ["pointerdown", "pointermove", "pointercancel"]) {
      expect(send(chart, pointer(type, pointerType))).toBe(true);
    }
    expect(seen).toEqual([
      `pointerdown:${pointerType}@1,2`,
      `pointermove:${pointerType}@1,2`,
      `pointercancel:${pointerType}@1,2`,
    ]);
  });

  it.each([
    { title: "a finger's click", event: () => pointer("click", "touch"), reaches: false },
    { title: "a mouse's click", event: () => pointer("click", "mouse"), reaches: true },
    {
      title: "a click without a pointer type",
      event: () => new MouseEvent("click", { bubbles: true }),
      reaches: true,
    },
  ])("decides whether $title reaches the chart", ({ event, reaches }) => {
    const chart = renderHold();
    send(chart, event());
    expect(seen.length).toBe(reaches ? 1 : 0);
  });

  it.each([
    { title: "while the finger is down", lift: false, after: 0, reaches: false },
    { title: "just after the finger lifts", lift: true, after: 200, reaches: false },
    { title: "a second after the finger lifts", lift: true, after: 1000, reaches: true },
  ])("decides whether a click and focus reach the chart $title", ({ lift, after, reaches }) => {
    const chart = renderHold();
    send(chart, touch("touchstart", [{ x: 5, y: 5 }], 1000));
    if (lift) {
      send(chart, touch("touchend", [], 2000));
    }
    const time = (lift ? 2000 : 1000) + after;
    send(chart, at(new MouseEvent("click", { bubbles: true }), time));
    send(chart, at(new FocusEvent("focusin", { bubbles: true }), time));
    expect(seen).toEqual(reaches ? ["click@0,0", "focusin"] : []);
  });

  it("lets focus from the keyboard through", () => {
    const chart = renderHold();
    send(chart, new FocusEvent("focusin", { bubbles: true }));
    expect(seen).toEqual(["focusin"]);
  });
});

describe("TouchHold, holding", () => {
  it("shows the point under a held finger, follows it, and hides it on the lift", () => {
    const chart = renderHold();
    hold(chart, { x: 10, y: 20 });
    expect(seen).toEqual(["pointermove:touch@10,20"]);

    // While the finger holds the chart, it moves along the chart and not the page.
    const move = touch("touchmove", [{ x: 30, y: 21 }]);
    expect(send(chart, move)).toBe(false);
    expect(seen.at(-1)).toBe("pointermove:touch@30,21");

    // Android's context menu stays shut, and the chart keeps its values up.
    expect(send(chart, new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))).toBe(
      false,
    );
    send(chart, new MouseEvent("mouseleave", { bubbles: true }));
    expect(seen.filter((event) => event.startsWith("mouseleave"))).toEqual([]);

    send(chart, touch("touchend", []));
    expect(seen.at(-1)).toBe("pointercancel:touch@0,0");

    // Once the finger lifts, the page has its menu and the chart its mouseleave again.
    expect(send(chart, new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))).toBe(
      true,
    );
    send(chart, new MouseEvent("mouseleave", { bubbles: true }));
    expect(seen.at(-1)).toBe("mouseleave@0,0");
  });

  it.each([
    {
      title: "a tap",
      gesture: (chart: Element) => {
        send(chart, touch("touchstart", [{ x: 10, y: 20 }]));
        send(chart, touch("touchend", []));
      },
    },
    {
      title: "a scroll across the chart",
      gesture: (chart: Element) => {
        send(chart, touch("touchstart", [{ x: 10, y: 20 }]));
        expect(send(chart, touch("touchmove", [{ x: 10, y: 80 }]))).toBe(true);
      },
    },
    {
      title: "two fingers",
      gesture: (chart: Element) => {
        send(
          chart,
          touch("touchstart", [
            { x: 10, y: 20 },
            { x: 50, y: 20 },
          ]),
        );
      },
    },
    {
      title: "a cancelled touch",
      gesture: (chart: Element) => {
        send(chart, touch("touchstart", [{ x: 10, y: 20 }]));
        send(chart, touch("touchcancel", []));
      },
    },
    {
      title: "a move with no finger left",
      gesture: (chart: Element) => {
        send(chart, touch("touchmove", []));
      },
    },
  ])("shows nothing for $title", ({ gesture }) => {
    const chart = renderHold();
    gesture(chart);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(seen).toEqual([]);
  });

  it("keeps waiting while the finger stays within reach of where it pressed", () => {
    const chart = renderHold();
    send(chart, touch("touchstart", [{ x: 10, y: 20 }]));
    send(chart, touch("touchmove", [{ x: 14, y: 24 }]));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(seen).toEqual(["pointermove:touch@10,20"]);
  });

  it("holds without a chart inside and sends nothing", () => {
    const content = renderHold(false);
    hold(content, { x: 10, y: 20 });
    expect(send(content, touch("touchmove", [{ x: 12, y: 20 }]))).toBe(false);
    send(content, touch("touchend", []));
    expect(seen).toEqual([]);
  });
});
