/**
 * The Settings sections in list order; `?section=` names one. This module imports nothing, because
 * the route's search validation loads it with the app's entry chunk, not with the page.
 */
export const SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Sign-in and security" },
  { id: "activity", label: "Activity" },
  { id: "appearance", label: "Appearance" },
  { id: "webdav", label: "WebDAV" },
  { id: "storage", label: "Storage" },
  { id: "export", label: "Data export" },
  { id: "about", label: "About this instance" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

export const isSettingsSection = (value: unknown): value is SettingsSection =>
  SETTINGS_SECTIONS.some((section) => section.id === value);
