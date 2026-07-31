---

description: "Task list for Build Preset Support"
---

# Tasks: Build Preset Support

**Input**: Design documents from `specs/009-build-preset-support/`

**Prerequisites**: `specs/009-build-preset-support/plan.md`, `specs/009-build-preset-support/spec.md`, `specs/009-build-preset-support/research.md`, `specs/009-build-preset-support/data-model.md`, `specs/009-build-preset-support/contracts/`, `specs/009-build-preset-support/quickstart.md`, `.specify/memory/constitution.md`

**Tests**: Included. Constitution Principle III makes tests mandatory, and the changed areas (VS Code integration, manifest parsing, task execution, diagnostics, persisted state) all require integration-level coverage in addition to unit tests. Test tasks are scheduled before the implementation tasks they cover.

**Organization**: Tasks are grouped by user story. All three stories are P1; they are ordered by their design dependency chain (availability → effective values → arguments).

**File Reference Rule**: All repository paths below are workspace-relative.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: `[US1]`, `[US2]`, `[US3]` — maps to the user stories in `specs/009-build-preset-support/spec.md`
- Every task names the exact file(s) it touches

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the one new runtime dependency and the fixture workspaces every later phase reads.

- [X] T001 Add `"smol-toml": "^1.7.1"` to the `dependencies` block of `package.json`, run `npm install`, and confirm both `npm run compile` (CommonJS `tsc`) and the esbuild bundle resolve it without config changes (research Decision 1)
- [X] T002 [P] Create fixture `test-fixtures/workspaces/preset-valid/` with `tf-tools-manifest.yaml` (at least one checkbox option and one multistate option, the multistate declaring a `value: null` state), `.vscode/settings.json`, `xtask/tf-tools/presets.toml` containing two `[[defaults]]` fragments, a `[[test]]` fragment with no `when`, and a context-restricted `[[dev]]` fragment, plus `xtask/tf-tools/user-presets.toml` adding a user-only preset and re-declaring `test`
- [X] T003 [P] Create fixture `test-fixtures/workspaces/preset-no-defaults/` with `tf-tools-manifest.yaml`, `.vscode/settings.json`, and `xtask/tf-tools/presets.toml` declaring named presets but no `[[defaults]]` fragment (Acceptance Scenario 1.2)
- [X] T004 [P] Create fixture `test-fixtures/workspaces/preset-missing-shared/` with `tf-tools-manifest.yaml`, `.vscode/settings.json`, and only `xtask/tf-tools/user-presets.toml` — no `presets.toml` (FR-027)
- [X] T005 [P] Create fixture `test-fixtures/workspaces/preset-malformed-shared/` with `tf-tools-manifest.yaml`, `.vscode/settings.json`, and `xtask/tf-tools/presets.toml` containing a TOML syntax error (FR-028)
- [X] T006 [P] Create fixture `test-fixtures/workspaces/preset-invalid-user/` with `tf-tools-manifest.yaml`, `.vscode/settings.json`, a valid `xtask/tf-tools/presets.toml`, and `xtask/tf-tools/user-presets.toml` whose fragment carries an unknown `when` field (FR-030)
- [X] T007 [P] Create fixture `test-fixtures/workspaces/preset-value-mismatch/` with `tf-tools-manifest.yaml`, `.vscode/settings.json`, and `xtask/tf-tools/presets.toml` setting a multistate option to a value no manifest state declares (research Decision 10, option-level tier)

**Checkpoint**: `smol-toml` resolves in both build paths and all six fixture workspaces exist.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The preset input slice — types, pure parser/validator, path resolution, watching service, and observability plumbing. No user story can start until preset files can be read, validated, and published as `PresetState`.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for Foundational

