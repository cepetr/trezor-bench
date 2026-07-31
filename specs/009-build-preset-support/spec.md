# Feature Specification: Build Preset Support

**Feature Branch**: `009-build-preset-support`
**Created**: 2026-07-30
**Status**: Draft
**Input**: User description: "Support xtask build presets in the Configuration view, build-option defaults, and Build, Clippy, and Check command execution."

**File Reference Rule**: Use workspace-relative paths for any repository file references written into this specification.

## Product Documentation Alignment *(mandatory)*

- **Source Documents**: `specs/product-spec.md`, `specs/glossary.md`, and the upstream `xtask` preset documentation at `https://github.com/trezor/trezor-firmware/blob/cepetr/xtask-build-presets/docs/core/build/xtask.md`
- **Affected Product Areas**: `Core Capabilities` (`Build Context Management`, `Build Option Management`), `Build Context Display Conventions`, `Status Bar`, `Startup And Refresh Behavior`, `Persistence And Defaults`, `Command Surface` (`Build`, `Clippy And Check`), and `Manifest Structure` in `specs/product-spec.md`; configuration, build-option, and task terminology in `specs/glossary.md`
- **Scope Guard**: This feature adds preset discovery and selection, preset-relative build-option behavior, and preset-aware argument generation for Build, Clippy, and Check. It does not change Clean, Flash to Device, Upload to Device, Start Debugging, artifact resolution, IntelliSense, excluded-file visibility, status-bar content, command names, or task labels.
- **Terminology Guard**: Existing terms `active build context`, `Configuration view`, `Build Selection`, `Build Options`, `build option`, `checkbox option`, `multistate option`, `option state`, `xtask`, `Build`, `Clippy`, and `Check` MUST retain their glossary meanings. The glossary definition of `active configuration` MUST be extended to include the selected preset id in its persisted workspace-state record. The glossary MUST add and consistently define `preset`, `active preset`, `default preset`, `preset-effective value`, and `build-option override`. The active preset remains separate from the active build context, which is still the selected model, target, and component.
- **Critical Product Details**:
  - `Preset` appears as a fourth selector directly below `Component` in `Build Selection`, and follows the existing selector interaction conventions.
  - The tree always shows a synthetic `Default` choice, including when neither preset file defines any `[[defaults]]` fragments. It represents defaults-only behavior rather than a named preset and never emits a preset argument.
  - The selected preset id is retained in the same workspace-scoped active-configuration record and follows the same save, restore, normalization, and refresh lifecycle as the selected model, component/project, and target/emulator, while remaining excluded from build-context display text.
  - Available named presets and preset-effective values come from both the shared `presets.toml` file and optional `user-presets.toml` file.
  - An absent `presets.toml` contributes no shared fragments and is treated exactly like an empty file; it is not an error.
  - A malformed `presets.toml`, or one containing validation errors, replaces the preset choices under `Preset` with an error message and records the details in log output.
  - Effective values follow upstream precedence: shared defaults, user defaults, shared selected-preset fragments, user selected-preset fragments, then explicit build-option overrides.
  - Matching preset fragments retain file order; later matching fragments replace earlier values for the same option, while omitted options retain their prior effective values.
  - Preset fragment applicability is evaluated against the selected model, component, and emulator state represented by the active target.
  - The manifest remains the source of truth for which build options the extension supports and how they are displayed, but multistate options no longer require manifest-authored defaults.
  - Build-option controls display preset-effective values when no explicit override exists and visually emphasize only values that differ from the selected preset's calculated effective values.
  - Build, Clippy, and Check append `-p <preset-name>` only for a non-default active preset and emit build-option arguments only for explicit overrides that differ from preset-effective values.
  - The shared build-context display remains `{model-name} | {target-display} | {component-name}`. The active preset MUST NOT appear in the status bar, task labels, or command names.
  - `specs/product-spec.md` and `specs/glossary.md` MUST be updated during implementation so consolidated documentation does not retain manifest-default or three-selector-only behavior that conflicts with this feature.

