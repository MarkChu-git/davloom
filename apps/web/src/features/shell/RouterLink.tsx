import { useRouter } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, MouseEvent } from "react";

const opensElsewhere = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

/**
 * Every Astryx link renders through this component (see LinkProvider in routes/_app.tsx). A plain
 * click on an in-app path navigates through the router instead of reloading the page; new-tab
 * clicks, other targets and external URLs keep the browser's own behavior.
 */
export const RouterLink = ({
  href,
  onClick,
  target,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) => {
  const router = useRouter();
  return (
    <a
      {...props}
      href={href}
      target={target}
      onClick={(event) => {
        onClick?.(event);
        const isInApp = href?.startsWith("/") === true && !href.startsWith("//");
        if (event.defaultPrevented || !isInApp || target !== undefined || opensElsewhere(event)) {
          return;
        }
        event.preventDefault();
        void router.navigate({ href });
      }}
    />
  );
};
