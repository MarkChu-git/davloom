import { Store, useStore } from "@tanstack/react-store";
import { backends, profile } from "../sample-data/data";

export interface Session {
  id: string;
  device: string;
  seen: string;
  isCurrent: boolean;
}

interface Settings {
  name: string;
  email: string;
  sessions: Session[];
  /** The backend a new mount starts with on Storage & Mounts. */
  defaultBackendId: string;
}

/** The sample settings, kept for the whole visit like every other change the prototype makes. */
const settingsStore = new Store<Settings>({
  name: profile.name,
  email: profile.email,
  sessions: [
    { id: "s1", device: "Safari on macOS", seen: "Active now", isCurrent: true },
    { id: "s2", device: "Firefox on Windows", seen: "Last active 2 days ago", isCurrent: false },
  ],
  defaultBackendId: backends[0]?.id ?? "",
});

export const useProfile = (): { name: string; email: string } => ({
  name: useStore(settingsStore, (settings) => settings.name),
  email: useStore(settingsStore, (settings) => settings.email),
});

export const useSessions = (): Session[] =>
  useStore(settingsStore, (settings) => settings.sessions);

export const useDefaultBackendId = (): string =>
  useStore(settingsStore, (settings) => settings.defaultBackendId);

export const saveProfile = (name: string, email: string): void => {
  settingsStore.setState((settings) => ({ ...settings, name, email }));
};

export const signOutSession = (id: string): void => {
  settingsStore.setState((settings) => ({
    ...settings,
    sessions: settings.sessions.filter((session) => session.id !== id),
  }));
};

export const saveDefaultBackend = (id: string): void => {
  settingsStore.setState((settings) => ({ ...settings, defaultBackendId: id }));
};
