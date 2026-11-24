import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { describeError, isUnauthorized } from "../../features/api/client";
import { useMe } from "../../features/api/queries";
import { GoTo, signInHref } from "../../features/auth/GoTo";
import { StepUpDialog } from "../../features/auth/StepUpDialog";
import { DashboardShell } from "../../features/shell/DashboardShell";

/** The Dashboard's pages need a session: without one, the browser goes to sign in and back. */
const DashboardLayout = () => {
  const me = useMe();
  const href = useRouterState({ select: (state) => state.location.href });
  // The page to return to, read once: while the router moves to the sign-in page, the location
  // already names that page, and a return address made from it would never stop growing.
  const [returnTo] = useState(href);
  // The shell and the page's own placeholders show while the session is read, so the prerendered
  // HTML already holds the page's frame and nothing moves once the answer comes.
  if (me.isError) {
    if (isUnauthorized(me.error)) {
      return <GoTo href={signInHref(returnTo)} />;
    }
    return (
      <Center axis="both" padding={4}>
        <Banner
          status="error"
          title="Davloom cannot open the Dashboard"
          description={describeError(me.error)}
          endContent={
            <Button
              label="Try again"
              variant="secondary"
              size="sm"
              isLoading={me.isFetching}
              onClick={() => void me.refetch()}
            />
          }
        />
      </Center>
    );
  }
  return (
    <DashboardShell>
      <Outlet />
      <StepUpDialog />
    </DashboardShell>
  );
};

export const Route = createFileRoute("/_app/_dashboard")({ component: DashboardLayout });
