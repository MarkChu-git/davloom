import { createFileRoute } from "@tanstack/react-router";
import { CredentialsPage } from "../../../features/credentials/CredentialsPage";

export const Route = createFileRoute("/_app/_dashboard/credentials")({
  staticData: { page: "credentials" },
  component: CredentialsPage,
});
