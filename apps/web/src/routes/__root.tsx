import { davloomTheme } from "@davloom/ui/themes/davloom";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { APPEARANCE_SCRIPT, SUPPORTED_COLOR_SCHEMES } from "../features/appearance/script";
import globals from "../styles/globals.css?url";

// Prerendered into index.html. The appearance script puts the stored mode on <html> before React
// hydrates it. React writes the stylesheet first in <head>, so the script runs once the stylesheet
// has loaded, still before <body> is parsed. A stylesheet in <head> holds back rendering, so the
// first paint already shows the stored mode.
const Document = ({ children }: { children: ReactNode }) => (
  <html lang="en" data-astryx-theme={davloomTheme.name} suppressHydrationWarning>
    <head>
      <HeadContent />
      <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
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
      // The schemes the page supports, known before any stylesheet loads. It never changes, so
      // hydration finds it as rendered; the scheme in use is set on <html>.
      { name: "color-scheme", content: SUPPORTED_COLOR_SCHEMES },
      { title: "Davloom" },
    ],
    links: [
      { rel: "stylesheet", href: globals },
      // The build appends Davloom's own StyleX rules to the stylesheet above. `vite dev` serves
      // them at this address instead, and the plugin's runtime refetches them as modules compile.
      // The plugin adds both through index.html, which TanStack Start does not use, so the shell
      // has to name them.
      ...(import.meta.env.DEV ? [{ rel: "stylesheet", href: "/virtual:stylex.css" }] : []),
      // Davloom's mark, in the accent of the scheme the browser prefers.
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
    scripts: import.meta.env.DEV ? [{ type: "module", src: "/@id/virtual:stylex:runtime" }] : [],
  }),
  shellComponent: Document,
});
