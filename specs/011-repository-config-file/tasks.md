# Tasks: Repository Configuration File

**Input**: Design documents from `specs/011-repository-config-file/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/tf-tools-toml.md](contracts/tf-tools-toml.md), and [quickstart.md](quickstart.md)

**Tests**: Automated unit and extension-host integration tests are mandatory under the project constitution. Each user-story test task is scheduled before its implementation task.

**Organization**: Tasks are grouped by user story. The resolver foundation is deliberately small; each user-story phase then supplies an independently verifiable increment over that foundation.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the focused fixture layout and test entry points for root-level repository configuration.

- [X] T001 [P] Create valid and partial root-level TOML workspace fixtures in `test-fixtures/workspaces/repository-configuration-valid/tf-tools.toml` and `test-fixtures/workspaces/repository-configuration-partial/tf-tools.toml`
- [X] T002 [P] Create malformed TOML and wrong-supported-type workspace fixtures in `test-fixtures/workspaces/repository-configuration-invalid/tf-tools.toml` and `test-fixtures/workspaces/repository-configuration-wrong-type/tf-tools.toml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define one authoritative repository-configuration state contract that all path consumers can share.

**⚠️ CRITICAL**: Complete this phase before user-story work so no consumer independently reads a removed VS Code path setting.

- [X] T003 Define exported repository configuration defaults, resolved snapshot, validation issues, and `absent`/`loaded`/`invalid` state types in `src/workspace/repository-configuration.ts`

**Checkpoint**: A single configuration-state vocabulary exists for all path consumers, diagnostics, and workflow gating.

---

## Phase 3: User Story 1 - Commit Repository Paths (Priority: P1) 🎯 MVP

**Goal**: A valid root-level `tf-tools.toml` supplies all repository paths for manifest loading, presets, artifacts/IntelliSense, debug templates, and workflow task working directories.

**Independent Test**: Load a valid full configuration with distinguishable relative and absolute path values, then verify the resolved snapshot supplies all five consumers and literal `${...}` text remains unexpanded.

### Tests for User Story 1

- [X] T005 [P] [US1] Add TOML parsing and resolution tests for all five entries, relative and absolute paths, literal VS Code variables, and ignored unknown keys in `src/test/unit/workspace/repository-configuration.test.ts`
- [X] T006 [P] [US1] Add extension-host integration coverage proving a valid configuration supplies manifest, presets, artifacts, debug templates, and workflow cwd in `src/test/integration/repository-configuration.integration.test.ts`

### Implementation for User Story 1

- [X] T007 [US1] Implement TOML loading, supported-entry validation, literal path resolution, and immutable loaded snapshots in `src/workspace/repository-configuration.ts`
- [X] T008 [US1] Replace repository-path resolver exports in `src/workspace/settings.ts` and update `src/tasks/xtask-execution.ts` to consume the resolved repository configuration while retaining only task environment and UI settings
- [X] T009 [US1] Refactor activation and valid-snapshot application so `src/extension.ts` starts or restarts manifest and preset services, artifact/IntelliSense state, debug templates, and workflow context from one resolved snapshot
- [X] T010 [US1] Update artifact, debug, manifest, and preset path-facing messages and types to name repository configuration rather than removed VS Code settings in `src/commands/artifact-actions.ts`, `src/intellisense/artifact-resolution.ts`, `src/intellisense/intellisense-service.ts`, `src/intellisense/intellisense-types.ts`, `src/manifest/manifest-service.ts`, and `src/manifest/manifest-types.ts`
- [X] T011 [US1] Remove `tfTools.cargoWorkspacePath`, `tfTools.debug.templatesPath`, `tfTools.artifactsPath`, and `tfTools.manifestPath` contributions from `package.json` while preserving task-environment, status-bar, and excluded-file settings
- [X] T012 [US1] Update path-resolution and package-contribution expectations for direct `xtask-presets` resolution and removed settings in `src/test/unit/presets/preset-paths.test.ts`, `src/test/unit/workspace/configuration-variables.test.ts`, `src/test/integration/configuration-scope.integration.test.ts`, and `src/test/integration/debug-launch.integration.test.ts`

**Checkpoint**: A workspace maintainer can commit a valid `tf-tools.toml`; all repository-dependent paths use it, and the four legacy path settings are absent from the extension configuration surface.

---

## Phase 4: User Story 2 - Work With Older Or Partial Repositories (Priority: P2)

**Goal**: Missing and partial configuration files continue to use the defined defaults, with every empty-value behavior applied independently.

**Independent Test**: Resolve a missing file and a partial file, then assert defaults, workspace-root cargo behavior, disabled artifacts behavior, and defaulted empty manifest/debug/presets behavior without modifying VS Code settings.

### Tests for User Story 2

- [X] T013 [P] [US2] Add unit cases for absent files, per-entry defaults, and every specified empty-value behavior in `src/test/unit/workspace/repository-configuration.test.ts`
- [X] T014 [P] [US2] Add extension-host integration coverage for default and partial-file fallback with no legacy path-setting dependency in `src/test/integration/repository-configuration.integration.test.ts`

### Implementation for User Story 2

- [X] T015 [US2] Implement absent-file default snapshots and per-entry empty-value fallback rules in `src/workspace/repository-configuration.ts`
- [X] T016 [US2] Apply absent and partial snapshots through the same activation path in `src/extension.ts` so default manifest, preset, artifact, debug, and workflow behavior replaces no path with stale configuration

