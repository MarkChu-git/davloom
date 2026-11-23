import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Waiting } from "./AuthFrame";

/**
 * Opens a Dashboard address, which may carry a search, in place of the page. It navigates once
 * per address: the router's Navigate navigated again on every render while the router was busy,
 * which never ended.
 */
export const GoTo = ({ href }: { href: string }) => {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ href, replace: true });
  }, [navigate, href]);
  return <Waiting label="Opening Davloom" />;
};

/** The sign-in page, returning to `href` once signed in. */
export const signInHref = (href: string): string =>
  href === "/" ? "/sign-in" : `/sign-in?${new URLSearchParams({ redirect: href }).toString()}`;
