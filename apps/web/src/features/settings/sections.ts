/**
 * The Settings sections in list order; `?section=` names one, and `label` is the key of its name in
 * the dictionary. This module imports nothing, because the route's search validation loads it with
 * the app's entry chunk, not with the page.
 */
export const SETTINGS_SECTIONS = [
  { id: "profile", label: "settings.profile" },
  { id: "security", label: "settings.security" },
  { id: "activity", label: "settings.activity" },
  { id: "appearance", label: "settings.appearance" },
  { id: "webdav", label: "settings.webdav" },
  { id: "storage", label: "settings.storage" },
  { id: "export", label: "settings.export" },
  { id: "about", label: "settings.about" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

export const isSettingsSection = (value: unknown): value is SettingsSection =>
  SETTINGS_SECTIONS.some((section) => section.id === value);
