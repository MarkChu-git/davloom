import { AppShell, useAppShellMobile } from "@astryxdesign/core/AppShell";
import { Button } from "@astryxdesign/core/Button";
import { Icon, type IconType } from "@astryxdesign/core/Icon";
import { VStack } from "@astryxdesign/core/Layout";
import { Popover } from "@astryxdesign/core/Popover";
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
  Menu,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode, type SVGProps } from "react";
import { storageAlert } from "../storage/summary";
import { NAV_WIDTH } from "./pageWidth";
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

const isCurrent = (pathname: string, href: string): boolean =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

/**
 * One row. An alert's glyph follows the label, and its words join the link's name. The rail draws
 * only icons, so there the glyph takes the icon's place and the words join the label, which also
 * fills the row's tooltip.
 */
const NavItem = ({
  entry,
  isSelected,
  onChoose,
}: {
  entry: NavEntry;
  isSelected: boolean;
  onChoose?: () => void;
}) => {
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
        onClick={onChoose}
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
      onClick={onChoose}
      endContent={
        alert === undefined ? undefined : (
          <Icon icon={alert.tone} color={alert.tone} size="sm" label={alert.text} />
        )
      }
    />
  );
};

/** The navigation's rows in their three groups, marking the page at `pathname` as current. */
const navGroups = (pathname: string, onChoose?: () => void) => {
  const item = (entry: NavEntry) => (
    <NavItem
      key={entry.href}
      entry={entry}
      isSelected={isCurrent(pathname, entry.href)}
      onChoose={onChoose}
    />
  );
  return {
    work: (
      <SideNavSection title="Dashboard" isHeaderHidden>
        {WORK_ITEMS.map(item)}
      </SideNavSection>
    ),
    manage: <SideNavSection title="Manage">{MANAGE_ITEMS.map(item)}</SideNavSection>,
    account: (
      <SideNavSection title="Account" isHeaderHidden>
        {item(SETTINGS)}
      </SideNavSection>
    ),
  };
};

/**
 * On a phone, AppShell trades the side navigation for a bar across the top. The same rows then drop
 * down from a Menu button in that bar. They stay links, as navigation should, rather than becoming
 * a menu of actions, and reaching another page closes the dropdown.
 */
const PhoneMenu = ({ pathname }: { pathname: string }) => {
  const { isMobile } = useAppShellMobile();
  // The page the dropdown opened on, so a row or the browser's Back button closes it.
  const [openOn, setOpenOn] = useState<string>();
  if (!isMobile) {
    // A window widened past the phone layout shuts the dropdown, so it stays shut on the way back.
    if (openOn !== undefined) {
      setOpenOn(undefined);
    }
    return null;
  }
  const groups = navGroups(pathname, () => setOpenOn(undefined));
  return (
    <Popover
      label="Menu"
      alignment="end"
      width={NAV_WIDTH.defaultWidth}
      padding={2}
      isOpen={openOn === pathname}
      onOpenChange={(isOpen) => setOpenOn(isOpen ? pathname : undefined)}
      content={
        <VStack gap={2}>
          {groups.work}
          {groups.manage}
          {groups.account}
        </VStack>
      }
    >
      <Button label="Menu" variant="ghost" icon={<Icon icon={Menu} size="sm" />} />
    </Popover>
  );
};

/**
 * AppShell's own phone navigation is a drawer. A node of ours in its place turns the drawer and its
 * toggle off but keeps the bar across the top, whose end holds the side navigation's footer icons.
 */
const NO_DRAWER = <></>;

/** The Dashboard frame (PRD §13, Phase 4 deliverable 1): a side navigation around each page. */
export const DashboardShell = ({ children }: { children: ReactNode }) => {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const groups = navGroups(pathname);

  return (
    <AppShell
      contentPadding={0}
      mobileNav={NO_DRAWER}
      sideNav={
        <SideNav
          // The footer draws its own collapse button, at the size of the rows above it, so its
          // chevron lines up with their icons.
          collapsible={{ hasButton: false }}
          resizable={{ ...NAV_WIDTH, autoSaveId: "davloom.side-nav" }}
          header={<SideNavHeading heading="Davloom" headingHref="/" icon={<LoomMark />} />}
          footer={groups.account}
          // On a phone the collapse button hides itself, and the Menu button takes its place.
          footerIcons={
            <>
              <SideNavCollapseButton size="md" />
              <PhoneMenu pathname={pathname} />
            </>
          }
        >
          {groups.work}
          {groups.manage}
        </SideNav>
      }
    >
      {children}
    </AppShell>
  );
};
