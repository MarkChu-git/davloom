import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DashboardShell } from "../../features/shell/DashboardShell";

const DashboardLayout = () => (
  <DashboardShell>
    <Outlet />
  </DashboardShell>
);

export const Route = createFileRoute("/_app/_dashboard")({ component: DashboardLayout });