## Clarifications

### Session 2026-07-30

- Q: How should the extension behave when `user-presets.toml` is malformed, unreadable, or contains validation errors? → A: Replace preset choices with an error message, log details, and block Build, Clippy, and Check until fixed.
- Q: What should happen to the saved preset selection while either preset file is invalid? → A: Preserve the saved preset ID; restore it when valid data returns if still available, otherwise normalize to `default`.
- Q: How do TOML defaults relate to the `Default` tree choice and command arguments? → A: TOML uses `[[defaults]]`; the tree shows `Default`; matching defaults fragments are applied before any named preset, and `Default` emits no `-p`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select an Available Preset (Priority: P1)

As a firmware developer, I can inspect and select a build preset in the Configuration view so that the extension uses the same preset choices as `xtask` without requiring me to remember command-line syntax.

**Why this priority**: Preset selection is the entry point for every other behavior in this feature and provides immediate user value on its own.

**Independent Test**: Open a supported workspace containing shared and user preset definitions, expand `Preset`, select a named preset, and verify that the selected row and selector description update while existing build-context labels remain unchanged.

**Acceptance Scenarios**:

1. **Given** shared presets and user presets define distinct names, **When** the user expands `Preset`, **Then** every preset available for the active model, target, and component is listed once and the synthetic `Default` choice is included.
2. **Given** neither preset file defines any `[[defaults]]` fragments, **When** the user expands `Preset`, **Then** `Default` is still shown as a selectable choice.
3. **Given** a named preset is available, **When** the user selects it, **Then** the `Preset` selector description and active-choice marker update immediately and its id is saved and restored in the same workspace-scoped active-configuration record as the selected model, component/project, and target/emulator.
4. **Given** a saved named preset is no longer available after preset inputs or the active build context change, **When** preset state is refreshed, **Then** the active preset normalizes to `default` and the selector shows that value.
5. **Given** the active preset changes, **When** status-bar text, task labels, and command names are refreshed, **Then** they continue to identify only the selected model, target, and component and contain no preset name.
6. **Given** either preset file becomes invalid while a named preset is saved, **When** valid preset data is later restored, **Then** the saved preset is restored if available and is normalized to `default` only if it is unavailable in the restored data.

---

### User Story 2 - Adjust Preset-Relative Options (Priority: P1)

As a firmware developer, I see the selected preset's effective build-option values and can change individual options as explicit modifiers, so I only override values that differ from the preset.

**Why this priority**: Accurate preset-relative option state prevents redundant or contradictory arguments and makes preset behavior understandable before a workflow runs.

**Independent Test**: Select presets with different shared and user fragments, inspect checkbox and multistate controls, change selected options, and verify that displayed values, visual emphasis, and retained overrides are all relative to the active preset.

**Acceptance Scenarios**:

1. **Given** matching shared and user default and named-preset fragments set the same option more than once, **When** effective values are calculated, **Then** the value from the highest-precedence, latest matching fragment is displayed.
2. **Given** a build option has no explicit user override, **When** the active preset changes, **Then** its displayed value changes to the value calculated for the newly active preset.
3. **Given** the user selects a value different from the preset-effective value, **When** Build Options refreshes, **Then** that value is retained as a build-option override and is visually emphasized.
4. **Given** a saved override equals the newly calculated preset-effective value, **When** the preset inputs change, **Then** the option is no longer visually emphasized and does not produce an explicit option argument.
5. **Given** a multistate option's states have no manifest-authored default, **When** no explicit override exists, **Then** the selected state is inferred from the calculated preset-effective value.
6. **Given** one or more options carry explicit overrides, **When** the active preset changes, or the active build context changes which preset fragments apply, **Then** the overrides on options the new preset and context calculate differently are discarded and those options show their new calculated value unemphasized, while the overrides on options calculated identically remain in place and stay emphasized.

---

### User Story 3 - Run Preset-Aware Workflows (Priority: P1)