**Checkpoint**: Older repositories without `tf-tools.toml`, and repositories with partial configuration, remain usable with the defined defaults.

---

## Phase 5: User Story 3 - Correct Broken Configuration Without Reloading (Priority: P3)

**Goal**: A present invalid file blocks path-dependent extension behavior visibly and recovers live on correction, creation, change, or deletion.

**Independent Test**: Change valid configuration to malformed TOML and a wrong type, observe diagnostics/log/error/blocking with cleared paths, then correct and delete the file to verify live recovery to configured paths and defaults.

### Tests for User Story 3

- [X] T017 [P] [US3] Add unit tests for malformed TOML, unreadable input, invalid `[paths]` tables, and wrong supported entry types in `src/test/unit/workspace/repository-configuration.test.ts`
- [X] T018 [P] [US3] Add extension-host lifecycle tests for create/change/delete watching, diagnostics, error logging, invalid-to-valid recovery, and invalid-to-absent recovery in `src/test/integration/repository-configuration.integration.test.ts`

### Implementation for User Story 3

- [X] T019 [US3] Implement debounced root-file watching and blocking invalid state publication with anchored validation issues in `src/workspace/repository-configuration.ts`
- [X] T020 [US3] Add repository-configuration diagnostic and log state helpers, including clearing diagnostics when the file becomes absent or valid, publishing persistent error details, and showing one user-visible error per entered invalid state, in `src/observability/diagnostics.ts` and `src/observability/log-channel.ts`
- [X] T021 [US3] Apply invalid snapshots in `src/extension.ts` by disposing path-dependent services, clearing manifest/preset/artifact/IntelliSense/debug state, setting workflow blocking, and atomically restoring consumers when a loaded or absent snapshot returns

**Checkpoint**: A broken checked-in configuration cannot be mistaken for an absent file, and correcting or deleting it recovers the extension without a window reload.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalize compatibility documentation and validate the complete delivery against the user-facing contract.

- [X] T022 [P] Record removal of the four legacy path settings without a migration path in `CHANGELOG.md`
- [ ] T023 [P] Reconcile repository-configuration terminology and behavior against the delivered code in `specs/product-spec.md`, `specs/glossary.md`, and `README.md`
- [ ] T024 Run the quickstart validation commands and the full regression suite from `specs/011-repository-config-file/quickstart.md`
- [ ] T025 Perform a requirement-by-requirement self-review against `specs/011-repository-config-file/spec.md`, `specs/product-spec.md`, and `specs/glossary.md`, then record any necessary corrections in `specs/011-repository-config-file/tasks.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; T001 and T002 can run in parallel.
- **Foundational (Phase 2)**: Depends on setup; T003 provides the shared state types.
- **User Story 1 (Phase 3)**: Depends on T003. T005-T006 must fail before T007-T012. T007 precedes T008-T010; T009 applies the completed resolver; T011-T012 finalize removal of legacy settings and regressions.
- **User Story 2 (Phase 4)**: Depends on the shared service from T007 and snapshot application from T009. T013-T014 must fail before T015-T016.
- **User Story 3 (Phase 5)**: Depends on the full valid/default snapshot behavior from Phases 3-4. T017-T018 must fail before T019-T021; T020 provides the required observability implementation after the failing lifecycle tests exist.
- **Polish (Phase 6)**: Depends on the desired user stories being complete. T024 runs after T022-T023; T025 is last.

### User Story Dependencies

- **US1 (P1)**: Starts after the foundational state contract; delivers the MVP valid-file path configuration.
- **US2 (P2)**: Uses US1's repository-configuration service and snapshot application to verify default and partial behavior.
- **US3 (P3)**: Uses US1 and US2 snapshot handling to add invalid-state blocking and watcher-driven recovery.

### Parallel Opportunities

- T001 and T002 touch separate fixture directories and can run in parallel.
- T005 and T006 can run in parallel; T013 and T014 can run in parallel; T017 and T018 can run in parallel.
- T011 and T012 can run in parallel once the valid-snapshot integration is stable.
- T022 and T023 can run in parallel after behavior is complete.

---

## Parallel Example: User Story 1

```bash
Task: "T005 Add TOML parsing and resolution tests in src/test/unit/workspace/repository-configuration.test.ts"
Task: "T006 Add extension-host path-consumer coverage in src/test/integration/repository-configuration.integration.test.ts"

Task: "T011 Remove legacy path setting contributions from package.json"
Task: "T012 Update path and package regression tests in src/test/unit and src/test/integration"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete setup and the shared state contract.
2. Write and fail T005-T006.
3. Implement valid TOML parsing, resolution, atomic consumer integration, and removal of legacy settings through T007-T012.
4. Run the focused unit and integration tests to demonstrate a valid committed configuration drives all five path consumers.

### Incremental Delivery

1. Deliver US1 for valid committed configuration.
2. Add US2 to preserve older and partially configured repositories through explicit default behavior.
3. Add US3 for visible blocking errors and live recovery.
4. Finish documentation, release notes, complete regression validation, and self-review.

### Task Completion Discipline

Execute exactly one task at a time. Before marking a task complete, run its focused validation, compare the change with the feature specification and affected product documentation, update this checklist, and create the required single-task commit using the task identifier in its subject.