/** The Dashboard's two languages, as BCP 47 tags: the value of <html lang> and of Intl's locale. */
export type Locale = "en" | "zh-CN";

export const LOCALES: readonly Locale[] = ["en", "zh-CN"];

/** What Settings > Appearance offers: a language, or the browser's own. */
export type LanguageChoice = Locale | "system";

export const LANGUAGE_CHOICES: readonly LanguageChoice[] = ["en", "zh-CN", "system"];

export const isLanguageChoice = (value: string): value is LanguageChoice =>
  LANGUAGE_CHOICES.some((choice) => choice === value);

export const isLocale = (value: unknown): value is Locale => value === "en" || value === "zh-CN";

/** Any Chinese the browser prefers, in any script or region, reads as Simplified Chinese. */
export const localeFromLanguages = (languages: readonly string[]): Locale =>
  languages.some((tag) => /^zh(?:-|$)/i.test(tag)) ? "zh-CN" : "en";

/** The browser's preferred languages, in order, or none where it names none. */
export const browserLanguages = (): readonly string[] => {
  if (typeof navigator === "undefined") {
    return [];
  }
  return navigator.languages.length > 0 ? navigator.languages : [navigator.language];
};

/** The language a choice shows: the one chosen, or for System the browser's. */
export const resolveLocale = (choice: LanguageChoice, languages: readonly string[]): Locale =>
  choice === "system" ? localeFromLanguages(languages) : choice;
