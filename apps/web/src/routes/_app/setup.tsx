import { createFileRoute } from "@tanstack/react-router";
import { SetupPage } from "../../features/auth/SetupPage";

export const Route = createFileRoute("/_app/setup")({
  head: () => ({ meta: [{ title: "Set up | Davloom" }] }),
  component: SetupPage,
});
