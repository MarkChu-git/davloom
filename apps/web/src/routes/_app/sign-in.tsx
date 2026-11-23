import { createFileRoute } from "@tanstack/react-router";
import { SignInPage } from "../../features/auth/SignInPage";

const SignInRoute = () => <SignInPage redirect={Route.useSearch().redirect} />;

export const Route = createFileRoute("/_app/sign-in")({
  // The router keeps every search value as text (router.tsx).
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  head: () => ({ meta: [{ title: "Sign in | Davloom" }] }),
  component: SignInRoute,
});