- [X] T008 [P] Write unit suite `src/test/unit/presets/parse-presets.test.ts` covering: TOML syntax error → `toml-parse` error issue with line/column; non-array-of-tables top level, non-table `when`, unknown `when` field, non-string-array `when.model`/`when.project`, non-boolean `when.emulator` → error issues (research Decision 6); `[[default]]` group → `reserved-preset-name` warning that does not block (research Decision 7); option keys unknown to the manifest parsed and retained without any issue (research Decision 5); `names` in first-declaration order excluding `defaults`; per-`(source, name)` fragment `order` preserving file order; `headerLine` captured for diagnostic anchoring; and the real upstream `core/embed/xtask/tf-tools/presets.toml` shape (including `asan` and `project = ["firmware", "kernel"]`) loading with zero error issues
- [X] T009 [P] Write unit suite `src/test/unit/presets/preset-paths.test.ts` asserting both preset URIs resolve as `<resolveCargoWorkspacePath(folder)>/xtask/tf-tools/presets.toml` and `.../user-presets.toml`, including the default `core/embed` setting value and a repointed `tfTools.cargoWorkspacePath`, and that they are never derived from `tfTools.manifestPath` (research Decision 2)
- [X] T010 [P] Extend `src/test/unit/manifest/validate-manifest.test.ts` to assert `options[].id` is carried through to `BuildOption.id`, and that an entry omitting `id` yields the flag-with-dashes-stripped fallback match key (research Decision 4)
- [X] T011 Write integration suite `src/test/integration/preset-service.integration.test.ts` asserting: `preset-valid/` loads a `loaded` state from both files; `preset-missing-shared/` loads without any missing-file signal (FR-027); `preset-malformed-shared/` and `preset-invalid-user/` publish `invalid` with a diagnostic on the offending file and an entry in the `Trezor Firmware Tools` channel (FR-028, FR-030); create/change/delete of `user-presets.toml` republishes state within the debounce window without a window reload (FR-026); and a `tfTools.cargoWorkspacePath` change re-resolves both inputs (research Decision 2, 14)

### Implementation for Foundational

- [X] T012 Create `src/presets/preset-types.ts` declaring `PresetSource`, `PresetRawValue`, `PresetFilter`, `PresetFragment`, `PresetFile`, and the `PresetState` discriminated union (`loaded` | `invalid`), per `specs/009-build-preset-support/data-model.md` §1
- [X] T013 Add `readonly id?: string` to `BuildOption` and the `toml-parse`, `invalid-filter`, `reserved-preset-name`, and `preset-value-mismatch` members to `ValidationCode` in `src/manifest/manifest-types.ts`
- [X] T014 Carry `options[].id` through the parser into `BuildOption.id` in `src/manifest/validate-manifest.ts`, leaving every existing validation code and message unchanged
- [X] T015 Implement the pure parser/validator in `src/presets/parse-presets.ts`: `smol-toml` parse → `PresetFile` + `ValidationIssue[]`, key-insertion order for `names`, per-group fragment `order`, `when` shape validation per research Decision 6, reserved-name warning per Decision 7, unknown option keys retained without issue per Decision 5, and `headerLine` located by a single regex scan of the raw text per Decision 15
- [X] T016 Add preset-input path resolution to `src/workspace/settings.ts` returning both URIs under `<resolveCargoWorkspacePath(folder)>/xtask/tf-tools/`, with no new user-facing setting
- [X] T017 Implement `PresetService` in `src/presets/preset-service.ts` modeled on `src/manifest/manifest-service.ts`: own both URIs, read and parse each file (absent → `present: false`, empty, never an error), publish `PresetState` through an `onDidChangeState` emitter, watch both paths for create/change/delete with the existing 300 ms debounce, and expose an awaitable `reload()` for the pre-launch recalculation path (research Decision 14)
- [X] T018 Add preset-state and preset-failure logging to `src/observability/log-channel.ts`: load results, file-level invalidity with the offending file, and first-seen unknown option keys at informational level (research Decision 5)
- [X] T019 Publish preset validation issues as diagnostics in `src/observability/diagnostics.ts`, attributed to the URI of the file that produced them, using the `headerLine` range when present and falling back to the existing `Range(0,0,0,0)` behavior otherwise (research Decision 15)
- [X] T020 Wire `PresetService` into `src/extension.ts`: construct it on activation, dispose it on deactivate, subscribe its state changes to the existing refresh chain, publish its diagnostics and log entries, and restart it on a `tfTools.cargoWorkspacePath` change

**Checkpoint**: Both preset inputs load, validate, watch, and publish `PresetState` with diagnostics and log entries. Nothing user-visible has changed yet.

---

## Phase 3: User Story 1 - Select an Available Preset (Priority: P1) 🎯 MVP

**Goal**: A fourth `Presets` selector under `Component` lists the synthetic `Default` choice plus every named preset available for the active build context, and the selection persists in the same workspace-scoped active-configuration record as model, target, and component.

