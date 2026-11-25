import { LinkProvider } from "@astryxdesign/core/Link";
import { Theme } from "@astryxdesign/core/theme";
import { davloomTheme } from "@davloom/ui/themes/davloom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { browserQueryClient, createQueryClient } from "../features/api/queries";
import { useAppearanceMode } from "../features/appearance/store";
import { RouterLink } from "../features/shell/RouterLink";

// The Dashboard's providers. The prerender renders them too, with the frame of each page; it reads
// nothing, and the browser renders the page again with its stored mode and the API's answers.
const AppLayout = () => {
  const [client] = useState(() =>
    import.meta.env.SSR ? createQueryClient() : browserQueryClient(),
  );
  return (
    <QueryClientProvider client={client}>
      <Theme theme={davloomTheme} mode={useAppearanceMode()}>
        <LinkProvider component={RouterLink}>
          <Outlet />
        </LinkProvider>
      </Theme>
    </QueryClientProvider>
  );
};

export const Route = createFileRoute("/_app")({ component: AppLayout });
