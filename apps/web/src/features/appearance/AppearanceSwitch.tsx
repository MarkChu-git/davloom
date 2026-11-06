import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { setAppearanceMode, useAppearanceMode, type AppearanceMode } from "./store";

export const AppearanceSwitch = () => (
  <SegmentedControl
    label="Appearance"
    value={useAppearanceMode()}
    onChange={(mode) => setAppearanceMode(mode as AppearanceMode)}
  >
    <SegmentedControlItem value="light" label="Light" />
    <SegmentedControlItem value="dark" label="Dark" />
    <SegmentedControlItem value="system" label="System" />
  </SegmentedControl>
);
