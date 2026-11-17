import { AppShell } from "@astryxdesign/core/AppShell";
import { Icon, type IconType } from "@astryxdesign/core/Icon";
import {
  SideNav,
  SideNavCollapseButton,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
  useSideNavCollapse,
} from "@astryxdesign/core/SideNav";
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
import { storageAlert } from "../storage/summary";
import type { Tone } from "./StatusLabel";

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
  /** A problem the row names on every page, such as an unreachable backend. */
  alert?: { tone: Tone; text: string };
}

/** The pages people open most, at the top without a heading, as in Linear. */
const WORK_ITEMS: NavEntry[] = [
  { label: "Overview", href: "/", ...navIcons(LayoutDashboard) },
  { label: "Files", href: "/files", ...navIcons(Folder) },
];

/** The pages that set the service up. */
const MANAGE_ITEMS: NavEntry[] = [
  { label: "Credentials", href: "/credentials", ...navIcons(KeyRound) },
  { label: "Storage & Mounts", href: "/storage", ...navIcons(HardDrive), alert: storageAlert },
];

const SETTINGS: NavEntry = { label: "Settings", href: "/settings", ...navIcons(Settings) };

/**
 * Width of the side navigation in pixels. Dragging its edge below the minimum folds it to the icon
 * rail, and the browser keeps the chosen width and state between visits.
 */
const NAV_WIDTH = { defaultWidth: 248, minWidth: 200, maxWidth: 400 } as const;

const isCurrent = (pathname: string, href: string): boolean =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

/**
 * One row. An alert's glyph follows the label, and its words join the link's name. The rail draws
 * only icons, so there the glyph takes the icon's place and the words join the label, which also
 * fills the row's tooltip.
 */
const NavItem = ({ entry, isSelected }: { entry: NavEntry; isSelected: boolean }) => {
  const { isCollapsed } = useSideNavCollapse();
  const { alert } = entry;
  if (alert !== undefined && isCollapsed) {
    const glyph = <Icon icon={alert.tone} color={alert.tone} size="sm" />;
    return (
      <SideNavItem
        label={`${entry.label}, ${alert.text}`}
        icon={glyph}
        selectedIcon={glyph}
        href={entry.href}
        isSelected={isSelected}
      />
    );
  }
  return (
    <SideNavItem
      label={entry.label}
      icon={entry.icon}
      selectedIcon={entry.selectedIcon}
      href={entry.href}
      isSelected={isSelected}
      endContent={
        alert === undefined ? undefined : (
          <Icon icon={alert.tone} color={alert.tone} size="sm" label={alert.text} />
        )
      }
    />
  );
};

/** The Dashboard frame (PRD §13, Phase 4 deliverable 1): a side navigation around each page. */
export const DashboardShell = ({ children }: { children: ReactNode }) => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const item = (entry: NavEntry) => (
    <NavItem key={entry.href} entry={entry} isSelected={isCurrent(pathname, entry.href)} />
  );

  return (
    <AppShell
      contentPadding={0}
      sideNav={
        <SideNav
          // The footer draws its own collapse button, at the size of the rows above it, so its
          // chevron lines up with their icons.
          collapsible={{ hasButton: false }}
          resizable={{ ...NAV_WIDTH, autoSaveId: "davloom.side-nav" }}
          header={<SideNavHeading heading="Davloom" headingHref="/" icon={<LoomMark />} />}
          footer={
            <SideNavSection title="Account" isHeaderHidden>
              {item(SETTINGS)}
            </SideNavSection>
          }
          footerIcons={<SideNavCollapseButton size="md" />}
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
