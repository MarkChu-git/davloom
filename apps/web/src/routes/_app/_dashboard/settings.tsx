import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../../../features/settings/SettingsPage";
import { isSettingsSection, type SettingsSection } from "../../../features/settings/sections";

const SettingsRoute = () => <SettingsPage section={Route.useSearch().section ?? "profile"} />;

export const Route = createFileRoute("/_app/_dashboard/settings")({
  validateSearch: (search: Record<string, unknown>): { section?: SettingsSection } => ({
    section: isSettingsSection(search.section) ? search.section : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Settings | Davloom" },
      {
        name: "description",
        content: "Your Davloom account, instance address, appearance and sessions.",
      },
    ],
  }),
  component: SettingsRoute,
});
