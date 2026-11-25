import { createFileRoute } from "@tanstack/react-router";
import { CredentialsPage } from "../../../features/credentials/CredentialsPage";

export const Route = createFileRoute("/_app/_dashboard/credentials")({
  head: () => ({
    meta: [
      { title: "Credentials | Davloom" },
      {
        name: "description",
        content: "Create and revoke the API Keys that WebDAV clients sign in with.",
      },
    ],
  }),
  component: CredentialsPage,
});
