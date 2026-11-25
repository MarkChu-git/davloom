import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { useT } from "./I18nProvider";
import { isLanguageChoice } from "./locale";
import { setLanguageChoice, useLanguageChoice } from "./store";

/**
 * The Dashboard's language, beside the appearance mode in Settings > Appearance. Each language
 * names itself in its own words, so a reader finds theirs whichever language the page shows.
 */
export const LanguageSwitch = () => {
  const t = useT();
  return (
    <SegmentedControl
      label={t("language.label")}
      value={useLanguageChoice()}
      onChange={(choice) => {
        if (isLanguageChoice(choice)) {
          setLanguageChoice(choice);
        }
      }}
    >
      <SegmentedControlItem value="en" label="English" />
      <SegmentedControlItem value="zh-CN" label="简体中文" />
      <SegmentedControlItem value="system" label={t("language.system")} />
    </SegmentedControl>
  );
};
