export const LANGUAGE_STORAGE_KEY = "davloom-language";

/** A page's title and description in one language. */
export interface PageText {
  title: string;
  description: string;
}

/**
 * Runs in <head> before <body> is parsed, so the first paint shows the stored or the browser's
 * language. Every page's HTML holds its frame in both languages, and the stylesheet shows the one
 * that matches `lang` on <html> (LocaleFrames in I18nProvider.tsx). For Chinese it also puts the
 * page's Chinese title and description in the head. The browser runs this function's source on
 * its own, so it refers to nothing outside its body but the browser's globals.
 */
export function applyLanguage(key: string, chinese: PageText | null): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(key);
  } catch {
    // Without storage the page follows the browser's languages.
  }
  const languages =
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language || ""];
  const locale =
    stored === "en" || stored === "zh-CN"
      ? stored
      : languages.some((tag) => /^zh(?:-|$)/i.test(tag))
        ? "zh-CN"
        : "en";
  document.documentElement.lang = locale;
  if (locale === "zh-CN" && chinese !== null) {
    document.title = chinese.title;
    const description = document.querySelector('meta[name="description"]');
    if (description !== null) {
      description.setAttribute("content", chinese.description);
    }
  }
}

/** The inline script for a page whose Chinese title and description are `chinese`. */
export const languageScript = (chinese: PageText | null): string =>
  `try{(${applyLanguage.toString()})(${JSON.stringify(LANGUAGE_STORAGE_KEY)},${JSON.stringify(chinese)})}catch(e){}`;
