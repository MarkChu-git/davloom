import { createFileRoute } from "@tanstack/react-router";
import { RegisterPage } from "../../features/auth/RegisterPage";

export const Route = createFileRoute("/_app/register")({
  staticData: { page: "register" },
  component: RegisterPage,
});
