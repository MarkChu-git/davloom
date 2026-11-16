import { AppShell } from "@astryxdesign/core/AppShell";
import { Icon } from "@astryxdesign/core/Icon";
import { NavIcon } from "@astryxdesign/core/NavIcon";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { useRouterState } from "@tanstack/react-router";
import { Cloud, Folder, HardDrive, KeyRound, LayoutDashboard, Settings } from "lucide-react";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Files", href: "/files", icon: Folder },
  { label: "Credentials", href: "/credentials", icon: KeyRound },
  { label: "Storage & Mounts", href: "/storage", icon: HardDrive },
] as const;

const isCurrent = (pathname: string, href: string): boolean =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

/** The Dashboard frame (PRD §13, Phase 4 deliverable 1): a side navigation around each page. */
export const DashboardShell = ({ children }: { children: ReactNode }) => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <AppShell
      contentPadding={0}
      sideNav={
        <SideNav
          collapsible
          header={
            <SideNavHeading
              heading="Davloom"
              subheading="Prototype, sample data"
              headingHref="/"
              icon={<NavIcon icon={<Icon icon={Cloud} size="sm" />} />}
            />
          }
          footer={
            <SideNavSection title="Account" isHeaderHidden>
              <SideNavItem
                label="Settings"
                icon={Settings}
                href="/settings"
                isSelected={isCurrent(pathname, "/settings")}
              />
            </SideNavSection>
          }
        >
          <SideNavSection title="Dashboard" isHeaderHidden>
            {NAV_ITEMS.map((item) => (
              <SideNavItem
                key={item.href}
                label={item.label}
                icon={item.icon}
                href={item.href}
                isSelected={isCurrent(pathname, item.href)}
              />
            ))}
          </SideNavSection>
        </SideNav>
      }
    >
      {children}
    </AppShell>
  );
};
