import { davloomTheme } from "@davloom/ui/themes/davloom";
import { Asset, createRootRoute, Scripts, useTags } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { APPEARANCE_SCRIPT, SUPPORTED_COLOR_SCHEMES } from "../features/appearance/script";
import globals from "../styles/globals.css?url";

/**
 * The route-managed head tags, as TanStack Router's HeadContent renders them, but without the
 * modulepreload links for the page's code. The frame paints from the HTML and CSS alone, so the code
 * downloads once the entry script asks for it instead of competing with the stylesheet, and the
 * entry's own imports still fetch each chunk in parallel.
 */
const PageHead = () => {
  const tags = useTags().filter((tag) => tag.attrs?.rel !== "modulepreload");
  return tags.map((tag) => <Asset {...tag} key={`tsr-meta-${JSON.stringify(tag)}`} />);
};

// Prerendered into each page's HTML file. The appearance script puts the stored mode on <html>
// before the page renders. React writes the stylesheet first in <head>, so the script runs once the
// stylesheet has loaded, still before <body> is parsed. A stylesheet in <head> holds back
// rendering, so the first paint already shows the stored mode. The prerendered frame is `inert`:
// it is only a picture of the page until client.tsx renders the page in its place, so nothing in
// it takes focus, a click or typing that the render would then throw away.
const Document = ({ children }: { children: ReactNode }) => (
  <html lang="en" data-astryx-theme={davloomTheme.name} suppressHydrationWarning>
    <head>
      <PageHead />
      <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
    </head>
    <body inert={import.meta.env.SSR ? true : undefined}>
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
      // Prerendered, so the page has one before any script runs; each page's route names its own.
      { name: "description", content: "Davloom: your own WebDAV storage and its Dashboard." },
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
