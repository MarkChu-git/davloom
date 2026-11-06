import { davloomTheme } from "@davloom/ui/themes/davloom";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { APPEARANCE_SCRIPT } from "../features/appearance/script";
import globals from "../styles/globals.css?url";

// Prerendered into index.html. The appearance script changes <html> before React hydrates it.
const Document = ({ children }: { children: ReactNode }) => (
  <html lang="zh-CN" data-astryx-theme={davloomTheme.name} suppressHydrationWarning>
    <head>
      <HeadContent />
    </head>
    <body>
      {children}
      <Scripts />
    </body>
  </html>
);

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Davloom" },
    ],
    links: [{ rel: "stylesheet", href: globals }],
    scripts: [{ children: APPEARANCE_SCRIPT }],
  }),
  shellComponent: Document,
});
