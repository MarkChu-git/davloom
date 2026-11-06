import { Store, useStore } from "@tanstack/react-store";
import { APPEARANCE_STORAGE_KEY } from "./script";

export type AppearanceMode = "light" | "dark" | "system";

const readStoredMode = (): AppearanceMode => {
  try {
    const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
};

const appearanceStore = new Store<AppearanceMode>(readStoredMode());

export const useAppearanceMode = (): AppearanceMode => useStore(appearanceStore, (mode) => mode);

export const setAppearanceMode = (mode: AppearanceMode): void => {
  appearanceStore.setState(() => mode);
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
