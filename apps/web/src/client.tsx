import { RouterProvider } from "@tanstack/react-router";
import { hydrateStart } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { createRoot } from "react-dom/client";
import { prefetchPage } from "./features/api/prefetch";
import { browserQueryClient } from "./features/api/queries";

// Each page's HTML is a frame prerendered without data (vite.config.ts), which the browser paints
// before any script runs. React renders the Dashboard afresh in its place instead of hydrating it:
// what the Dashboard shows depends on the window, the stored appearance, the browser's storage and
// the API, none of which the prerender knows, and a hydrated page would have to match the frame
// first and then change. New elements in place of the frame move nothing that was on screen.

/** How long the page waits for its first reads before it renders without them. */
const FIRST_READS_MS = 3000;

/**
 * Resolves in a task of its own. The steps below each take a task, so the browser can answer input
 * between them: a phone's slower processor would otherwise run them all in one long task, and the
 * page could not answer a tap until they had all finished.
 */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const start = async () => {
  // The task that evaluated this module and the libraries it imports ends here.
  await nextTask();
  const client = browserQueryClient();
  // The page's first reads start now, beside the page's code, rather than once the page has
  // rendered. Every later page starts its reads as soon as the router begins to open it.
  const firstReads = Promise.race([
    prefetchPage(client, location.pathname),
    new Promise<void>((resolve) => setTimeout(resolve, FIRST_READS_MS)),
  ]);
  await nextTask();
  // The code every page shares, which the components of the page's routes import, runs on its own
  // before the router loads those components, so its evaluation and theirs take separate tasks.
  await import("@astryxdesign/core/theme");
  await nextTask();
  const [router] = await Promise.all([hydrateStart(), firstReads]);
  router.subscribe("onBeforeLoad", ({ toLocation }) => {
    void prefetchPage(client, toLocation.pathname);
  });
  // The router has read the prerendered state and loaded the page's code, and the page's reads
  // have answered, so React renders the whole page with its data in one pass and puts it in the
  // frame's place in one commit. The pass is a transition, which React renders in slices that leave
  // the main thread free in between.
  startTransition(() => {
    createRoot(document).render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
  });
};

// Not a top-level await: the page's code imports this module, and would wait for it to finish.
void start();