As a firmware developer, I can run Build, Clippy, or Check and have the extension pass the active preset plus only meaningful option overrides, so the launched workflow matches the Configuration view without redundant arguments.

**Why this priority**: Selection and display are useful only if the workflows consume the same effective configuration reliably.

**Independent Test**: Run Build, Clippy, and Check with the default preset, a named preset, no overrides, and differing overrides; inspect each launched command and verify its preset and option arguments.

**Acceptance Scenarios**:

1. **Given** `Default` is active and no build-option overrides differ from values calculated from matching `[[defaults]]` fragments, **When** Build, Clippy, or Check is launched, **Then** the command contains neither `-p` nor explicit build-option arguments.
2. **Given** a non-default named preset is active, **When** Build, Clippy, or Check is launched, **Then** the command includes exactly one `-p <selected-preset>` pair.
3. **Given** selected build-option values include both values equal to and different from preset-effective values, **When** Build, Clippy, or Check is launched, **Then** arguments are emitted only for the differing values.
4. **Given** user preset fragments override shared preset fragments, **When** Build, Clippy, or Check is launched, **Then** override comparison uses the user-adjusted preset-effective values.
5. **Given** any preset is active, **When** Clean, Flash to Device, Upload to Device, or Start Debugging is invoked, **Then** that workflow's pre-existing command behavior is unchanged by the preset selection.
6. **Given** matching `[[defaults]]` fragments exist in either preset file and the user selects `Default`, **When** Build, Clippy, or Check is launched, **Then** xtask applies those fragments automatically and the extension omits `-p` rather than emitting `-p default` or another preset argument.

### Edge Cases

