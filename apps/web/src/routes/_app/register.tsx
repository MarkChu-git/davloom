import { createFileRoute } from "@tanstack/react-router";
import { RegisterPage } from "../../features/auth/RegisterPage";

export const Route = createFileRoute("/_app/register")({
  head: () => ({
    meta: [
      { title: "Create account | Davloom" },
      { name: "description", content: "Create your account on this Davloom instance." },
    ],
  }),
  component: RegisterPage,
});
