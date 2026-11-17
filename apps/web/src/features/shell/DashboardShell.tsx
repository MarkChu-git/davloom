import { AppShell } from "@astryxdesign/core/AppShell";
import type { IconType } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/Layout";
import {
  SideNav,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
  useSideNavCollapse,
} from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import { LoomMark } from "@davloom/ui";
import { useRouterState } from "@tanstack/react-router";
import {
  Folder,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode, SVGProps } from "react";
import { StorageAlert } from "./StorageAlert";

/** A Lucide icon drawn at a fixed stroke width. */
const stroked = (Glyph: LucideIcon, strokeWidth: number): IconType => {
  const Stroked = (props: Omit<SVGProps<SVGSVGElement>, "ref">) => (
    <Glyph {...props} strokeWidth={strokeWidth} />
  );
  Stroked.displayName = `Stroked(${Glyph.displayName ?? "Icon"})`;
  return Stroked;
};

/**
 * A light stroke for a row and a heavier one for the current page: Astryx pairs `icon` with
 * `selectedIcon` so the current page differs in shape as well as in shade, and Lucide draws no
 * filled variants.
 */
const navIcons = (Glyph: LucideIcon) => ({
  icon: stroked(Glyph, 1.75),
  selectedIcon: stroked(Glyph, 2.25),
});

interface NavEntry {
  label: string;
  href: string;
  icon: IconType;
  selectedIcon: IconType;
  endContent?: ReactNode;
}

/** The pages people open most, at the top without a heading, as in Linear. */
const WORK_ITEMS: NavEntry[] = [
  { label: "Overview", href: "/", ...navIcons(LayoutDashboard) },
  { label: "Files", href: "/files", ...navIcons(Folder) },
];

/** The pages that set the service up. */
const MANAGE_ITEMS: NavEntry[] = [
  { label: "Credentials", href: "/credentials", ...navIcons(KeyRound) },
  {
    label: "Storage & Mounts",
    href: "/storage",
    ...navIcons(HardDrive),
    endContent: <StorageAlert />,
  },
];

const SETTINGS: NavEntry = { label: "Settings", href: "/settings", ...navIcons(Settings) };

const isCurrent = (pathname: string, href: string): boolean =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

/** The notice that every page shows sample data (dashboard-navigation spec), hidden in the rail. */
const SampleDataNote = () => {
  const { isCollapsed } = useSideNavCollapse();
  return isCollapsed ? null : (
    <HStack paddingInline={2}>
      <Text type="supporting" color="secondary">
        Prototype, sample data
      </Text>
    </HStack>
  );
};

/** The Dashboard frame (PRD §13, Phase 4 deliverable 1): a side navigation around each page. */
export const DashboardShell = ({ children }: { children: ReactNode }) => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const item = (entry: NavEntry) => (
    <SideNavItem
      key={entry.href}
      label={entry.label}
      icon={entry.icon}
      selectedIcon={entry.selectedIcon}
      href={entry.href}
      size="sm"
      isSelected={isCurrent(pathname, entry.href)}
      endContent={entry.endContent}
    />
  );

  return (
    <AppShell
      contentPadding={0}
      sideNav={
        <SideNav
          collapsible
          header={<SideNavHeading heading="Davloom" headingHref="/" icon={<LoomMark />} />}
          footer={
            <>
              <SideNavSection title="Account" isHeaderHidden>
                {item(SETTINGS)}
              </SideNavSection>
              <SampleDataNote />
            </>
          }
        >
          <SideNavSection title="Dashboard" isHeaderHidden>
            {WORK_ITEMS.map(item)}
          </SideNavSection>
          <SideNavSection title="Manage">{MANAGE_ITEMS.map(item)}</SideNavSection>
        </SideNav>
      }
    >
      {children}
    </AppShell>
  );
};
