import { InternationalizationProvider } from "@astryxdesign/core/i18n";
import astryxZhCN from "@astryxdesign/core/locales/zh-CN.generated.js";
import { createContext, use, type ReactNode } from "react";
import type { Locale } from "./locale";
import { ASTRYX_ZH_CN_EXTRA } from "./messages/astryx-zh-CN";
import { translator, type Translator } from "./translate";

const LocaleContext = createContext<Locale>("en");

/** Astryx's own words, such as a dialog's Close button, in Chinese; English ships with Astryx. */
const ASTRYX_MESSAGES = { "zh-CN": astryxZhCN };

/** The words Astryx's Chinese catalog leaves out. */
const ASTRYX_OVERRIDES = { "zh-CN": ASTRYX_ZH_CN_EXTRA };

/** Davloom's words and Astryx's in `locale`, for everything inside. */
export const I18nProvider = ({ locale, children }: { locale: Locale; children: ReactNode }) => (
  <LocaleContext value={locale}>
    <InternationalizationProvider
      locale={locale}
      messages={ASTRYX_MESSAGES}
      overrides={ASTRYX_OVERRIDES}
    >
      {children}
    </InternationalizationProvider>
  </LocaleContext>
);

/** The words and formats of the language the page shows; English outside any provider. */
export const useT = (): Translator => translator(use(LocaleContext));
