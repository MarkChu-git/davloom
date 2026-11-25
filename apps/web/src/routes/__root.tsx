import { davloomTheme } from "@davloom/ui/themes/davloom";
import {
  Asset,
  createRootRoute,
  Scripts,
  useMatches,
  useRouterState,
  useTags,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { APPEARANCE_SCRIPT, SUPPORTED_COLOR_SCHEMES } from "../features/appearance/script";
import { FILL_SCRIPT, FRAME_PARSED_SCRIPT, frameTexts } from "../features/frame/fill";
import { pageText } from "../features/i18n/pages";
import { languageScript } from "../features/i18n/script";
import { useActiveLocale } from "../features/i18n/store";
import globals from "../styles/globals.css?url";

/**
 * The route-managed head tags, as TanStack Router's HeadContent renders them, but without the
 * modulepreload links for the page's code. The frame paints from the HTML and CSS alone, so the code
 * downloads once the entry script asks for it instead of competing with the stylesheet, and the
 * entry's own imports still fetch each chunk in parallel. The title and the description follow the
 * page and the language.
 */
const PageHead = ({ title, description }: { title: string; description: string }) => {
  const tags = useTags().filter((tag) => tag.attrs?.rel !== "modulepreload");
  return (
    <>
      {tags.map((tag) => (
        <Asset {...tag} key={`tsr-meta-${JSON.stringify(tag)}`} />
      ))}
      <title>{title}</title>
      <meta name="description" content={description} />
    </>
  );
};

/** The page that names the tab: the deepest route whose staticData names one. */
const usePage = () =>
  useMatches({
    select: (matches) => matches.findLast((match) => match.staticData.page)?.staticData.page,
  });

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
// before the page renders, and the language script puts the stored or the browser's language there
// as `lang`, which shows the frame in that language (LocaleFrames) and, for Chinese, writes the
// page's Chinese title and description. React writes the stylesheet first in <head>, so the scripts
// run once the stylesheet has loaded, still before <body> is parsed. A stylesheet in <head> holds
// back rendering, so the first paint already shows the stored mode and the language. The
// prerendered frame's <body> carries `data-frame` until client.tsx renders the page in its place.
// A person can type into the frame's fields meanwhile, and the page takes what they typed
// (features/frame/carry.ts).
const Document = ({ children }: { children: ReactNode }) => {
  const locale = useActiveLocale();
  const page = usePage();
  const text = pageText(page, locale);
  return (
    <html lang={locale} data-astryx-theme={davloomTheme.name} suppressHydrationWarning>
      <head>
        <PageHead title={text.title} description={text.description} />
        {import.meta.env.SSR ? <FramePreloads /> : null}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: languageScript(pageText(page, "zh-CN")) }} />
        {/* Starts the reads whose values the frame shows first, and writes them into it. */}
        <script dangerouslySetInnerHTML={{ __html: FILL_SCRIPT }} />
      </head>
      <body data-frame={import.meta.env.SSR ? "" : undefined}>
        {children}
        {/* The frame is parsed: the script in <head> may write into it before the code below runs. */}
        {import.meta.env.SSR ? (
          <script dangerouslySetInnerHTML={{ __html: FRAME_PARSED_SCRIPT }} />
        ) : null}
        <Scripts />
      </body>
    </html>
  );
};

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // The schemes the page supports, known before any stylesheet loads. It never changes, so
      // hydration finds it as rendered; the scheme in use is set on <html>.
      { name: "color-scheme", content: SUPPORTED_COLOR_SCHEMES },
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
