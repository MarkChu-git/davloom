import { AppShell, useAppShellMobile } from "@astryxdesign/core/AppShell";
import { Button } from "@astryxdesign/core/Button";
import { Icon, type IconType } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Popover } from "@astryxdesign/core/Popover";
import {
  SideNav,
  SideNavCollapseButton,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
  useSideNavCollapse,
  type SideNavSectionProps,
} from "@astryxdesign/core/SideNav";
import { spacingVars } from "@astryxdesign/core/theme/tokens.stylex";
import { LoomMark } from "@davloom/ui";
import * as stylex from "@stylexjs/stylex";
import { useRouterState } from "@tanstack/react-router";
import {
  Folder,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode, type SVGProps } from "react";
import { useBackends } from "../api/queries";
import { useSignOut } from "../auth/useSignOut";
import { storageAlert } from "../storage/backendStatus";
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

/** The pages that set the service up; Storage & Mounts names a backend that does not answer. */
const manageItems = (alert: NavEntry["alert"]): NavEntry[] => [
  { label: "Credentials", href: "/credentials", ...navIcons(KeyRound) },
  { label: "Storage & Mounts", href: "/storage", ...navIcons(HardDrive), alert },
];

const SIGN_OUT_ICONS = navIcons(LogOut);

interface NavOptions {
  alert: NavEntry["alert"];
  onSignOut: () => void;
  isSigningOut: boolean;
  onChoose?: () => void;
}

const SETTINGS: NavEntry = { label: "Settings", href: "/settings", ...navIcons(Settings) };

/**
 * The side navigation keeps to the page's grid. Beside the page, its content starts one gutter,
 * 24 px, in from the window's edge, as a page's content starts one gutter in from the navigation.
 * The brand's row sits on the line of a page's title, one gutter below the top, the first row
 * starts where a page's content does, one gutter below the title, and the last row ends one gutter
 * above the bottom. SideNav pads its parts by 8 px, so each part adds the rest. The rail keeps the
 * lines across and centers its icons, and a phone's bar keeps AppShell's own spacing.
 */
const useNavGrid = () => {
  const { isMobile } = useAppShellMobile();
  const { isCollapsed } = useSideNavCollapse();
  return { isMobile, inset: isMobile || isCollapsed ? (0 as const) : (2 as const) };
};

/** The mark and name of the product, on the line of the page's title. */
const NavBrand = () => {
  const { isMobile, inset } = useNavGrid();
  const heading = <SideNavHeading heading="Davloom" headingHref="/" icon={<LoomMark />} />;
  return isMobile ? (
    heading
  ) : (
    <VStack paddingBlockStart={4} paddingBlockEnd={2} paddingInline={inset}>
      {heading}
    </VStack>
  );
};

/** A group of rows, inset to the navigation's gutter. */
const NavSection = (props: SideNavSectionProps) => {
  const { inset } = useNavGrid();
  return (
    <VStack paddingInline={inset}>
      <SideNavSection {...props} />
    </VStack>
  );
};

/** The collapse button, one gutter above the bottom, or the Menu button in a phone's bar. */
const NavFooterIcons = ({ children }: { children: ReactNode }) => {
  const { isMobile, inset } = useNavGrid();
  return isMobile ? (
    children
  ) : (
    <HStack gap={1} paddingBlockEnd={4} paddingInline={inset}>
      {children}
    </HStack>
  );
};

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
const navGroups = (pathname: string, { alert, onSignOut, isSigningOut, onChoose }: NavOptions) => {
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
      <NavSection title="Dashboard" isHeaderHidden>
        {WORK_ITEMS.map(item)}
      </NavSection>
    ),
    manage: <NavSection title="Manage">{manageItems(alert).map(item)}</NavSection>,
    account: (
      <NavSection title="Account" isHeaderHidden>
        {item(SETTINGS)}
        <SideNavItem
          label="Sign out"
          {...SIGN_OUT_ICONS}
          isDisabled={isSigningOut}
          onClick={() => {
            onChoose?.();
            onSignOut();
          }}
        />
      </NavSection>
    ),
  };
};

const styles = stylex.create({
  // AppShell pads the ends of a phone's bar by spacing-2, and the brand's link pads the mark by
  // spacing-2 more, so the mark starts on the page's gutter, spacing-4. A ghost button pads its
  // words by spacing-3, which left the Menu button's words 4 px short of the gutter at the bar's
  // other end. The button pads its end as the link pads its start, so its words end on the gutter.
  // It stays inside the bar: SideNav's bar clips what reaches past it, and scrolls sideways to show
  // a focused button whole.
  menu: {
    paddingInlineEnd: spacingVars["--spacing-2"],
  },
  // The dropdown ends where the button's words do, on the gutter, rather than at the button's edge,
  // and keeps the navigation's width.
  dropdown: {
    marginInlineStart: `calc(-1 * ${spacingVars["--spacing-2"]})`,
    marginInlineEnd: spacingVars["--spacing-2"],
  },
});

/**
 * On a phone, AppShell trades the side navigation for a bar across the top. The same rows then drop
 * down from a Menu button in that bar. They stay links, as navigation should, rather than becoming
 * a menu of actions, and reaching another page closes the dropdown.
 */
const PhoneMenu = ({ pathname, options }: { pathname: string; options: NavOptions }) => {
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
  const groups = navGroups(pathname, { ...options, onChoose: () => setOpenOn(undefined) });
  return (
    <Popover
      label="Menu"
      alignment="end"
      width={NAV_WIDTH.defaultWidth}
      padding={2}
      xstyle={styles.dropdown}
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
      <Button
        label="Menu"
        variant="ghost"
        icon={<Icon icon={Menu} size="sm" />}
        xstyle={styles.menu}
      />
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
  const backends = useBackends();
  const { isSigningOut, signOut: onSignOut, element: signOutDialog } = useSignOut();
  const options: NavOptions = { alert: storageAlert(backends.data), onSignOut, isSigningOut };
  const groups = navGroups(pathname, options);

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
          header={<NavBrand />}
          footer={groups.account}
          // On a phone the collapse button hides itself, and the Menu button takes its place.
          footerIcons={
            <NavFooterIcons>
              <SideNavCollapseButton size="md" />
              <PhoneMenu pathname={pathname} options={options} />
            </NavFooterIcons>
          }
        >
          {groups.work}
          {groups.manage}
        </SideNav>
      }
    >
      {children}
      {signOutDialog}
    </AppShell>
  );
};
