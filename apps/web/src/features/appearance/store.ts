import { Store, useStore } from "@tanstack/react-store";
import { APPEARANCE_STORAGE_KEY } from "./script";

export type AppearanceMode = "light" | "dark" | "system";

const APPEARANCE_MODES: readonly AppearanceMode[] = ["light", "dark", "system"];

export const isAppearanceMode = (value: string): value is AppearanceMode =>
  APPEARANCE_MODES.some((mode) => mode === value);

const readStoredMode = (): AppearanceMode => {
  try {
    const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
};

const appearanceStore = new Store<AppearanceMode>(readStoredMode());

/**
 * Keeps `color-scheme` on <html> in step with the mode, as the first-paint script sets it. System
 * clears it, so the stylesheet's "light dark" applies.
 */
const syncColorScheme = (mode: AppearanceMode): void => {
  document.documentElement.style.colorScheme = mode === "system" ? "" : mode;
};

// A choice made in another tab applies here too. The prerender has no window.
if (typeof window !== "undefined") {
  // The first-paint script wrote the scheme it found, and another tab may have changed the mode
  // while the bundles loaded, so start the root from the mode the store read.
  syncColorScheme(appearanceStore.state);
  window.addEventListener("storage", (event) => {
    if (event.key === APPEARANCE_STORAGE_KEY || event.key === null) {
      const mode = readStoredMode();
      appearanceStore.setState(() => mode);
      syncColorScheme(mode);
    }
  });
}

export const useAppearanceMode = (): AppearanceMode => useStore(appearanceStore, (mode) => mode);

export const setAppearanceMode = (mode: AppearanceMode): void => {
  appearanceStore.setState(() => mode);
  syncColorScheme(mode);
  try {
    if (mode === "system") {
      localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    } else {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, mode);
    }
  } catch {
    // Without storage the choice still applies until the page closes.
  }
};
