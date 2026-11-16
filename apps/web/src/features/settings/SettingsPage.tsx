import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Heading } from "@astryxdesign/core/Heading";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Layout, LayoutContent, LayoutPanel, VStack } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
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
import { useAppearanceMode } from "../appearance/store";
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

const SectionFrame = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) => (
  <VStack gap={5}>
    <VStack gap={1}>
      <Heading level={2}>{title}</Heading>
      <Text type="supporting" color="secondary">
        {description}
      </Text>
    </VStack>
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
    <SectionFrame
      title="Profile"
      description="How Davloom addresses you, and where it sends account mail."
    >
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
    <SectionFrame
      title="Sign-in and security"
      description="How you sign in to the Dashboard. WebDAV clients sign in with keys from Credentials."
    >
      <VStack gap={0}>
        <Divider />
        <Row
          label="Password"
          value="Changed 3 months ago"
          action={
            <Button
              label="Change password"
              variant="secondary"
              size="sm"
              onClick={() => toast({ body: "Password change opens here." })}
            />
          }
        />
        <Row
          label="Two-step verification"
          value="Off"
          action={
            <Button
              label="Set up"
              variant="secondary"
              size="sm"
              onClick={() => toast({ body: "Two-step setup opens here." })}
            />
          }
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

const AppearanceSection = () => {
  const isSystemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const mode = useAppearanceMode();
  return (
    <SectionFrame
      title="Appearance"
      description="Davloom is black, white and grays. Choose which way round, or follow the system."
    >
      <AppearanceSwitch />
      <Text type="supporting" color="secondary">
        {mode === "system"
          ? `Following the system, which is ${isSystemDark ? "dark" : "light"} right now.`
          : `Always ${mode}, whatever the system uses. This browser remembers the choice.`}
      </Text>
    </SectionFrame>
  );
};

const WebDavSection = () => (
  <SectionFrame title="WebDAV" description="How clients reach your files.">
    <CopyField label="Address" value={instance.webdavUrl} copyLabel="Copy address" />
    <Text type="supporting" color="secondary">
      Clients connect over HTTPS and sign in with a key from{" "}
      <Link href="/credentials" hasUnderline>
        Credentials
      </Link>
      , not with your account password.
    </Text>
  </SectionFrame>
);

const StorageSection = () => {
  const toast = useToast();
  const saved = useDefaultBackendId();
  const [defaultBackendId, setDefaultBackendId] = useState(saved);
  return (
    <SectionFrame title="Storage" description="Defaults for storage you add later.">
      <Selector
        label="Default backend for new mounts"
        description="Add a mount on Storage & Mounts and this backend is chosen for it."
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
    <SectionFrame
      title="Data export"
      description="Saves this instance's data to a file. Keys and other secrets are never exported in plaintext."
    >
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
  <SectionFrame title="About this instance" description="What this Davloom runs on.">
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
