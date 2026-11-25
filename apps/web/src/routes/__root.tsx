import { davloomTheme } from "@davloom/ui/themes/davloom";
import { Asset, createRootRoute, Scripts, useRouterState, useTags } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { APPEARANCE_SCRIPT, SUPPORTED_COLOR_SCHEMES } from "../features/appearance/script";
import { FILL_SCRIPT, FRAME_PARSED_SCRIPT, frameTexts } from "../features/frame/fill";
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

/**
 * Preloads for the reads the frame's script starts, in the prerendered HTML only. The browser's
 * preload scanner finds them as the HTML arrives, so the reads run while the stylesheet loads,
 * and the script's own fetch of each takes the preloaded answer. `crossOrigin` "anonymous" gives
 * the request fetch()'s defaults (CORS mode, same-origin credentials), so the two match.
 */
const FramePreloads = () => {
  const { pathname, search } = useRouterState({
    select: (state) => ({ pathname: state.location.pathname, search: state.location.searchStr }),
  });
  const section = new URLSearchParams(search).get("section");
  return frameTexts
    .framePaths(pathname, section)
    .map((path) => (
      <link key={path} rel="preload" href={path} as="fetch" crossOrigin="anonymous" />
    ));
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
      {import.meta.env.SSR ? <FramePreloads /> : null}
      <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      {/* Starts the reads whose values the frame shows first, and writes them into it. */}
      <script dangerouslySetInnerHTML={{ __html: FILL_SCRIPT }} />
    </head>
    <body inert={import.meta.env.SSR ? true : undefined}>
      {children}
      {/* The frame is parsed: the script in <head> may write into it before the code below runs. */}
      {import.meta.env.SSR ? (
        <script dangerouslySetInnerHTML={{ __html: FRAME_PARSED_SCRIPT }} />
      ) : null}
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
