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
  Activity,
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
import { useT } from "../i18n/I18nProvider";
import { LanguageSwitch } from "../i18n/LanguageSwitch";
import { RichText } from "../i18n/RichText";
import { CopyField } from "../shell/CopyField";
import { TitleLine } from "../shell/PageHeader";
import { useIsNarrowPage, usePageGutter } from "../shell/pageWidth";
import { useNarrowerThan } from "../shell/useNarrowerThan";
import { ActivityContent } from "./ActivitySection";
import { AboutContent, StorageSettingsContent } from "./InstanceSections";
import { ProfileContent } from "./ProfileSection";
import { SecurityContent } from "./SecuritySection";
import { SETTINGS_SECTIONS, type SettingsSection } from "./sections";

const SECTION_ICONS: Record<SettingsSection, LucideIcon> = {
  profile: User,
  security: Lock,
  activity: Activity,
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
  <SectionFrame title={useT()("settings.profile")}>
    <ProfileContent />
  </SectionFrame>
);

const SecuritySection = () => (
  <SectionFrame title={useT()("settings.security")}>
    <SecurityContent />
  </SectionFrame>
);

const ActivitySection = () => (
  <SectionFrame title={useT()("settings.activity")}>
    <ActivityContent />
  </SectionFrame>
);

const AppearanceSection = () => (
  <SectionFrame title={useT()("settings.appearance")}>
    <VStack gap={4}>
      <AppearanceSwitch />
      <LanguageSwitch />
    </VStack>
  </SectionFrame>
);

const WebDavSection = () => {
  const t = useT();
  return (
    <SectionFrame title={t("settings.webdav")}>
      <CopyField
        label={t("settings.address")}
        value={webdavAddress()}
        copyLabel={t("overview.copyAddress")}
      />
      <VStack gap={2}>
        <Heading level={3}>{t("settings.connecting")}</Heading>
        <Details>
          <MetadataListItem label={t("settings.server")}>
            <Text type="code">{webdavAddress()}</Text>
          </MetadataListItem>
          <MetadataListItem label={t("field.username")}>{t("keys.anyName")}</MetadataListItem>
          <MetadataListItem label={t("field.password")}>{t("settings.anApiKey")}</MetadataListItem>
        </Details>
        <Text type="supporting" color="secondary">
          <RichText text={t("settings.webdavHelp")} tags={CREDENTIALS_LINK} />
        </Text>
      </VStack>
    </SectionFrame>
  );
};

/** The words of a message's <link> tag, as a link to Credentials. */
const CREDENTIALS_LINK = { link: (words: string) => <Link href="/credentials">{words}</Link> };

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
  const t = useT();
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
      setFailure(describeError(t, error));
    } finally {
      setIsExporting(false);
    }
  };
  return (
    <SectionFrame title={t("settings.export")}>
      <Text>{t("export.description")}</Text>
      {failure === undefined ? null : <Banner status="error" title={failure} container="card" />}
      {key === undefined ? null : (
        <VStack gap={4}>
          <Banner
            status="success"
            title={t("export.done")}
            description={t("export.keepKey")}
            container="card"
          />
          <CopyField label={t("register.exportKey")} value={key} copyLabel={t("keys.copyKey")} />
        </VStack>
      )}
      <HStack>
        <Button
          label={key === undefined ? t("export.run") : t("export.again")}
          variant={key === undefined ? "primary" : "secondary"}
          isLoading={isExporting}
          onClick={() => void run()}
        />
      </HStack>
    </SectionFrame>
  );
};

const StorageSection = () => (
  <SectionFrame title={useT()("settings.storage")}>
    <StorageSettingsContent />
  </SectionFrame>
);

const AboutSection = () => (
  <SectionFrame title={useT()("settings.about")}>
    <AboutContent />
  </SectionFrame>
);

const SECTION_CONTENT: Record<SettingsSection, () => ReactNode> = {
  profile: ProfileSection,
  security: SecuritySection,
  activity: ActivitySection,
  appearance: AppearanceSection,
  webdav: WebDavSection,
  storage: StorageSection,
  export: ExportSection,
  about: AboutSection,
};

/** Settings (PRD §8.5): a section list beside the chosen section. */
export const SettingsPage = ({ section }: { section: SettingsSection }) => {
  const t = useT();
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
            label={t("settings.sections")}
          >
            <VStack gap={6}>
              <TitleLine>
                <Heading level={1}>{t("nav.settings")}</Heading>
              </TitleLine>
              <List density="balanced">
                {SETTINGS_SECTIONS.map((item) => (
                  <ListItem
                    key={item.id}
                    label={t(item.label)}
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
                  <Heading level={1}>{t("nav.settings")}</Heading>
                </TitleLine>
                <Selector
                  label={t("settings.section")}
                  value={section}
                  onChange={(next) => void navigate({ href: `/settings?section=${next}` })}
                  options={SETTINGS_SECTIONS.map(({ id, label }) => ({
                    value: id,
                    label: t(label),
                  }))}
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
