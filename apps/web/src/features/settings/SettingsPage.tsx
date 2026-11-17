import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Heading } from "@astryxdesign/core/Heading";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Layout, LayoutContent, LayoutPanel, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { useNavigate } from "@tanstack/react-router";
import {
  Contrast,
  Download,
  HardDrive,
  Info,
  Link as LinkIcon,
  Lock,
  User,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppearanceSwitch } from "../appearance/AppearanceSwitch";
import { backends, instance } from "../sample-data/data";
import { CopyField } from "../shell/CopyField";
import { buttonLabelled, buttonNamed, refocusIfLost } from "../shell/focus";
import { SETTINGS_SECTIONS, type SettingsSection } from "./sections";
import {
  saveDefaultBackend,
  saveProfile,
  signOutSession,
  useDefaultBackendId,
  useProfile,
  useSessions,
} from "./settingsStore";

const SECTION_ICONS: Record<SettingsSection, LucideIcon> = {
  profile: User,
  security: Lock,
  appearance: Contrast,
  webdav: LinkIcon,
  storage: HardDrive,
  export: Download,
  about: Info,
};

const SectionFrame = ({ title, children }: { title: string; children: ReactNode }) => (
  <VStack gap={5}>
    <Heading level={2}>{title}</Heading>
    {children}
  </VStack>
);

const Row = ({ label, value, action }: { label: string; value: string; action?: ReactNode }) => (
  <VStack gap={0}>
    <HStack hAlign="between" vAlign="center" gap={4} paddingBlock={4}>
      <VStack gap={0.5}>
        <Text weight="semibold">{label}</Text>
        <Text type="supporting" color="secondary">
          {value}
        </Text>
      </VStack>
      {action}
    </HStack>
    <Divider />
  </VStack>
);

/** Text with an @ between two parts and no spaces. The server checks an address properly. */
const EMAIL = /^[^\s@]+@[^\s@]+$/;

const ProfileSection = () => {
  const toast = useToast();
  const saved = useProfile();
  const [name, setName] = useState(saved.name);
  const [email, setEmail] = useState(saved.email);
  const [problems, setProblems] = useState<{ name?: string; email?: string }>({});
  const save = () => {
    const next = {
      name: name.trim() === "" ? "Enter the name Davloom should call you." : undefined,
      email: EMAIL.test(email.trim())
        ? undefined
        : "Enter an email address, such as you@example.com.",
    };
    setProblems(next);
    if (next.name === undefined && next.email === undefined) {
      saveProfile(name.trim(), email.trim());
      toast({ body: "Profile saved." });
    }
  };
  return (
    <SectionFrame title="Profile">
      <FormLayout>
        <TextInput
          label="Display name"
          value={name}
          onChange={(value) => {
            setName(value);
            setProblems((current) => ({ ...current, name: undefined }));
          }}
          onEnter={save}
          autoComplete="name"
          // Spell check would mark most names as mistakes.
          hasSpellCheck={false}
          status={
            problems.name === undefined ? undefined : { type: "error", message: problems.name }
          }
        />
        <TextInput
          label="Email"
          type="email"
          value={email}
          onChange={(value) => {
            setEmail(value);
            setProblems((current) => ({ ...current, email: undefined }));
          }}
          onEnter={save}
          autoComplete="email"
          autoCapitalize="none"
          hasSpellCheck={false}
          status={
            problems.email === undefined ? undefined : { type: "error", message: problems.email }
          }
        />
      </FormLayout>
      <HStack>
        <Button label="Save profile" variant="primary" onClick={save} />
      </HStack>
    </SectionFrame>
  );
};

const SecuritySection = () => {
  const toast = useToast();
  const sessions = useSessions();
  return (
    <SectionFrame title="Sign-in and security">
      <VStack gap={0}>
        <Divider />
        <Row
          label="Password"
          value="Changed 3 months ago"
          action={<Button label="Change password" variant="secondary" size="sm" />}
        />
        <Row
          label="Two-step verification"
          value="Off"
          action={<Button label="Set up" variant="secondary" size="sm" />}
        />
      </VStack>
      <VStack gap={2}>
        <Heading level={3}>Sessions</Heading>
        <VStack gap={0}>
          <Divider />
          {sessions.map((session) => (
            <Row
              key={session.id}
              label={session.device}
              value={session.isCurrent ? `${session.seen}, this browser` : session.seen}
              action={
                session.isCurrent ? undefined : (
                  <Button
                    label={`Sign out ${session.device}`}
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const others = sessions.filter((item) => !item.isCurrent);
                      const index = others.findIndex((item) => item.id === session.id);
                      const rest = others.filter((item) => item.id !== session.id);
                      const next = rest[Math.min(index, rest.length - 1)];
                      signOutSession(session.id);
                      toast({ body: `Signed out ${session.device}.` });
                      // The button goes with its row, so focus moves to the session that took its
                      // place, or to Set up, the control just above the sessions.
                      refocusIfLost(() =>
                        next === undefined
                          ? buttonNamed("Set up")
                          : buttonLabelled(`Sign out ${next.device}`),
                      );
                    }}
                  >
                    Sign out
                  </Button>
                )
              }
            />
          ))}
        </VStack>
      </VStack>
    </SectionFrame>
  );
};

