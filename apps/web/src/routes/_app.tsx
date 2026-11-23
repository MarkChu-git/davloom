import { LinkProvider } from "@astryxdesign/core/Link";
import { Theme } from "@astryxdesign/core/theme";
import { davloomTheme } from "@davloom/ui/themes/davloom";
import { QueryClientProvider } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { createQueryClient } from "../features/api/queries";
import { useAppearanceMode } from "../features/appearance/store";
import { RouterLink } from "../features/shell/RouterLink";

// A child of the root route, so it only renders in the browser, where the stored mode is known and
// the API can be reached.
const AppLayout = () => {
  const [client] = useState(createQueryClient);
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
