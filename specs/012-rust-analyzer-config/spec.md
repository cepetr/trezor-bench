# Feature Specification: Automatic Rust Analyzer Configuration

**Feature Branch**: `[012-rust-analyzer-config]`

**Created**: 2026-09-20

**Status**: Draft

**Input**: User description: "Add automatic rust-analyzer configuration based on the active model, hardware/emulator target, preset, and effective build options as a separate capability from C/C++ IntelliSense."

**Affected Product Areas**: `Configuration View`, `Startup And Refresh Behavior`, `Persistence And Defaults`, and a new `Rust Analyzer Configuration` area in `specs/product-spec.md`; `active build context`, `active preset`, `preset-effective value`, `build-option override`, `xtask`, `Configuration view`, and new Rust Analyzer terms in `specs/glossary.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select Automatic Rust Configuration (Priority: P1)

A firmware developer chooses whether Rust Analyzer should inspect all Cargo features or only the features relevant to the selected model, target, preset, and effective build options. The selected mode remains obvious and stable across workspace sessions.

**Why this priority**: Selecting and preserving one authoritative mode is the entry point for every other behavior in this feature.

**Independent Test**: In a workspace with Rust Analyzer available, switch between both mode commands, reload the workspace, and verify that exactly one mode remains selected and the corresponding complete configuration is active.

**Acceptance Scenarios**:

1. **Given** a workspace with no saved Rust Analyzer mode, **When** the extension restores workspace state, **Then** `Rust Analyzer: All Features` is selected and the complete managed configuration contains `cargo.features` set to `all`.
2. **Given** either mode is selected, **When** the user selects the other mode, **Then** the new mode is persisted for that workspace, exactly one mode is checked, and its refresh begins without blocking the Configuration view.
3. **Given** a saved mode, **When** the workspace is reopened, **Then** the saved mode is restored before its configuration is refreshed.
4. **Given** C/C++ IntelliSense is unavailable or misconfigured, **When** the user opens the Configuration view overflow menu, **Then** both Rust Analyzer mode commands remain available.
5. **Given** the latest refresh fails, **When** the user views the mode commands, **Then** the persisted selected mode remains checked and the previously applied configuration remains active.

---

### User Story 2 - Follow Firmware Selection Automatically (Priority: P1)

A firmware developer using model-specific mode receives Rust Analyzer settings that follow the selected model, hardware or emulator target, preset, and effective build options without manually editing editor settings.

**Why this priority**: Accurate automatic configuration for the active firmware selection is the feature's primary user value.

**Independent Test**: Select model-specific mode, change each relevant input in turn, and verify that the active Rust session receives only the newest complete configuration generated for the resulting selection.

**Acceptance Scenarios**:

1. **Given** model-specific mode and a valid model and hardware target, **When** configuration is generated successfully, **Then** the complete result includes the resolved Rust target and hardware-only check exclusions and becomes active in the current Rust session.
2. **Given** model-specific mode and a valid model and emulator target, **When** configuration is generated successfully, **Then** settings that do not apply to emulation, including the Rust target and check exclusions, are absent from the complete result and are cleared from the previously managed configuration.
3. **Given** model-specific mode, **When** the active model, target emulator state, preset, or effective build-option flags change, **Then** a refresh starts with the new inputs.
4. **Given** model-specific mode, **When** only the active component changes and the resulting effective build-option flags remain unchanged, **Then** no model-specific configuration refresh is started.
5. **Given** all-features mode, **When** any build selection or build option changes, **Then** no model-specific generation command is run and the all-features configuration remains active.
6. **Given** two refreshes overlap, **When** the older refresh finishes after the newer inputs have become current, **Then** its result is discarded and cannot replace the newer applicable configuration.

---

### User Story 3 - Preserve Explicit User Choices (Priority: P2)

A firmware developer who has explicitly configured a Rust Analyzer key keeps that effective value while being informed that it conflicts with the value managed by Trezor Bench.

**Why this priority**: Automatic configuration must not silently override deliberate editor configuration.

**Independent Test**: Define conflicting keys at each supported settings scope, apply a managed mode, remove an explicit value, and verify precedence, warning details, and immediate fallback to the already registered managed value.

**Acceptance Scenarios**:

1. **Given** an explicit value for a managed key at user, workspace, or workspace-folder scope, **When** Trezor Bench applies a complete configuration containing that key, **Then** the explicit value remains effective and the conflicting key is identified in a concise warning and log output.
2. **Given** a conflicting explicit setting, **When** managed configuration is submitted, **Then** the complete selected configuration still includes the conflicting key rather than filtering it out.
3. **Given** a managed value is registered behind an explicit setting, **When** the user removes the explicit setting, **Then** the registered managed value becomes effective without another selection change or refresh.
4. **Given** a conflict is detected, **When** the warning is shown, **Then** the selected mode and its checked state do not change.

---

### User Story 4 - Recover Without Losing Working Configuration (Priority: P2)

A firmware developer keeps the last working Rust Analyzer configuration when prerequisites, generated output, or runtime integration fail, and receives enough information to correct persistent failures.

**Why this priority**: Retaining a known-good editor state avoids turning a transient refresh problem into a broader interruption.

**Independent Test**: Start from a successfully applied configuration, induce each failure class, and verify retention, user feedback, logged context, and retry on the next relevant trigger.

**Acceptance Scenarios**:

1. **Given** model-specific mode is restored during startup without a valid model or target yet, **When** normal build-context restoration is still in progress, **Then** the extension waits without warning, retains the last applied configuration, and refreshes automatically when the context becomes valid.
2. **Given** model-specific mode lacks a valid model or target after normal restoration, **When** the invalid state persists, **Then** the extension retains the last applied configuration and reports the configuration problem through normal failure feedback.
3. **Given** Rust Analyzer is not installed or unavailable, **When** a refresh needs to apply configuration, **Then** the extension shows a concise missing-tool warning consistent with other tooling prerequisite warnings and retains the last successfully applied configuration.
4. **Given** generation fails, generated output is invalid, or configuration application fails, **When** the refresh ends, **Then** the selected mode remains unchanged, no partial result is applied, and the last successfully applied configuration remains active.
5. **Given** a refresh failure, **When** the failure is reported, **Then** log output includes available diagnostics and the relevant model, target, preset, and effective build-option context, and the extension retries on the next relevant selection change or mode toggle.

### Edge Cases

- Generated output is empty, malformed, contains an unknown setting, contains nested data beyond supported setting groups, or contains a value type outside strings, booleans, numbers, and lists of supported scalar values.
- A refresh succeeds after its inputs or selected mode have changed.
- Rapid input changes produce several overlapping generation requests, including a mode switch to all-features while generation is still running.
- A hardware configuration is followed by an emulator configuration that intentionally omits previously present keys.
- Rust Analyzer becomes unavailable after a configuration has already been applied.
- The same key is explicitly configured at more than one settings scope; normal editor precedence determines the effective explicit value and every conflicting scope is included in log details.
- A workspace opens with no folder or with multiple folders.
- The extension is stopped or the workspace becomes unsupported while managed overrides are registered.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Configuration view overflow menu MUST contain a dedicated group with `Rust Analyzer: Model Specific` and `Rust Analyzer: All Features` commands.
- **FR-002**: The two mode commands MUST be mutually exclusive and checkable, with exactly one checked at all times after workspace state is initialized.
- **FR-003**: The extension MUST persist the selected Rust Analyzer mode per workspace and MUST default to all-features mode when no selection has been saved.
- **FR-004**: Command checked state MUST represent the selected mode independently of refresh success and independently of C/C++ IntelliSense availability.
- **FR-005**: All-features mode MUST register a complete managed configuration containing only `cargo.features` with the value `all`.
- **FR-006**: Model-specific mode MUST request configuration from the firmware repository using the same workspace and task-environment conventions as existing firmware workflows.
- **FR-007**: A model-specific request MUST represent the active model, target emulator state, active preset, and effective build-option flags; it MUST NOT depend on the active component.
- **FR-008**: Model-specific output MUST represent all supported embedded projects for the selected inputs.
- **FR-009**: The extension MUST accept model-specific output only when it is non-empty and structurally valid, with no tables other than `cargo` and `check` and no keys other than `cargo.features`, `cargo.target`, `cargo.allTargets`, and `check.extraArgs`.
- **FR-010**: The extension MUST flatten accepted grouped settings into complete dotted Rust Analyzer setting names without a `rust-analyzer.` prefix.
- **FR-011**: The extension MUST require `cargo.features` and `check.extraArgs`, when present, to be lists of strings; `cargo.target` to be a string; and `cargo.allTargets` to be a boolean. It MUST reject the entire result when any part is malformed, unexpected, or uses another value type, and MUST never partially apply such a result.
- **FR-012**: Hardware results MUST include `cargo.target` and `check.extraArgs`; emulator results MUST omit both settings. The firmware generator owns the semantic contents of `check.extraArgs`; the extension MUST validate its presence and string-list type for hardware results but MUST NOT interpret individual arguments.
- **FR-013**: The extension MUST register the complete selected configuration with the active Rust Analyzer session under Trezor Bench's identity and MUST NOT write these managed values to authored workspace settings.
- **FR-014**: Each successful registration MUST replace the prior Trezor Bench configuration as a whole so omitted keys are cleared; when managed overrides must be removed, the extension MUST register an empty configuration.
- **FR-015**: The active Rust Analyzer session MUST receive successful configuration changes without requiring manual settings edits or a user-initiated session restart.
- **FR-016**: The extension MUST refresh after activation restores the build context, after a mode change, and after the active model, target emulator state, active preset, or effective build-option flags change.
- **FR-017**: Changing the active component MUST NOT directly trigger model-specific generation; generation MUST occur if that change produces different effective build-option flags.
- **FR-018**: The extension MUST NOT run model-specific generation while all-features mode is selected.
- **FR-019**: Refresh work MUST remain asynchronous so the Configuration view stays responsive.
- **FR-020**: The extension MUST cancel obsolete generation when practical and MUST reject every result that no longer matches the current mode and inputs, so only the newest applicable result can be applied.
- **FR-021**: During normal startup restoration, model-specific mode with no valid model or target MUST wait without warning, retain the last applied configuration, and refresh automatically when context becomes valid.
- **FR-022**: A persistently invalid model-specific context MUST retain the selected mode and last applied configuration while being reported through normal configuration failure feedback.
- **FR-023**: Before applying a configuration, the extension MUST detect explicit values for every managed key at user, workspace, and workspace-folder scopes.
- **FR-024**: Explicit settings MUST retain their normal effective precedence, while the extension MUST still submit every key in the complete selected managed configuration.
- **FR-025**: Conflicts MUST produce a concise warning naming the conflicting keys and detailed log output naming the keys and scopes; conflicts MUST NOT change the selected mode.
- **FR-026**: Removing an explicit conflicting setting MUST reveal the already registered managed value without requiring another refresh.
- **FR-027**: Missing Rust Analyzer support MUST produce a concise warning consistent with the extension's missing-tool behavior.
- **FR-028**: Generation, validation, or configuration-registration failure MUST retain the last successfully applied configuration and selected mode, show a concise warning, and record diagnostics plus relevant model, target, preset, and effective build-option context in log output.
- **FR-029**: After a failure, the extension MUST retry when the next relevant selection change or mode toggle occurs.
- **FR-030**: In no-folder and multi-root workspaces, this capability MUST follow the extension's existing unsupported-workspace behavior and MUST clear managed overrides when the workspace can no longer be managed safely.

### Key Entities

- **Rust Analyzer mode**: The workspace-persisted choice between model-specific configuration and all-features configuration; its value determines command checked state and refresh behavior.
- **Configuration input snapshot**: The model, target emulator state, preset, and effective build-option flags associated with one model-specific generation request; used to decide whether a result is still applicable.
- **Managed Rust configuration**: The complete set of flattened Rust Analyzer keys currently registered by Trezor Bench; replacement is atomic and omitted keys are removed.
- **Explicit setting conflict**: A managed key that also has an explicit value at user, workspace, or workspace-folder scope, including the scopes and effective user-authored value.
- **Refresh result**: A complete validated configuration or a failure associated with one input snapshot and selected mode.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of tested workspace restores and mode changes, exactly one Rust Analyzer mode command is checked and it matches the persisted selection, including after refresh failure.
- **SC-002**: For every supported model, target kind, preset, and effective build-option test combination, the active Rust session receives the corresponding complete valid configuration without manual settings edits.
- **SC-003**: In rapid-change tests with at least 10 successive relevant input changes, only the configuration for the final current inputs becomes active and no obsolete result is applied.
- **SC-004**: In 100% of invalid-output test cases, no portion of the invalid result becomes active and the last successful configuration is preserved.
- **SC-005**: In 100% of tested conflicts across user, workspace, and workspace-folder scopes, the explicit value remains effective, all conflicting keys are identified to the user, and removing the explicit value reveals the registered managed value without another refresh.
- **SC-006**: Mode selection and relevant build-context interactions remain responsive while model-specific configuration is being generated, with command initiation returning control to the user within one second under normal workspace conditions.
- **SC-007**: Every tested persistent generation, validation, missing-tool, and registration failure produces one concise user warning and enough log context to identify the active model, target, preset, effective build-option flags, and available diagnostics.
- **SC-008**: Changing only the active component while effective build-option flags remain unchanged, or changing any build input while all-features mode is selected, causes zero model-specific generation requests.

## Assumptions

- The firmware repository provides a supported configuration-generation workflow that accepts model, emulator state, preset, and effective build-option flags and returns one complete grouped Rust Analyzer configuration.
- The Rust Analyzer extension provides a documented runtime registration interface in which each registration from Trezor Bench replaces that extension's previous registered object.
- The four generated Rust Analyzer keys named in the requirements are the complete supported model-specific output schema for this feature.
- Existing editor configuration precedence determines which explicit value is effective when the same key is authored at multiple scopes.
- The existing workspace guard, task environment, log output, warning style, build selection, preset resolution, and effective build-option calculation remain authoritative dependencies.
- This feature does not alter C/C++ IntelliSense backend selection, compile-database management, excluded-file visibility, build-option semantics, or firmware workflow commands other than invoking the dedicated Rust configuration generator.
- Multi-root support is outside this feature's scope.
