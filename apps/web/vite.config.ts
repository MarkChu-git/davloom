import stylex from "@stylexjs/unplugin/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

// `vite dev` serves the Dashboard alone. Set DAVLOOM_API_ORIGIN to a running instance, such as a
// local Worker, and the dev server passes /api and /dav to it. The proxy names the instance as the
// request's origin, so Better Auth takes a sign-in made through the dev server as its own.
const apiOrigin = process.env.DAVLOOM_API_ORIGIN;

const toInstance = (target: string): ProxyOptions => ({
  target,
  changeOrigin: true,
  configure: (proxy) => {
    proxy.on("proxyReq", (request) => {
      if (request.getHeader("origin") !== undefined) {
        request.setHeader("origin", target);
      }
    });
  },
});

// Which part of the Dashboard needs a module, from the modules that import it. Route components
// are split into modules of their own that the router imports when a page opens, so the modules
// that nothing imports statically are the entry and those split route components.
type Part = "start" | "signed-out" | "dashboard";

const partOfRoot = (id: string, isEntry: boolean): Part | undefined => {
  if (isEntry) return "start";
  if (!id.includes("/src/routes/")) return undefined;
  if (id.includes("/src/routes/_app/_dashboard")) return "dashboard";
  // The pages outside the Dashboard's shell: sign-in and setup, and any added beside them.
  return id.includes("/src/routes/_app/design-check") ? undefined : "signed-out";
};

/** The part of Rolldown's module information that the chunks are chosen by. */
type GetModuleInfo = (id: string) => { isEntry: boolean; importers: readonly string[] } | null;

/** The roots that import a module, directly or through others, by the part each belongs to. */
const rootsOf = (id: string, getModuleInfo: GetModuleInfo): Map<Part, Set<string>> => {
  const parts = new Map<Part, Set<string>>();
  const seen = new Set<string>();
  const queue = [id];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    if (seen.has(next)) continue;
    seen.add(next);
    const info = getModuleInfo(next);
    if (info === null) continue;
    const part = partOfRoot(next, info.isEntry);
    if (part !== undefined && (info.isEntry || info.importers.length === 0)) {
      parts.set(part, (parts.get(part) ?? new Set()).add(next));
      continue;
    }
    queue.push(...info.importers);
  }
  return parts;
};

/**
 * Three chunks besides the route components: what every page needs to start, what the signed-out
 * pages need (the Dashboard shares most of it), and what more than one Dashboard page needs. A page
 * then loads a few large files instead of dozens of small ones, sign-in loads none of the
 * Dashboard, and what one page alone needs, such as the Overview's charts, stays with that page.
 */
const chunkName = (id: string, context: { getModuleInfo: GetModuleInfo }) => {
  // A method of the context, which reads its own fields.
  const roots = rootsOf(id, (module) => context.getModuleInfo(module));
  if (roots.has("start")) return "start";
  // A route component stays a chunk of its own, which the router loads after React has hydrated
  // the prerendered shell; one already loaded would render into the shell and not match it.
  if ([...roots.values()].some((ids) => ids.has(id))) return null;
  if (roots.has("signed-out")) return "signed-out";
  return roots.size === 1 && (roots.get("dashboard")?.size ?? 0) > 1 ? "dashboard" : null;
};

/** Every page of the Dashboard, each prerendered to an HTML file of its own. */
const PRERENDERED_PAGES = [
  "/",
  "/files",
  "/credentials",
  "/storage",
  "/settings",
  "/sign-in",
  "/register",
  "/design-check",
  "/design-check/deep/page",
];

export default defineConfig({
  build: {
    rolldownOptions: {
      // Each module goes where `chunkName` puts it, not into the chunk of a module it imports.
      output: {
        codeSplitting: { groups: [{ name: chunkName, includeDependenciesRecursively: false }] },
      },
    },
  },
  server:
    apiOrigin === undefined || apiOrigin === ""
      ? {}
      : { proxy: { "/api": toInstance(apiOrigin), "/dav": toInstance(apiOrigin) } },
  plugins: [
    stylex({
      useCSSLayers: true,
      // Astryx ships compiled without debug, so its style keys are bare hashes. Debug, which
      // `vite dev` turns on by default, puts the property name in front of ours, and then
      // `stylex.props` keeps Astryx's class next to ours instead of replacing it. Where the two
      // rules share a layer, Astryx's can win on the dev server and lose in the build. Without
      // debug, the dev server also leaves out the `data-style-src` attributes that name each
      // style's source file.
      debug: false,
      unstable_moduleResolution: { type: "commonJS" },
    }),
    tanstackStart({
      // Every page's frame is rendered into an HTML file of its own at build time, which needs no
      // data, so the browser paints the page before any script has run.
      prerender: { enabled: true, crawlLinks: false },
      pages: PRERENDERED_PAGES.map((path) => ({
        path,
        // `/files` becomes files.html, which Workers static assets and the Bun entry serve at
        // /files; `/` becomes index.html, the fallback for a path no page has.
        prerender: { enabled: true, autoSubfolderIndex: path === "/" },
      })),
    }),
    react(),
  ],
});
