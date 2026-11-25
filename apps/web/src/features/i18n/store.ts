import { Store } from "@tanstack/react-store";
import { useSyncExternalStore } from "react";
import {
  browserLanguages,
  isLocale,
  resolveLocale,
  type LanguageChoice,
  type Locale,
} from "./locale";
import { LANGUAGE_STORAGE_KEY } from "./script";

const readStoredChoice = (): LanguageChoice => {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLocale(stored) ? stored : "system";
  } catch {
    return "system";
  }
};

interface LanguageState {
  choice: LanguageChoice;
  locale: Locale;
}

const stateFor = (choice: LanguageChoice): LanguageState => ({
  choice,
  locale: resolveLocale(choice, browserLanguages()),
});

const languageStore = new Store<LanguageState>(
  typeof window === "undefined" ? { choice: "system", locale: "en" } : stateFor(readStoredChoice()),
);

/** Keeps `lang` on <html> in step with the language, as the first-paint script sets it. */
const syncLang = (locale: Locale): void => {
  document.documentElement.lang = locale;
};

const apply = (choice: LanguageChoice): void => {
  const next = stateFor(choice);
  languageStore.setState(() => next);
  syncLang(next.locale);
};

// A choice made in another tab applies here too, and System follows the browser's languages when
// they change. The prerender has no window.
if (typeof window !== "undefined") {
  syncLang(languageStore.state.locale);
  window.addEventListener("storage", (event) => {
    if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) {
      apply(readStoredChoice());
    }
  });
  window.addEventListener("languagechange", () => apply(languageStore.state.choice));
}

const subscribe = (onChange: () => void) => languageStore.subscribe(onChange).unsubscribe;

/** The language chosen in Settings > Appearance. The prerender, which has no storage, says System. */
export const useLanguageChoice = (): LanguageChoice =>
  useSyncExternalStore(
    subscribe,
    () => languageStore.state.choice,
    () => "system",
  );

/** The language the Dashboard shows. The prerender draws English, and the Chinese frame beside it. */
export const useActiveLocale = (): Locale =>
  useSyncExternalStore(
    subscribe,
    () => languageStore.state.locale,
    () => "en",
  );

export const setLanguageChoice = (choice: LanguageChoice): void => {
  apply(choice);
  try {
    if (choice === "system") {
      localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    } else {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, choice);
    }
  } catch {
    // Without storage the choice still applies until the page closes.
  }
};
