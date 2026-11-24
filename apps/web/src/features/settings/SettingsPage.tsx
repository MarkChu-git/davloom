import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Layout, LayoutContent, LayoutPanel, VStack } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { useNavigate } from "@tanstack/react-router";
import {
  Contrast,
  FileDown,
  HardDrive,
  Info,
  Link as LinkIcon,
  Lock,
  User,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { webdavAddress } from "../api/dav";
import { describeError } from "../api/client";
import { exportInstance } from "../api/queries";
import { AppearanceSwitch } from "../appearance/AppearanceSwitch";
import { CopyField } from "../shell/CopyField";
import { TitleLine } from "../shell/PageHeader";
import { useIsNarrowPage, usePageGutter } from "../shell/pageWidth";
import { useNarrowerThan } from "../shell/useNarrowerThan";
import { AboutContent, StorageSettingsContent } from "./InstanceSections";
import { ProfileContent } from "./ProfileSection";
import { SecurityContent } from "./SecuritySection";
import { SETTINGS_SECTIONS, type SettingsSection } from "./sections";

const SECTION_ICONS: Record<SettingsSection, LucideIcon> = {
  profile: User,
  security: Lock,
  appearance: Contrast,
  webdav: LinkIcon,
  storage: HardDrive,
  export: FileDown,
  about: Info,
};

// A section's heading shares the line of the page's title, and its content starts a gutter below,
// where the section list and the side navigation start theirs.
const SectionFrame = ({ title, children }: { title: string; children: ReactNode }) => (
  <VStack gap={6}>
    <TitleLine>
      <Heading level={2}>{title}</Heading>
    </TitleLine>
    {children}
  </VStack>
);

/** The narrowest section, in rem, whose values have room beside their labels. */
const WIDE_DETAILS = 30;

/** Labels beside their values, or above them where a narrow section has no room. */
const Details = ({ children }: { children: ReactNode }) => {
  const [ref, isNarrow] = useNarrowerThan(WIDE_DETAILS);
  return (
    <VStack ref={ref}>
      <MetadataList label={isNarrow ? { position: "top" } : undefined}>{children}</MetadataList>
    </VStack>
  );
};

const ProfileSection = () => (
  <SectionFrame title="Profile">
    <ProfileContent />
  </SectionFrame>
);

const SecuritySection = () => (
  <SectionFrame title="Sign-in and security">
    <SecurityContent />
  </SectionFrame>
);

const AppearanceSection = () => (
  <SectionFrame title="Appearance">
    <AppearanceSwitch />
  </SectionFrame>
);

const WebDavSection = () => (
  <SectionFrame title="WebDAV">
    <CopyField label="Address" value={webdavAddress()} copyLabel="Copy address" />
    <VStack gap={2}>
      <Heading level={3}>Connecting a client</Heading>
      <Details>
        <MetadataListItem label="Server">
          <Text type="code">{webdavAddress()}</Text>
        </MetadataListItem>
        <MetadataListItem label="Username">Any name</MetadataListItem>
        <MetadataListItem label="Password">An API key</MetadataListItem>
      </Details>
      <Text type="supporting" color="secondary">
        Create a key for each device on <Link href="/credentials">Credentials</Link>. In Finder,
        choose Go, then Connect to Server; in rclone, add a remote of type webdav with vendor other.
      </Text>
    </VStack>
  </SectionFrame>
);

/** Saves a value as a JSON file in the browser's downloads. */
const download = (name: string, value: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

const ExportSection = () => {
  const [key, setKey] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [isExporting, setIsExporting] = useState(false);
  const run = async () => {
    setIsExporting(true);
    setFailure(undefined);
    try {
      const result = await exportInstance();
      download(`davloom-export-${new Date().toISOString().slice(0, 10)}.json`, result.file);
      setKey(result.key);
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setIsExporting(false);
    }
  };
  return (
    <SectionFrame title="Data export">
      <Text>
        An export saves the administrator, the keys, the backends, the mounts and their properties
        in one encrypted file. Set up a new Davloom from it to move this instance. The files stay in
        their backends.
      </Text>
      {failure === undefined ? null : <Banner status="error" title={failure} container="card" />}
      {key === undefined ? null : (
        <VStack gap={4}>
          <Banner
            status="success"
            title="The export is in your downloads"
            description="Keep this key with the file. It opens the file, and Davloom shows it only now."
            container="card"
          />
          <CopyField label="Export key" value={key} copyLabel="Copy key" />
        </VStack>
      )}
      <HStack>
        <Button
          label={key === undefined ? "Export" : "Export again"}
          variant={key === undefined ? "primary" : "secondary"}
          isLoading={isExporting}
          onClick={() => void run()}
        />
      </HStack>
    </SectionFrame>
  );
};

const StorageSection = () => (
  <SectionFrame title="Storage">
    <StorageSettingsContent />
  </SectionFrame>
);

const AboutSection = () => (
  <SectionFrame title="About this instance">
    <AboutContent />
  </SectionFrame>
);

const SECTION_CONTENT: Record<SettingsSection, () => ReactNode> = {
  profile: ProfileSection,
  security: SecuritySection,
  appearance: AppearanceSection,
  webdav: WebDavSection,
  storage: StorageSection,
  export: ExportSection,
  about: AboutSection,
};

/** Settings (PRD §8.5): a section list beside the chosen section. */
export const SettingsPage = ({ section }: { section: SettingsSection }) => {
  const Content = SECTION_CONTENT[section];
  const navigate = useNavigate();
  // Responsive contract: on a page wider than 776px, which a 1024px window leaves beside the side
  // navigation at its default width, the sections are a 280px list beside the chosen one. On a
  // narrower page the list becomes a selector above the section, which keeps the remaining width.
  // Folding or widening the side navigation can switch the layout, so both keep the section at the
  // same place in the tree: React then keeps it mounted, with its unsaved input and running timers.
  const isNarrow = useIsNarrowPage();
  const gutter = usePageGutter();

  return (
    <Layout
      height="fill"
      start={
        isNarrow ? undefined : (
          <LayoutPanel
            hasDivider
            padding={gutter}
            width={280}
            role="navigation"
            label="Settings sections"
          >
            <VStack gap={6}>
              <TitleLine>
                <Heading level={1}>Settings</Heading>
              </TitleLine>
              <List density="balanced">
                {SETTINGS_SECTIONS.map((item) => (
                  <ListItem
                    key={item.id}
                    label={item.label}
                    startContent={<Icon icon={SECTION_ICONS[item.id]} size="sm" />}
                    href={`/settings?section=${item.id}`}
                    isSelected={item.id === section}
                  />
                ))}
              </List>
            </VStack>
          </LayoutPanel>
        )
      }
      content={
        <LayoutContent padding={gutter}>
          <VStack gap={6} maxWidth={isNarrow ? undefined : 640}>
            {isNarrow ? (
              <VStack gap={6}>
                <TitleLine>
                  <Heading level={1}>Settings</Heading>
                </TitleLine>
                <Selector
                  label="Section"
                  value={section}
                  onChange={(next) => void navigate({ href: `/settings?section=${next}` })}
                  options={SETTINGS_SECTIONS.map(({ id, label }) => ({ value: id, label }))}
                />
              </VStack>
            ) : null}
            <Content />
          </VStack>
        </LayoutContent>
      }
    />
  );
};
