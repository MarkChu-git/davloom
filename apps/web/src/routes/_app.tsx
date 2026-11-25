import { LinkProvider } from "@astryxdesign/core/Link";
import { Theme } from "@astryxdesign/core/theme";
import { davloomTheme } from "@davloom/ui/themes/davloom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { browserQueryClient, createQueryClient } from "../features/api/queries";
import { useAppearanceMode } from "../features/appearance/store";
import { I18nProvider, LocaleFrames } from "../features/i18n/I18nProvider";
import { useActiveLocale } from "../features/i18n/store";
import { RouterLink } from "../features/shell/RouterLink";

// The Dashboard's providers. The prerender renders them too, with the frame of each page; it reads
// nothing, and the browser renders the page again with its stored mode, its language and the API's
// answers. The prerender draws the page in each language (LocaleFrames).
const AppLayout = () => {
  const [client] = useState(() =>
    import.meta.env.SSR ? createQueryClient() : browserQueryClient(),
  );
  const locale = useActiveLocale();
  return (
    <QueryClientProvider client={client}>
      <Theme theme={davloomTheme} mode={useAppearanceMode()}>
        <LinkProvider component={RouterLink}>
          {import.meta.env.SSR ? (
            <LocaleFrames>
              <Outlet />
            </LocaleFrames>
          ) : (
            <I18nProvider locale={locale}>
              <Outlet />
            </I18nProvider>
          )}
        </LinkProvider>
      </Theme>
    </QueryClientProvider>
  );
};

export const Route = createFileRoute("/_app")({ component: AppLayout });
