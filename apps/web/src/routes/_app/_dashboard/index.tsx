import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "../../../features/overview/OverviewPage";

export const Route = createFileRoute("/_app/_dashboard/")({
  head: () => ({
    meta: [
      { title: "Overview | Davloom" },
      {
        name: "description",
        content: "Storage use, traffic and the state of every backend of your Davloom instance.",
      },
    ],
  }),
  component: OverviewPage,
});
