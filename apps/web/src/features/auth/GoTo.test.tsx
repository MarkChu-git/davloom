import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderPage } from "../../test/render";
import { AuthFrame } from "./AuthFrame";
import { GoTo, signInHref } from "./GoTo";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("signInHref", () => {
  it.each([
    ["/", "/sign-in"],
    ["/files", "/sign-in?redirect=%2Ffiles"],
    ["/files?path=%2Ffiles%2Fa+b", "/sign-in?redirect=%2Ffiles%3Fpath%3D%252Ffiles%252Fa%2Bb"],
    ["/settings?section=about", "/sign-in?redirect=%2Fsettings%3Fsection%3Dabout"],
  ])("returns from sign-in to %s through %s", (href, signIn) => {
    expect(signInHref(href)).toBe(signIn);
    const back = new URLSearchParams(signIn.split("?")[1]).get("redirect");
    expect(back ?? "/").toBe(href);
  });
});

describe("GoTo", () => {
  it.each([
    ["/files?path=%2Ffiles", "/files?path=%2Ffiles"],
    ["/sign-in?redirect=%2Fstorage", "/sign-in?redirect=%2Fstorage"],
  ])("opens %s in place of the page, once", async (href, opened) => {
    const { router } = await renderPage(<GoTo href={href} />, { path: "/somewhere" });
    expect(screen.getByText("Opening Davloom")).toBeTruthy();
    await waitFor(() => expect(router.state.location.href).toBe(opened));
    // It replaces the page it stands in for, so Back skips it.
    expect(router.history.length).toBe(1);
  });
});

describe("AuthFrame", () => {
  it.each([
    ["with a description", "Sign in to manage your files."],
    ["without one", undefined],
  ])("frames a form %s under the brand", async (_, description) => {
    await renderPage(
      <AuthFrame title="Sign in" description={description}>
        <p>The form</p>
      </AuthFrame>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeTruthy();
    expect(screen.getByText("Davloom")).toBeTruthy();
    expect(screen.getByText("The form")).toBeTruthy();
    if (description !== undefined) {
      expect(screen.getByText(description)).toBeTruthy();
    }
  });
});
