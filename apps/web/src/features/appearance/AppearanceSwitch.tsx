import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { isAppearanceMode, setAppearanceMode, useAppearanceMode } from "./store";

export const AppearanceSwitch = () => (
  <SegmentedControl
    label="Appearance"
    value={useAppearanceMode()}
    onChange={(mode) => {
      if (isAppearanceMode(mode)) {
        setAppearanceMode(mode);
      }
    }}
  >
    <SegmentedControlItem value="light" label="Light" />
    <SegmentedControlItem value="dark" label="Dark" />
    <SegmentedControlItem value="system" label="System" />
  </SegmentedControl>
);
