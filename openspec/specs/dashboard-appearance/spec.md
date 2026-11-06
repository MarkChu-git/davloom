# dashboard-appearance Specification

## Purpose
This spec defines the theme and appearance-mode behavior of the Dashboard, so that design system components and Davloom's own components look consistent in the production build.

## Requirements

### Requirement: Appearance mode
The Dashboard SHALL support three appearance modes (Light, Dark and System) and use System by default. A user's choice MUST persist after a reload.

#### Scenario: Switching the mode
- **WHEN** a user switches the appearance to Dark
- **THEN** the page immediately uses the dark theme

#### Scenario: Choice kept after reload
- **WHEN** a user selects Dark and then reloads the page
- **THEN** the page is still Dark, and it is already dark on the first paint

#### Scenario: Following the system
- **WHEN** the appearance mode is System and the operating system color scheme changes from light to dark
- **THEN** the page switches to the dark theme without a reload

### Requirement: Design system and Davloom's own styles coexist
In the production build, the styles of design system components and the styles of Davloom's own components MUST both take effect, and each set of styles MUST NOT override the other.

#### Scenario: Computed styles on the example page
- **WHEN** Playwright opens the example page of the production build
- **THEN** the computed styles of design system components come from the theme tokens, those of Davloom's own components come from Davloom's own styles, and neither is a browser default

#### Scenario: Both change with the appearance
- **WHEN** the appearance switches from Light to Dark
- **THEN** design system components and Davloom's own components both use the values of the dark tokens

### Requirement: Theme defined through tokens
The Davloom Theme MUST be defined through the design system's theme mechanism and exportable design tokens, and MUST NOT modify dependency source.

#### Scenario: Changing the brand color token
- **WHEN** the brand color token of the Davloom Theme is changed and the build is run again
- **THEN** the brand color changes in both design system components and Davloom's own components, and the dependency directory has no changes
