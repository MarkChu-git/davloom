import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "../../../features/overview/OverviewPage";

export const Route = createFileRoute("/_app/_dashboard/")({
  staticData: { page: "overview" },
  component: OverviewPage,
});
