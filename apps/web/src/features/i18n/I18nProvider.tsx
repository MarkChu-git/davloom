import { VStack } from "@astryxdesign/core/Layout";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { I18nProvider } from "./context";
import { LOCALES } from "./locale";

// The provider and useT live in ./context, which holds no StyleX, so code that runs without the
// StyleX compiler, such as the unit tests, can use them.
export { I18nProvider, useT } from "./context";

// In the module that the browser's build imports for I18nProvider, rather than one of its own: the
// browser's build leaves out a module that only the prerender renders, and the stylesheet, which
// the browser's build writes, with it.
const styles = stylex.create({
  en: {
    display: { default: "contents", ":lang(zh)": "none" },
  },
  "zh-CN": {
    display: { default: "none", ":lang(zh)": "contents" },
  },
});

/**
 * The prerendered page in each language. The prerender cannot know which language the browser
 * shows, so the HTML holds the page once in each, and the stylesheet shows the one that matches
 * `lang` on <html>, which the first-paint script sets before <body> is parsed (script.ts). A
 * Chinese reader sees Chinese from the first paint, with no English shown first.
 */
export const LocaleFrames = ({ children }: { children: ReactNode }) =>
  LOCALES.map((locale) => (
    <VStack key={locale} xstyle={styles[locale]} data-frame-locale={locale}>
      <I18nProvider locale={locale}>{children}</I18nProvider>
    </VStack>
  ));