- `user-presets.toml` is absent: shared presets remain available and no warning is shown for the intentionally optional file.
- `user-presets.toml` is malformed, unreadable, or contains validation errors: stale preset and preset-effective state is not used; the saved preset id is preserved without being resolved, an error message replaces the choices under `Preset`, details are logged, and Build, Clippy, and Check are blocked until the file is fixed.
- `presets.toml` is absent: it contributes no shared fragments and behaves exactly like an empty file; `default` and any presets contributed by `user-presets.toml` remain available, with no missing-file warning.
- `presets.toml` is malformed or contains validation errors: stale preset and preset-effective state is not used; the saved preset id is preserved without being resolved, an error message appears under the `Preset` selector in place of the preset choices, details are logged, and preset-aware Build, Clippy, and Check execution is blocked.
- The two files define the same named preset: the UI lists the name once and effective-value calculation applies shared fragments before user fragments.
- A file contains multiple fragments for one preset: every matching fragment is applied in declaration order, and nonmatching fragments contribute no values.
- A fragment omits `when`: it matches every active model, component, and target.
- A fragment's `when` contains multiple fields or values: fields are combined with AND and values within a field are combined with OR.
- A named preset has no matching fragment for the active build context: it is not offered as available for that context; if it was previously selected, selection normalization chooses `default`.
- Neither defaults nor the selected named preset supplies a supported option value: checkbox options use the upstream implicit disabled value; a multistate option without a resolvable value is shown as unavailable for override and produces no argument until a valid value can be resolved.
- A calculated preset value is not represented by the manifest-defined states for a multistate option: the option reports an actionable configuration mismatch and does not emit a guessed value.
- A preset file changes while the Configuration view is open: available presets, the active preset, preset-effective option values, visual emphasis, and Build/Clippy/Check readiness refresh without requiring a window reload.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The extension MUST add a `Preset` selector directly below `Component` in the `Build Selection` section of the Configuration view.
- **FR-002**: The `Preset` selector MUST use the same expand, collapse, active-choice, loading, and refresh interaction conventions as the existing build-selection selectors.
- **FR-003**: The extension MUST discover available named presets from both the shared `presets.toml` input and the optional `user-presets.toml` input, list duplicate names once, and preserve first declaration order across the shared file followed by the user file.
- **FR-004**: The extension MUST always show a synthetic tree choice labeled `Default`, even when neither file contains a `[[defaults]]` fragment; selecting it MUST represent selection of no named preset and MUST NOT imply that a preset named `default` exists.
- **FR-005**: The extension MUST recognize `[[defaults]]` fragments in both `presets.toml` and `user-presets.toml`, automatically apply matching fragments as base option inputs before any selected named-preset fragments, and MUST NOT expose  `defaults` as a named preset choice.
- **FR-006**: The extension MUST show a named preset as available only when at least one fragment with that name applies to the active model, component, and target-derived emulator state.
- **FR-007**: Users MUST be able to select one active preset, and the extension MUST retain its id in the same workspace-scoped active-configuration record and apply the same persistence, restoration, normalization, and refresh lifecycle used for the selected model, component/project, and target/emulator, while keeping the preset separate from the active build context.
- **FR-008**: When preset data is valid, the extension MUST restore a saved active preset when it remains available and MUST normalize a missing or unavailable saved preset to the synthetic `Default` choice.
- **FR-009**: The extension MUST refresh available presets and normalize the active preset when either preset input, the active model, the active target, or the active component changes.
- **FR-010**: The extension MUST calculate preset-effective build-option values in this precedence order: shared matching `defaults` fragments, user matching `defaults` fragments, shared matching active named-preset fragments, then user matching active named-preset fragments.
- **FR-011**: Within each precedence layer, the extension MUST evaluate fragments in authored order, apply only matching fragments, replace earlier values when later matching fragments set the same option, and retain prior values for options a fragment omits.
- **FR-012**: Preset fragment matching MUST combine authored filter fields with AND, values within one field with OR, and treat an omitted filter as matching all active build contexts.
- **FR-013**: Build Options MUST display the calculated preset-effective value for each supported available option that has no explicit build-option override.
- **FR-014**: Users MUST be able to select a checkbox or multistate value that differs from the preset-effective value, and the extension MUST retain it as an explicit build-option override under the existing option-persistence rules.
- **FR-015**: Build Options MUST visually emphasize only selected values that differ from their calculated preset-effective values.
- **FR-016**: A selected value equal to its calculated preset-effective value MUST be treated as having no effective override for display and command generation.
- **FR-017**: Changing the active preset, or changing the active build context in a way that changes which preset fragments apply (the model, the component, or whether the target is the emulator), MUST recalculate each option's preset-effective value and MUST then discard each explicit build-option override whose option is calculated differently under the new preset and build context than under the previous one, while preserving every override whose option is calculated identically. An override is authored against one calculated value, so it MUST be retired exactly when that value moves and MUST NOT be retired merely because some other option's did.
- **FR-018**: The manifest MUST remain the source of truth for supported build options, option labels, descriptions, groups, availability, types, and multistate values.
- **FR-019**: A multistate option state MUST NOT require a manifest-authored `default`; when no explicit override exists, its selected state MUST be inferred from the preset-effective value.
- **FR-020**: Before launching Build, Clippy, or Check, the extension MUST recalculate preset-effective values from the current active build context, active preset, and current preset inputs.
- **FR-021**: Build, Clippy, and Check MUST append `-p <active-preset>` exactly once when a named preset is active and MUST omit `-p` entirely when the synthetic `Default` choice is active; `-p default` MUST NOT be emitted.
- **FR-022**: Build, Clippy, and Check MUST emit explicit build-option arguments only for selected values that differ from the corresponding calculated preset-effective values.
- **FR-023**: Existing checkbox and multistate argument forms MUST remain unchanged when an explicit build-option override is emitted.
- **FR-024**: The active preset MUST NOT alter the shared build-context display, status-bar configuration item, task labels, command names, artifact paths, IntelliSense context, debug context, or flash/upload applicability.
- **FR-025**: Clean, Flash to Device, Upload to Device, and Start Debugging MUST retain their pre-feature command argument behavior and MUST NOT receive a preset argument solely because a preset is selected.
- **FR-026**: The extension MUST watch both preset inputs for creation, change, and deletion and refresh preset-dependent UI and workflow readiness without requiring a window reload.
- **FR-027**: When `presets.toml` is absent, the extension MUST treat it exactly as an empty shared preset file, continue processing `user-presets.toml` when present, and MUST NOT report the absence as an error.
- **FR-028**: When `presets.toml` is malformed, unreadable, or contains validation errors, the extension MUST replace the preset choices under the `Preset` selector with an error message, MUST write the error details to log output, and MUST prevent stale or guessed preset-effective values from being used for Build, Clippy, or Check.
- **FR-029**: Implementation of this feature MUST update `specs/product-spec.md` and `specs/glossary.md` to incorporate preset behavior and remove conflicting manifest-default and three-selector-only statements.
- **FR-030**: When `user-presets.toml` is malformed, unreadable, contains validation errors, or supplies unsupported preset values, the extension MUST replace the preset choices under the `Preset` selector with an error message, MUST write the error details to log output, MUST report file-backed syntax or semantic issues as diagnostics, and MUST block Build, Clippy, and Check until the file is valid.
- **FR-031**: While either preset file is invalid, the extension MUST preserve the saved preset id without resolving or replacing it; when valid preset data returns, the extension MUST restore that preset if available and otherwise normalize it to `default`.

