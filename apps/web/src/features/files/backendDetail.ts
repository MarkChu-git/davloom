import type { Backend } from "../api/queries";
import type { Translator } from "../i18n/translate";

const durationOf = (t: Translator, ms: number): string =>
  ms < 1000
    ? t("duration.ms", { ms: Math.round(ms) })
    : t("duration.s", {
        s: new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 }).format(ms / 1000),
      });

/**
 * How a backend answered when the list of backends was read, in a sentence that names it:
 * "Main storage answered in 38 ms.", "Main storage gave no answer after 30 s.", or that its saved
 * settings do not open it.
 */
export const backendDetail = (
  t: Translator,
  backend: Pick<Backend, "name" | "available" | "status">,
): string => {
  const { name, status } = backend;
  if (status === undefined) {
    return backend.available
      ? t("backendDetail.answered", { name })
      : t("backendDetail.noAnswer", { name });
  }
  switch (status.state) {
    case "answered":
      return t("backendDetail.answeredIn", { name, duration: durationOf(t, status.ms) });
    case "failed": {
      const duration = durationOf(t, status.ms);
      switch (status.failure) {
        case "unavailable":
          return t("backendDetail.noAnswerAfter", { name, duration });
        case "insufficient-storage":
          return t("backendDetail.fullAfter", { name, duration });
        default:
          return t("backendDetail.failedAfter", { name, failure: status.failure, duration });
      }
    }
    default:
      return t("backendDetail.cannotOpen", { name });
  }
};
