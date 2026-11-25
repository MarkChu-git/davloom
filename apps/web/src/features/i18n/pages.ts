import type { Locale } from "./locale";
import type { PageText } from "./script";
import { translator } from "./translate";

/** The pages that name themselves in the browser's tab, by the `page` of their route's staticData. */
export type PageId =
  | "overview"
  | "files"
  | "credentials"
  | "storage"
  | "settings"
  | "signIn"
  | "register";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    page?: PageId;
  }
}

/** A page's title and description in `locale`; Davloom's own for a page without either. */
export const pageText = (page: PageId | undefined, locale: Locale): PageText => {
  const t = translator(locale);
  switch (page) {
    case "overview":
      return { title: t("page.overview.title"), description: t("page.overview.description") };
    case "files":
      return { title: t("page.files.title"), description: t("page.files.description") };
    case "credentials":
      return {
        title: t("page.credentials.title"),
        description: t("page.credentials.description"),
      };
    case "storage":
      return { title: t("page.storage.title"), description: t("page.storage.description") };
    case "settings":
      return { title: t("page.settings.title"), description: t("page.settings.description") };
    case "signIn":
      return { title: t("page.signIn.title"), description: t("page.signIn.description") };
    case "register":
      return { title: t("page.register.title"), description: t("page.register.description") };
    default:
      return { title: t("page.default.title"), description: t("page.default.description") };
  }
};
