import { LinkProvider } from "@astryxdesign/core/Link";
import { Theme } from "@astryxdesign/core/theme";
import { davloomTheme } from "@davloom/ui/themes/davloom";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { createQueryClient } from "../features/api/queries";
import { I18nProvider } from "../features/i18n/context";
import type { Locale } from "../features/i18n/locale";
import { RouterLink } from "../features/shell/RouterLink";

// Renders a Dashboard page as the app does, inside the query client, the theme and a router, with
// `fetch` answered by the test: a handler per "METHOD /path", and 404 for anything else.

export type Handler = (request: Request) => Response | Promise<Response>;

export const ORIGIN = "http://davloom.test";

export const json = (value: unknown, status = 200) => Response.json(value, { status });

export const renderPage = async (
  ui: ReactNode,
  {
    path = "/",
    api = {},
    locale = "en",
  }: { path?: string; api?: Record<string, Handler>; locale?: Locale } = {},
) => {
  const calls: Request[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const request = new Request(new URL(url, ORIGIN), input instanceof Request ? input : init);
    calls.push(request.clone());
    const handler = api[`${request.method} ${new URL(request.url).pathname}`];
    return handler ? await handler(request) : json({ error: { code: "not_found" } }, 404);
  });
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: 10_000 } });
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <Theme theme={davloomTheme} mode="light">
          <I18nProvider locale={locale}>
            <LinkProvider component={RouterLink}>
              {ui}
              <Outlet />
            </LinkProvider>
          </I18nProvider>
        </Theme>
      </QueryClientProvider>
    ),
  });
  const rest = createRoute({ getParentRoute: () => root, path: "$", component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([rest]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  const rendered = render(<RouterProvider router={router} />);
  return { ...rendered, router, calls, client };
};
