import { Theme } from "@astryxdesign/core/theme";
import { davloomTheme } from "@davloom/ui/themes/davloom";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useAppearanceMode } from "../features/appearance/store";

// A child of the root route, so it only renders in the browser, where the stored mode is known.
const AppLayout = () => (
  <Theme theme={davloomTheme} mode={useAppearanceMode()}>
    <Outlet />
  </Theme>
);

export const Route = createFileRoute("/_app")({ component: AppLayout });
