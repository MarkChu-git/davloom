import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { useT } from "../i18n/I18nProvider";
import { isAppearanceMode, setAppearanceMode, useAppearanceMode } from "./store";

export const AppearanceSwitch = () => {
  const t = useT();
  return (
    <SegmentedControl
      label={t("appearance.label")}
      value={useAppearanceMode()}
      onChange={(mode) => {
        if (isAppearanceMode(mode)) {
          setAppearanceMode(mode);
        }
      }}
    >
      <SegmentedControlItem value="light" label={t("appearance.light")} />
      <SegmentedControlItem value="dark" label={t("appearance.dark")} />
      <SegmentedControlItem value="system" label={t("appearance.system")} />
    </SegmentedControl>
  );
};
