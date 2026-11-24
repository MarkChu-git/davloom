import { Theme } from "@astryxdesign/core/theme";
import { davloomTheme } from "@davloom/ui/themes/davloom";
import { useQuery } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../api/client";
import { json, renderPage } from "../../test/render";
import { CopyField } from "./CopyField";
import { PageHeader, TitleLine } from "./PageHeader";
import { QueryState } from "./QueryState";
import { StatusLabel, type Tone } from "./StatusLabel";
import { TitleAction, TitleRow } from "./TitleRow";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const themed = (ui: ReactNode) =>
  render(
    <Theme theme={davloomTheme} mode="light">
      {ui}
    </Theme>,
  );

/** Makes every element `width` pixels wide, as a browser would lay out a row of that width. */
const layOut = (width: number, heading = 0) => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(200);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width: heading === 0 ? width : heading, height: 20 }),
  );
};

describe("StatusLabel", () => {
  it.each<[Tone, string]>([
    ["success", "Available"],
    ["warning", "Slow"],
    ["error", "Unavailable"],
    ["info", "Checking"],
  ])("shows %s as the words %j", (tone, label) => {
    themed(<StatusLabel tone={tone} label={label} />);
    expect(screen.getByText(label)).toBeTruthy();
  });
});

describe("PageHeader", () => {
  it.each([
    ["without actions", undefined, []],
    ["with an action", <TitleAction key="a" label="New key" />, ["New key"]],
  ])("names the page %s", (_, actions, buttons) => {
    themed(<PageHeader title="Credentials" actions={actions} />);
    expect(screen.getByRole("heading", { level: 1, name: "Credentials" })).toBeTruthy();
    expect(screen.queryAllByRole("button").map((button) => button.textContent)).toEqual(buttons);
  });

  it.each([true, false])("keeps a title that can wrap (%s) on its line", (canWrap) => {
    themed(
      <TitleLine canWrap={canWrap}>
        <span>report.pdf</span>
      </TitleLine>,
    );
    expect(screen.getByText("report.pdf")).toBeTruthy();
  });
});

describe("TitleRow", () => {
  it("keeps the actions' words where they fit beside the title", () => {
    layOut(1000, 300);
    themed(<TitleRow title={<h1>Files</h1>} actions={<TitleAction label="Upload" />} />);
    expect(screen.getByRole("button", { name: "Upload" }).textContent).toBe("Upload");
  });

  it("shows only the icons where the words do not fit, and names them still", async () => {
    layOut(300, 250);
    themed(
      <TitleRow
        title={<h1>Files</h1>}
        actions={
          <>
            <TitleAction label="Upload" />
            <TitleAction label="New folder" tooltip="Make a folder" />
          </>
        }
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Upload" }).textContent).toBe(""),
    );
    expect(screen.getByRole("button", { name: "New folder" }).textContent).toBe("");
  });

  it("shows a title without actions", () => {
    layOut(300);
    themed(<TitleRow title={<h1>Overview</h1>} />);
    expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy();
  });
});

/** The browser's clipboard, answering each write with `result`. */
const writeText = (result: () => Promise<void>) =>
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(result);

describe("CopyField", () => {
  it.each([
    ["a wide field", 800, "Copy address"],
    ["a narrow field", 200, ""],
  ])("in %s shows the button's words %j", (_, width, words) => {
    layOut(width);
    themed(<CopyField label="Address" value="https://d.test/dav/" copyLabel="Copy address" />);
    expect(screen.getByRole("button", { name: "Copy address" }).textContent).toBe(words);
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Address" }).value).toBe(
      "https://d.test/dav/",
    );
  });

  it("copies the value and says so", async () => {
    layOut(800);
    writeText(async () => undefined);
    themed(<CopyField label="Address" value="https://d.test/dav/" copyLabel="Copy address" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy address" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(screen.queryByText(/blocked copying/)).toBeNull();
  });

  it("says when the browser blocks copying, and stops once a copy works", async () => {
    layOut(800);
    let isAllowed = false;
    writeText(async () => {
      if (!isAllowed) {
        throw new DOMException("denied", "NotAllowedError");
      }
    });
    themed(<CopyField label="Key" value="dav_123" copyLabel="Copy key" isLabelHidden />);
    await userEvent.click(screen.getByRole("button", { name: "Copy key" }));
    expect(
      (
        await screen.findAllByText(
          "This browser blocked copying here. Select the text and copy it yourself.",
        )
      ).length,
    ).toBeGreaterThan(0);
    isAllowed = true;
    await userEvent.click(screen.getByRole("button", { name: "Copy key" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Copied" })).toBeTruthy());
  });
});

const Keys = () => {
  const query = useQuery({ queryKey: ["keys"], queryFn: () => apiFetch<string[]>("/api/keys") });
  return (
    <QueryState query={query} title="Cannot read the keys">
      {(names) => <p>{names.length === 0 ? "No keys" : names.join(", ")}</p>}
    </QueryState>
  );
};

describe("QueryState", () => {
  it("shows the data once it arrives", async () => {
    await renderPage(<Keys />, { api: { "GET /api/keys": () => json(["Laptop", "Phone"]) } });
    expect(await screen.findByText("Laptop, Phone")).toBeTruthy();
  });

  it("shows placeholders while it loads", async () => {
    const { container } = await renderPage(<Keys />, {
      api: { "GET /api/keys": () => new Promise<Response>(() => undefined) },
    });
    expect(container.textContent).not.toContain("Cannot read the keys");
    expect(screen.queryByText("No keys")).toBeNull();
  });

  it("says why it failed and reads again on Try again", async () => {
    let answer = json({ error: { code: "x" } }, 500);
    await renderPage(<Keys />, { api: { "GET /api/keys": () => answer.clone() } });
    expect(await screen.findByText("Cannot read the keys", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText("The server refused the request (500).")).toBeTruthy();
    answer = json([]);
    await act(() => userEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(await screen.findByText("No keys")).toBeTruthy();
  });
});