**Independent Test**: Open `test-fixtures/workspaces/preset-valid/`, expand `Presets`, select a named preset, and verify the selected row and selector description update while the status bar, task labels, and command names stay free of any preset name. Reload the window and confirm the selection survives.

### Tests for User Story 1

- [X] T021 [P] [US1] Write unit suite `src/test/unit/presets/preset-availability.test.ts` covering `PresetContext` derivation (`emulator` from the active target's manifest `flag` for an emulator target, a hardware target, and a manifest that renames the target ids — research Decision 3) and `AvailablePreset` listing: `Default` always first and always present including with no `[[defaults]]` fragment (FR-004), each named preset listed once at its first declaration scanning shared `names` then user `names` (FR-003), a preset listed only when at least one of its fragments matches the context (FR-006), and `defaults` and a literal `default` group never listed (FR-005, Decision 7)
- [X] T022 [P] [US1] Extend `src/test/unit/configuration/normalize-config.test.ts` for `normalizePresetId`: `availableIds === undefined` returns the saved id unchanged (FR-031); a saved id present in `availableIds` is kept (FR-008, Scenario 1.6); any other saved id normalizes to `DEFAULT_PRESET_ID` (FR-008, Scenario 1.4); and existing `normalizeActiveConfig` behavior for the manifest axes is unchanged
- [X] T023 [P] [US1] Extend `src/test/unit/ui/configuration-tree.test.ts` for the `Presets` selector: it is the fourth `Build Selection` child directly below `Component` (FR-001); its icon is `layers` and its select command is `tfTools.selectPreset` (research Decision 16); its description shows the active preset's label, `Default` for the synthetic choice, and `—` before anything resolves; preset state `undefined` renders the loading placeholder; preset state `invalid` replaces all choices with a warning row naming the failing file plus a details placeholder (FR-028, FR-030); and only one selector is expanded at a time with `"preset"` participating (FR-002)
- [X] T024 [US1] Write integration suite `src/test/integration/preset-selection.integration.test.ts` covering: the four-selector order in `preset-valid/`; `Default` still offered in `preset-no-defaults/`; selecting a named preset updates the description and active marker and persists `presetId` into `tfTools.activeConfig`; a legacy `tfTools.activeConfig` record without `presetId` restores as `default` and is not rewritten merely for that (data-model §3, §7); changing `Component` to one no fragment matches normalizes the active preset to `default` (Scenario 1.4); with a preset file broken the saved id is preserved unresolved and, once fixed, is restored if available and normalized to `default` only if not (FR-031, Scenario 1.6); and the status bar item, task labels, and command names contain no preset name (FR-024, Scenario 1.5)

### Implementation for User Story 1

- [X] T025 [US1] Create `src/presets/preset-resolution.ts` with the pure `PresetContext` derivation (`modelId`, `projectId` from the active component, `emulator` from `target.flag === "--emulator" || target.flag === "-e"`), the fragment matching rule (fields AND, values OR, absent field matches all — FR-012), and `AvailablePreset` listing per `specs/009-build-preset-support/data-model.md` §2
- [X] T026 [US1] Extend `src/configuration/active-config.ts` with the optional `presetId` field on `ActiveConfig`, the exported `DEFAULT_PRESET_ID = "default"`, an `activePresetId(config)` reader defaulting to `DEFAULT_PRESET_ID`, a `selectPreset` writer mirroring `selectModel`/`selectTarget`/`selectComponent`, and preset-aware `restoreActiveConfig` that writes back only when normalization changed something and never writes while preset state is invalid
- [X] T027 [US1] Add `normalizePresetId(savedId, availableIds)` to `src/configuration/normalize-config.ts` implementing the three branches from `specs/009-build-preset-support/data-model.md` §3, leaving `normalizeActiveConfig` and `isConfigValid` behavior for the manifest axes untouched
- [X] T028 [US1] Extend `src/ui/configuration-tree.ts` with `SelectorKind` member `"preset"`, `SELECTOR_ICONS.preset = "layers"`, `SELECT_COMMANDS.preset = "tfTools.selectPreset"`, the fourth `Build Selection` child below `Component`, the active-preset description, and the loading / invalid-error / loaded-choices expanded states per `specs/009-build-preset-support/data-model.md` §6
- [X] T029 [US1] Register the `tfTools.selectPreset` handler in `src/extension.ts` (no new `package.json` contributed command), and refresh available presets plus preset normalization on activation, preset-state change, manifest-state change, and active model/target/component change (FR-009)
- [X] T030 [US1] Log preset normalization in `src/observability/log-channel.ts` when a saved preset is normalized to `default` because of changed or invalid preset data (spec `Failure Modes & Diagnostics`)

**Checkpoint**: Preset selection works end to end — listed, selectable, persisted, restored, normalized — and no display surface mentions the preset. US1 is independently demoable.

---

## Phase 4: User Story 2 - Adjust Preset-Relative Options (Priority: P1)

**Goal**: Build Options show the active preset's effective value for every option with no explicit override, emphasize only values that differ, and keep valid overrides across preset changes.

**Independent Test**: In `preset-valid/`, switch between `Default` and named presets and verify displayed option values track the preset; override a checkbox and confirm emphasis appears, clears when it matches again, and survives a round trip without the stored selection being erased. Open `preset-value-mismatch/` and confirm the affected row reports the unrepresentable value.

### Tests for User Story 2

- [X] T031 [P] [US2] Write unit suite `src/test/unit/presets/preset-effective-values.test.ts` covering the four-layer overlay (shared `defaults` → user `defaults` → shared active-preset → user active-preset), file order inside each layer, a later matching fragment replacing one key while omitted keys retain prior values (FR-010, FR-011), layers 3–4 skipped for `default`, and the raw-value → option-value table from `specs/009-build-preset-support/data-model.md` §2: checkbox boolean → resolved, checkbox non-boolean → `mismatch`, checkbox absent → `false`, multistate matching a state id → resolved, multistate matching none → `mismatch`, multistate absent with a `value: null` state → that state id, multistate absent with no null state → `unresolved`, and unknown keys contributing nothing
- [X] T032 [P] [US2] Extend `src/test/unit/configuration/build-options.test.ts` for `presetValue`, `presetState`, and `isOverride`: the six-step `value` resolution order from `specs/009-build-preset-support/data-model.md` §4; `isOverride` recomputed as `storedValue !== presetValue` on every refresh with the persisted map never rewritten when the preset changes (FR-016, FR-017); a stored value equal to a null-valued state id treated as no explicit selection (research Decision 8 rule 3); and `isOverride` forced `false` for `unresolved` and `mismatch`
- [X] T033 [P] [US2] Extend `src/test/unit/ui/configuration-tree.test.ts` to assert emphasis is driven by `resolved.isOverride` for the checkbox path, the multistate path, and the collapsed group-header rollup (FR-015, replacing `_isNonDefault`), that a `mismatch` option renders with the `warning` icon and a description naming the unrepresentable value, and that an `unresolved` option renders with non-selectable state children
- [X] T034 [US2] Write integration suite `src/test/integration/preset-build-options.integration.test.ts` covering `preset-valid/`: displayed values under `Default` come from matching `[[defaults]]` fragments with nothing emphasized; switching presets changes displayed values with no stored selection written (Scenario 2.2); overriding emphasizes the row and its collapsed group header; matching the preset again clears emphasis (Scenario 2.4); a preset whose effective value equals a stored selection clears emphasis without erasing the selection and restores it on switching back (Scenario 2.6); a multistate option with no manifest-authored default infers its state from the preset-effective value (Scenario 2.5); selecting the null-valued state clears the override; and `preset-value-mismatch/` reports on the affected row with a diagnostic on `presets.toml`

### Implementation for User Story 2

- [X] T035 [US2] Add `PresetEffectiveValue` computation to `src/presets/preset-resolution.ts`: the four-layer ordered overlay, the raw-value → option-value mapping including the `resolved` / `unresolved` / `mismatch` states with `rawValue` and `sourceUri` for mismatch attribution, and option-key matching against `BuildOption.id` with the dash-stripped `flag` fallback (research Decision 4)
- [X] T036 [US2] Make `ResolvedOption` preset-relative in `src/configuration/build-options.ts`: add `presetValue`, `presetState`, and `isOverride`, implement the six-step `value` resolution order, discard stored selections that are `null`, match no current state id, or equal the null-valued state id (research Decision 8), and leave `available` and `deriveOptionFlags`' existing forms intact
- [X] T037 [US2] Replace `_isNonDefault` with `resolved.isOverride` for the checkbox, multistate, and group-header emphasis paths in `src/ui/configuration-tree.ts`, and render `mismatch` rows with the `warning` icon plus an explanatory description and `unresolved` rows with non-selectable state children
- [X] T038 [US2] Recompute preset-effective values and refresh `Build Options` in `src/extension.ts` whenever the active preset, preset state, manifest state, or active build context changes (FR-013, FR-017, SC-004)

**Checkpoint**: Build Options are fully preset-relative — display, emphasis, override retention, and mismatch reporting all follow the active preset. US1 and US2 both work.

---

## Phase 5: User Story 3 - Run Preset-Aware Workflows (Priority: P1)

**Goal**: `Build`, `Clippy`, and `Check` recalculate from fresh preset inputs and launch with `-p <name>` for a named preset plus arguments only for differing overrides, while `Clean`, flash, upload, and debug stay byte-identical.

**Independent Test**: Inspect `ProcessExecution.args` via `vscode.tasks.fetchTasks({ type: "tfTools" })` for the default preset, a named preset, no overrides, and differing overrides; then break a preset file and confirm `Build`/`Clippy`/`Check` are blocked while `Clean` still launches with no arguments.

### Tests for User Story 3

- [X] T039 [P] [US3] Extend `src/test/unit/workflow/build-arguments.test.ts` for `deriveWorkflowArguments`: `-p <id>` emitted exactly once and only for a non-`default` preset with `-p default` never emitted (FR-021, Scenario 3.6); `-p` positioned after the target flag and before override flags (research Decision 12); the pre-feature prefix `<component-id> -m <model-id> [target-flag]` byte-identical for the `Default`/no-override case; flags emitted only for `available && isOverride` options in manifest declaration order (FR-022); checkbox on-override → bare `<flag>`, off-override → `<flag>=false` (research Decision 9), value equal to preset-effective → nothing; multistate override → the unchanged `<flag>=<value>` form (FR-023); nothing emitted for `unresolved` or `mismatch`; and `deriveCleanArguments` still returning `[]` (FR-025)
- [X] T040 [P] [US3] Extend `src/test/unit/workflow/preconditions.test.ts` for the new `presets-invalid` `WorkflowBlockReason`: evaluated after `manifest-invalid`, carrying its own `blockReasonMessage` text, with every existing reason and priority unchanged
- [ ] T041 [US3] Write integration suite `src/test/integration/preset-workflow.integration.test.ts` asserting launched task arguments in `preset-valid/` for: `Default` with no differing overrides → neither `-p` nor any option flag (Scenario 3.1); a named preset → exactly one `-p <name>` pair after the target flag (Scenario 3.2); mixed selections → flags only for differing values (Scenario 3.3); a checkbox turned off against a preset-effective `true` → `<flag>=false`; user fragments overriding shared fragments for the same preset → comparison uses the user-adjusted value (Scenario 3.4); and editing `presets.toml` with the view open then invoking `Build` → args reflect the edited file with no window reload (FR-020, research Decision 13)
- [ ] T042 [US3] Write integration suite `src/test/integration/preset-blocking.integration.test.ts` asserting that in `preset-malformed-shared/`, `preset-invalid-user/`, and `preset-value-mismatch/`: `Build`, `Clippy`, and `Check` are disabled via `tfTools.presetBlocked`; invoking `Build` from the Command Palette is rejected with a visible error plus a log entry and starts no task; `Clean` stays enabled and still launches with no arguments (FR-025, research Decision 11); and `Flash to Device`, `Upload to Device`, and `Start Debugging` keep their pre-feature argument lists with any preset active (Scenario 3.5)

### Implementation for User Story 3

- [X] T043 [US3] Extend `deriveWorkflowArguments` in `src/commands/build-workflow.ts` to take the active preset id, emit `[-p <preset-id>]` after the target flag only for a non-`default` preset, and emit option flags only for `available && isOverride` options — checkbox on → `<flag>`, checkbox off → `<flag>=false`, multistate → the existing `<flag>=<value>` — leaving `deriveCleanArguments` untouched
- [ ] T044 [US3] Add the `presets-invalid` variant to `WorkflowBlockReason`, evaluate it after `manifest-invalid` in `evaluateWorkflowPreconditions`, and give it a distinct message in `blockReasonMessage`, all in `src/commands/build-workflow.ts`
- [ ] T045 [US3] Thread the active preset and the preset-relative `ResolvedOption[]` into the argument derivation used by `src/tasks/build-task-provider.ts`, keeping `formatTaskLabel` output and the `CLEAN_TASK_LABEL` unchanged
- [ ] T046 [US3] Change the `Build`, `Clippy`, and `Check` `view/title` entries in `package.json` to `"enablement": "!tfTools.workflowBlocked && !tfTools.presetBlocked"`, leaving the `Clean` entry at `"!tfTools.workflowBlocked"` and every other entry untouched (research Decision 11)
- [ ] T047 [US3] In `src/extension.ts`, set the `tfTools.presetBlocked` context key from file-level invalidity or any available-option mismatch, and make the `Build`, `Clippy`, and `Check` handlers `await presetService.reload()`, recompute available presets, normalize the active preset, and recompute preset-effective values before deriving arguments — rejecting the launch with a visible error plus a log entry on invalidity or mismatch (FR-020, research Decision 13)

**Checkpoint**: All three user stories are functional. Preset-aware commands launch correctly and every excluded surface is provably unchanged.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: The FR-029 documentation duty and the full verification pass.

- [ ] T048 [P] Update `specs/product-spec.md` per the `Documentation completion gate` in `specs/009-build-preset-support/quickstart.md`: the fourth `Build Selection` selector and its `layers` icon in `Configuration View Iconography`; preset-relative option display, emphasis, mismatch, and unresolved states in `Build Option Management`; the preset id inside the active-configuration record in `Persistence And Defaults` plus the replacement of the "multistate options default to the manifest-defined default state" rule with research Decision 8 rules 1–3; preset inputs and `tfTools.cargoWorkspacePath` as refresh triggers in `Startup And Refresh Behavior`; the `-p` and `<flag>=false` forms in `Build` and `Clippy And Check`; and `Clean`'s exemption from preset invalidity in `Availability And Blocking Model` (FR-029)
- [ ] T049 [P] Update `specs/glossary.md` to add `preset`, `active preset`, `default preset`, `preset-effective value`, and `build-option override`, extend `active configuration` to carry the preset id, and revise `default state` for the null-valued-state rules — without changing any other existing definition (FR-029)
- [ ] T050 Run the regression suites named in `specs/009-build-preset-support/quickstart.md` under `Regression checks` — `src/test/unit/ui/status-bar.test.ts`, `src/test/unit/workflow/task-labels.test.ts`, `src/test/unit/workflow/build-arguments.test.ts`, `src/test/unit/workflow/preconditions.test.ts`, `src/test/integration/persistence-status-bar.integration.test.ts`, `src/test/integration/build-workflow.integration.test.ts`, `src/test/integration/flash-upload-actions.integration.test.ts`, `src/test/integration/debug-launch.integration.test.ts` — and confirm no behavior change where the feature must be invisible (SC-005)
- [ ] T051 Run `npm run lint`, `npm run compile`, and `npm run test:unit` from the repository root and resolve every failure
- [ ] T052 Run `npm test` (the `@vscode/test-electron` integration harness) from the repository root and resolve every failure
- [ ] T053 Walk the manual checks in `specs/009-build-preset-support/quickstart.md` — `US1`, `US2`, `US3`, and `Failure and refresh checks` — confirming in particular that preset-file and build-context changes land within two seconds and with no window reload (SC-004)
- [ ] T054 Run `npm run smoke:package` and confirm the packaged artifact bundles `smol-toml` and activates cleanly

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on T001 for the parser and on T002–T007 for its integration test. **BLOCKS all user stories.**
- **User Stories (Phases 3–5)**: All depend on Phase 2. See the chain below.
- **Polish (Phase 6)**: T048 and T049 can be written once the corresponding behavior is settled (after Phase 5); T050–T054 require all three stories complete.

### User Story Dependencies

All three stories are P1 and each is independently testable, but they are *not* independently implementable — the design threads one slice through three seams:

- **US1 (T021–T030)**: Depends only on Phase 2. Creates `src/presets/preset-resolution.ts` with `PresetContext` and availability. **This is the MVP.**
- **US2 (T031–T038)**: Depends on Phase 2 and on T025 (US2's effective-value overlay reuses `PresetContext` and the fragment matcher). Can be verified independently once US1's selector exists.
- **US3 (T039–T047)**: Depends on Phase 2, T026 (`activePresetId`), and T036 (`isOverride`) — argument emission is defined in terms of the override comparison US2 establishes. Verified independently through task-argument inspection.

Recommended order: Phase 1 → Phase 2 → US1 → US2 → US3 → Phase 6.

### Within Each User Story

- Test tasks come before the implementation tasks they cover and must fail first.
- Pure resolution logic before the state/persistence layer, state before presentation, presentation before wiring.
- `src/extension.ts` wiring is last in each story because it consumes everything else in that story.

### Same-File Serialization

These tasks touch a shared file and must not run in parallel with each other:

- `src/presets/preset-resolution.ts`: T025 then T035
- `src/configuration/build-options.ts`: T036 alone
- `src/ui/configuration-tree.ts`: T028 then T037
- `src/commands/build-workflow.ts`: T043 then T044
- `src/extension.ts`: T020 → T029 → T038 → T047
- `src/observability/log-channel.ts`: T018 then T030
- `src/test/unit/ui/configuration-tree.test.ts`: T023 then T033
- `src/manifest/manifest-types.ts` / `validate-manifest.ts`: T013 then T014

### Parallel Opportunities

- **Phase 1**: T002–T007 (six independent fixture workspaces) all run in parallel after T001.
- **Phase 2**: T008, T009, T010 in parallel; then T012, T016, T018 in parallel (distinct files); T013 → T014 serial.
- **US1**: T021, T022, T023 in parallel.
- **US2**: T031, T032, T033 in parallel.
- **US3**: T039, T040 in parallel; T041 and T042 in parallel (distinct new suites).
- **Phase 6**: T048 and T049 in parallel.

---

## Parallel Example: Phase 1 Fixtures

```bash
# After T001, launch all six fixture workspaces together:
Task: "Create fixture test-fixtures/workspaces/preset-valid/"
Task: "Create fixture test-fixtures/workspaces/preset-no-defaults/"
Task: "Create fixture test-fixtures/workspaces/preset-missing-shared/"
Task: "Create fixture test-fixtures/workspaces/preset-malformed-shared/"
Task: "Create fixture test-fixtures/workspaces/preset-invalid-user/"
Task: "Create fixture test-fixtures/workspaces/preset-value-mismatch/"
```

## Parallel Example: User Story 1 Tests

```bash
# Launch the three unit suites for User Story 1 together:
Task: "Write unit suite src/test/unit/presets/preset-availability.test.ts"
Task: "Extend src/test/unit/configuration/normalize-config.test.ts for normalizePresetId"
Task: "Extend src/test/unit/ui/configuration-tree.test.ts for the Presets selector"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup — dependency plus fixtures.
2. Complete Phase 2: Foundational — the `src/presets/` slice. **Blocks everything.**
3. Complete Phase 3: User Story 1 — the `Presets` selector, persistence, normalization.
4. **STOP and VALIDATE**: Run the US1 checks in `specs/009-build-preset-support/quickstart.md`. Presets are visible, selectable, and persisted; nothing else in the extension has moved.
5. Demo if ready.

### Incremental Delivery

1. Setup + Foundational → preset inputs load, validate, and watch.
2. Add US1 → preset selection works and persists → demo (MVP).
3. Add US2 → Build Options become preset-relative → demo.
4. Add US3 → launched commands become preset-aware → demo.
5. Phase 6 → FR-029 docs plus the full verification pass.

### Parallel Team Strategy

The stories share the resolution module and the extension wiring, so a clean three-way split is not available. With multiple developers:

1. Everyone on Phase 1 + Phase 2 (fixtures and the parser/service split naturally).
2. Once Phase 2 lands: Developer A on US1, Developer B writing the US2 and US3 test suites (T031–T034, T039–T042) against the data-model contract while A finishes T025.
3. US2 and US3 implementation follow the chain in `User Story Dependencies`.
4. Documentation (T048, T049) can proceed alongside US3 once the argument forms are settled.

---

## Notes

- Tests are mandatory here (Constitution Principle III), not optional — this feature touches VS Code integration, manifest parsing, task execution, diagnostics, and persisted state, all of which the constitution names as requiring integration-level coverage.
- `[P]` tasks touch different files and depend on nothing incomplete; see `Same-File Serialization` for the pairs that must not be parallelized.
- The `Critical Detail Reconciliation` list in `specs/009-build-preset-support/plan.md` names the behaviors most likely to be approximated rather than implemented; each has a task above that enforces it.
- No task adds a user-facing setting, a contributed command, or a persistence store — those are explicit plan constraints.
- Commit after each task or logical group. Stop at any checkpoint to validate a story independently.