### Key Entities

- **Preset definition**: A named collection of ordered fragments from the shared or user preset input. It has a name, declaration position, optional applicability filters, and zero or more build-option values.
- **Preset fragment**: One ordered contribution to defaults or a named preset. It applies conditionally to model, component, and emulator state and overlays only the option values it defines.
- **Active preset**: The single preset selection used to derive option values for Build, Clippy, and Check. Its id is stored in the same workspace-scoped active-configuration record as model, component/project, and target/emulator selection, but it remains separate from the active build context and its display text.
- **Default preset**: The always-available `Default` tree choice that applies matching shared and user `[[defaults]]` fragments without selecting a named preset and therefore emits no `-p` argument.
- **Preset-effective value**: The value of a supported build option after all applicable shared and user default and named-preset fragments have been overlaid, before explicit user overrides.
- **Build-option override**: A persisted user-selected option value that differs from the current preset-effective value and is therefore visually emphasized and emitted explicitly for Build, Clippy, and Check.

## Operational Constraints *(mandatory)*

- Supported host/version: VS Code 1.105 or later in the desktop extension host.
- Source of truth inputs: `specs/product-spec.md`, `specs/glossary.md`, the tf-tools manifest, the workspace-scoped selected model/target/component/preset state, shared `presets.toml`, optional `user-presets.toml`, and persisted build-option selections.
- Workspace assumptions: A single-root `trezor-firmware` workspace with the existing configured cargo workspace and manifest inputs; preset files follow the upstream xtask preset contract and are resolved from the xtask tf-tools configuration location within that workspace.
- Compatibility exclusions: Supporting older preset formats, editing preset files through the extension, creating or deleting presets, adding presets to context labels, and changing workflows other than Build, Clippy, and Check are out of scope.
- Ordering constraint: Shared preset definitions are processed before user definitions; defaults are processed before an active named preset; explicit user option overrides have final precedence.

## Failure Modes & Diagnostics *(mandatory)*

- **Trigger**: `presets.toml` is absent.
  - **User-visible response**: The extension behaves as though the shared file were empty. `default` and presets from a valid `user-presets.toml` remain selectable, and no missing-file warning is shown.
  - **Persistent signal**: No failure signal is produced for absence alone.
- **Trigger**: `presets.toml` is unreadable, malformed, or contains validation errors.
  - **User-visible response**: The `Preset` selector remains visible, but an error message replaces its preset choices. Build, Clippy, and Check are unavailable until valid preset data is restored; the saved preset id is not changed by the error state.
  - **Persistent signal**: Error details are written to log output; syntax and semantic issues tied to file content are also reported as diagnostics.
