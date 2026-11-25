import type { Backend } from "../api/queries";
import type { Translator } from "../i18n/translate";
import type { Tone } from "../shell/StatusLabel";

/** Whether a backend answered when the list of backends was read. */
export const backendStatus = (
  t: Translator,
  backend: Pick<Backend, "available">,
): { tone: Tone; label: string } =>
  backend.available
    ? { tone: "success", label: t("backend.available") }
    : { tone: "error", label: t("backend.unavailable") };

/**
 * What the side navigation says on every page while a backend does not answer, such as
 * "1 backend unavailable", and the glyph it shows; absent while every backend answers.
 */
export const storageAlert = (
  t: Translator,
  backends: readonly Pick<Backend, "available">[] | undefined,
): { tone: Tone; text: string } | undefined => {
  const count = (backends ?? []).filter((backend) => !backend.available).length;
  return count === 0
    ? undefined
    : { tone: "error", text: t("backend.unavailableCount", { count }) };
};