const AppearanceSection = () => (
  <SectionFrame title="Appearance">
    <AppearanceSwitch />
  </SectionFrame>
);

const WebDavSection = () => (
  <SectionFrame title="WebDAV">
    <CopyField label="Address" value={instance.webdavUrl} copyLabel="Copy address" />
  </SectionFrame>
);

const StorageSection = () => {
  const toast = useToast();
  const saved = useDefaultBackendId();
  const [defaultBackendId, setDefaultBackendId] = useState(saved);
  return (
    <SectionFrame title="Storage">
      <Selector
        label="Default backend for new mounts"
        value={defaultBackendId}
        onChange={setDefaultBackendId}
        options={backends.map((backend) => ({ value: backend.id, label: backend.name }))}
        width={320}
      />
      <HStack>
        <Button
          label="Save storage settings"
          variant="primary"
          onClick={() => {
            saveDefaultBackend(defaultBackendId);
            toast({ body: "Storage settings saved." });
          }}
        />
      </HStack>
    </SectionFrame>
  );
};

const ExportSection = () => {
  const toast = useToast();
  const [isExporting, setIsExporting] = useState(false);
  // Leaving the section ends the export, so its answer never shows on another page.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <SectionFrame title="Data export">
      <HStack>
        <Button
          label="Export"
          variant="primary"
          icon={<Icon icon={Download} size="sm" />}
          isLoading={isExporting}
          onClick={() => {
            setIsExporting(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              setIsExporting(false);
              toast({ body: "Exported davloom-export-2026-11-16.json." });
            }, 900);
          }}
        />
      </HStack>
    </SectionFrame>
  );
};

const AboutSection = () => (
  <SectionFrame title="About this instance">
    <MetadataList>
      <MetadataListItem label="Name">{instance.name}</MetadataListItem>
      <MetadataListItem label="Version">{instance.version}</MetadataListItem>
      <MetadataListItem label="Commit">
        <Text type="code">{instance.commit}</Text>
      </MetadataListItem>
      <MetadataListItem label="Deployment">{instance.deployment}</MetadataListItem>
      <MetadataListItem label="Runtime">{instance.runtime}</MetadataListItem>
      <MetadataListItem label="Database">{instance.database}</MetadataListItem>
      <MetadataListItem label="Region">{instance.region}</MetadataListItem>
      <MetadataListItem label="WebDAV address">{instance.webdavUrl}</MetadataListItem>
    </MetadataList>
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
  // Responsive contract: above 1024px the sections are a 280px list beside the chosen one. At
  // 1024px and below the side navigation already takes one region, so the list becomes a
  // selector above the section, which keeps the remaining width.
  const isNarrow = useMediaQuery("(width <= 1024px)");

  if (isNarrow) {
    return (
      <Layout
        height="fill"
        content={
          <LayoutContent padding={4}>
            <VStack gap={6}>
              <VStack gap={4}>
                <Heading level={1}>Settings</Heading>
                <Selector
                  label="Section"
                  value={section}
                  onChange={(next) => void navigate({ href: `/settings?section=${next}` })}
                  options={SETTINGS_SECTIONS.map(({ id, label }) => ({ value: id, label }))}
                />
              </VStack>
              <Content />
            </VStack>
          </LayoutContent>
        }
      />
    );
  }

  return (
    <Layout
      height="fill"
      start={
        <LayoutPanel hasDivider padding={4} width={280} role="navigation" label="Settings sections">
          <VStack gap={4}>
            <Heading level={1}>Settings</Heading>
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
      }
      content={
        <LayoutContent padding={6}>
          <VStack gap={6} maxWidth={640}>
            <Content />
          </VStack>
        </LayoutContent>
      }
    />
  );
};