- **Trigger**: The optional user preset input is absent.
  - **User-visible response**: Shared presets and defaults continue to work without a warning.
  - **Persistent signal**: No failure signal is produced for absence alone.
- **Trigger**: `user-presets.toml` is unreadable, malformed, contains validation errors, or supplies unsupported preset values.
  - **User-visible response**: The `Preset` selector remains visible, but an error message replaces its preset choices. Build, Clippy, and Check are unavailable until valid user preset data is restored; the saved preset id is not changed by the error state.
  - **Persistent signal**: Error details are written to log output; syntax and semantic issues tied to file content are also reported as diagnostics.
- **Trigger**: A previously selected named preset is no longer available for the active build context.
  - **User-visible response**: The active preset changes to `default`, and dependent Build Options refresh immediately.
  - **Persistent signal**: The normalization is recorded in log output when caused by invalid or changed preset data.
- **Trigger**: A preset supplies a value that cannot be represented by the corresponding manifest-defined build option.
  - **User-visible response**: The affected option shows an actionable mismatch state, and Build, Clippy, and Check are blocked rather than launching with a guessed argument set.
  - **Persistent signal**: The mismatch is reported in log output and as a diagnostic associated with the preset input that supplied the value.
- **Trigger**: Preset data changes between display and command invocation.
  - **User-visible response**: Build, Clippy, or Check uses a fresh calculation; if recalculation fails, launch is blocked with an explanatory error.
  - **Persistent signal**: Recalculation failures are written to log output and file-backed issues are reported as diagnostics.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In all tested supported workspaces, users can select any preset available for the active model, target, and component in no more than three Configuration view interactions.
- **SC-002**: Across a representative matrix containing shared defaults, user defaults, named shared fragments, named user fragments, conditional fragments, checkbox options, and multistate options, 100% of displayed preset-effective values match the documented precedence rules.
- **SC-003**: Across Build, Clippy, and Check scenarios covering default and named presets, 100% of launched commands include the correct preset argument and omit every option argument whose selected value equals its preset-effective value.
- **SC-004**: Preset-file or active-build-context changes are reflected in the Preset and Build Options surfaces within two seconds without a window reload.
- **SC-005**: In regression checks, 100% of status-bar text, task labels, command names, Clean/flash/upload/debug argument behavior, artifact paths, and IntelliSense context remain identical when only the active preset changes.
- **SC-006**: In usability verification, at least 90% of participants can identify which build-option values override the active preset on their first attempt without consulting command-line output.

## Assumptions

- `presets.toml` is the shared source and `user-presets.toml` is an optional, personal override source colocated with it under the workspace's xtask tf-tools configuration location. Either file may be absent; an absent file contributes no fragments, while malformed or invalid content is an error.
- The special upstream `[[defaults]]` fragments are not a selectable named preset; the user-facing `Default` choice means defaults-only behavior and maps to omission of `-p`. The extension never emits `-p default`.
- A named preset is available for a build context when at least one of its shared or user fragments matches that context.
- Target selection supplies the emulator boolean used by upstream preset filters; model and component ids map to upstream model and project filter values.
- Each explicit build-option selection is authored against the value calculated for one option, so a change to the active preset or to the preset-filtered build context (the model, the component, or emulator-ness) retires a selection only when that option's calculated value actually moved. Selections whose calculated value is identical under both the old and the new pair are kept, because they still say exactly what the user asked for. Selections also survive preset-input edits and a target change that leaves emulator-ness unchanged; an override that becomes equal to the newly calculated preset-effective value remains harmless persisted state but is neither emphasized nor emitted.
- Checkbox options not assigned by any applicable preset layer use the upstream implicit disabled value.
- A multistate option requires a value from preset inputs to infer its no-override state; an unresolvable value is treated as a configuration failure rather than falling back to the first manifest state.
- Preset selection affects Build, Clippy, and Check because these workflows share preset-aware build arguments; all other workflows remain unchanged.