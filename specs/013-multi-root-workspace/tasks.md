---

description: "Task list for Multi-Root Workspace Support"
---

# Tasks: Multi-Root Workspace Support

**Input**: Design documents from `specs/013-multi-root-workspace/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/multi-root-workspace.md, quickstart.md

**Tests**: Included. The constitution (Principle III, Tests Are Mandatory) requires unit coverage for new behavior. Tests run against the `vscode` mock with `npm run test:unit`; integration suites (`npm test`) must pass unchanged for single-root and no-folder parity but cannot run in the sandbox.

**Organization**: Tasks are grouped by user story so each story can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US6)
- Every task names the exact file(s) it touches

## Path Conventions

Single-package VS Code extension: source in `src/`, unit tests in `src/test/unit/`, integration tests in `src/test/integration/`, consolidated docs in `specs/`.

---

## Phase 1: Setup (Governance)

**Purpose**: Lift the single-root guardrail before code that violates it lands.

- [X] T001 Amend the Technical Guardrails bullet "The extension may assume a single-root workspace unless a future amendment expands that scope" in `.specify/memory/constitution.md` to "The extension operates against exactly one workspace folder, the selected folder, chosen as described in `specs/product-spec.md`; it never operates against several folders at once." Bump the version line to `1.9.0` (MINOR), set `Last Amended` to 2026-10-18, and prepend a sync impact report (`Version change: 1.8.0 -> 1.9.0`, modified section Technical Guardrails, dependent docs `specs/product-spec.md`, `specs/glossary.md`, `README.md`).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure folder-selection module and test-mock support that every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 [P] Extend the unit-test mock in `src/test/unit/vscode-mock.ts`: make `workspace.getConfiguration(section, scope)` record the `section` and `scope` arguments of each call (exposed for assertions, e.g. a `lastGetConfigurationCall` field or a call log reset in `src/test/unit/setup.ts`) while keeping the existing default behavior, and add `workspace.onDidChangeWorkspaceFolders` as a mock event whose listeners tests can fire. Keep `workspaceFolders` defaulting to `undefined`.
- [X] T003 [P] Create `src/workspace/folder-selection.ts` exporting `type FolderSelectionReason = "repository-config" | "default-manifest" | "fallback"`, `interface FolderSelection { folder: vscode.WorkspaceFolder; reason: FolderSelectionReason }`, `selectWorkspaceFolder(folders: readonly vscode.WorkspaceFolder[] | undefined, exists: (fsPath: string) => boolean = fs.existsSync): FolderSelection | undefined`, and `isSameFolder(a: vscode.WorkspaceFolder, b: vscode.WorkspaceFolder): boolean` (compares `uri.toString()`). Selection: first pass returns the first folder whose root contains `tbench.toml` (`repository-config`); second pass returns the first folder whose root contains `REPOSITORY_PATH_DEFAULTS.manifest` from `src/workspace/repository-config.ts` (`default-manifest`; never the `tbench.toml`-configured path); otherwise the first folder (`fallback`); `undefined` when the list is empty or undefined. Presence only, no file is read. Also export `describeFolderSelectionReason(reason)` returning `tbench.toml found`, `default manifest found`, or `no folder qualified; using the first folder`.
- [X] T004 Create `src/test/unit/workspace/folder-selection.test.ts` covering, with injected `exists` probes: `tbench.toml` in the second folder beats default manifest in the first; default manifest in a later folder when no folder has `tbench.toml`; several qualifying folders → first in workspace order; none qualify → first folder with `fallback`; single folder; empty and undefined lists → `undefined`; `isSameFolder` true for equal URIs and false otherwise; reason texts. Add one case with real temp directories (`fs.mkdtempSync`) containing an empty/invalid `tbench.toml` to prove presence-only selection. Run `npm run test:unit` (depends on T003).

**Checkpoint**: `selectWorkspaceFolder` is available and tested; user stories can start.

---

## Phase 3: User Story 1 - Work Against the trezor-firmware Folder in a Multi-Root Window (Priority: P1) 🎯 MVP

**Goal**: Bind every service to the selected folder instead of `workspaceFolders[0]`, and stop blocking workflows and artifact actions because several folders are open.

**Independent Test**: With an unrelated first folder and a `trezor-firmware` second folder, panes fill from the second folder and `Build` launches with it as the working location (quickstart › Selection In A Multi-Root Window, Workflows And Artifact Actions). Unit-level: precondition tests show multi-root inputs no longer produce `workspace-unsupported`.

### Tests for User Story 1

- [X] T005 [P] [US1] Update `src/test/unit/workflow/preconditions.test.ts`: replace assertions that a multi-folder workspace yields `workspace-unsupported` with assertions that `workspaceSupported: true` (any folder open) proceeds to the existing manifest/preset checks; assert the `workspace-unsupported` message reads `Build Workflow requires an open workspace folder.` and no longer mentions multi-root.
- [X] T006 [P] [US1] Update `src/test/unit/workflow/flash-upload-actions.test.ts`: remove/replace any multi-root-blocks assertion so that with `workspaceSupported: true` Flash and Upload evaluation proceeds to artifact checks; keep the existing `workspace-unsupported` message `Trezor Bench requires an open workspace folder.`

### Implementation for User Story 1

- [X] T007 [US1] In `src/workspace/workspace-guard.ts` delete `requireWorkspaceFolder` and `isWorkflowWorkspaceSupported`; keep `hasSupportedWorkspace` and reword its doc comment to "at least one workspace folder is open" (no single-root wording).
- [X] T008 [P] [US1] In `src/commands/build-workflow.ts` change the `workspace-unsupported` message in the block-message map (around line 191) to `Build Workflow requires an open workspace folder.` and drop any multi-root/single-root wording from it and from the priority-order doc comment near line 162.
- [X] T009 [P] [US1] Replace `isWorkflowWorkspaceSupported()` with `hasSupportedWorkspace()` for `workspaceSupported` in `src/commands/build-workflow-commands.ts` (line ~45), `src/commands/artifact-actions-commands.ts` (line ~37), and `src/ui/context-keys.ts` (line ~39), updating imports.
- [X] T010 [US1] In `src/extension.ts` replace `requireWorkspaceFolder()` (line ~154) with `const selection = selectWorkspaceFolder(vscode.workspace.workspaceFolders)!;` (safe after the `hasSupportedWorkspace()` guard) and `const workspaceFolder = selection.folder;`, updating imports. Leave every downstream use of `workspaceFolder` unchanged (repository config, manifest/preset services, artifact watcher, IntelliSense, excluded files, Rust Analyzer runner and `inspectSetting`, task wiring, Run and Debug, `commandDeps`). Keep `selection` in scope for US3 and US4.
- [X] T011 [US1] Grep `src/` (excluding tests) for any remaining `workspaceFolders[0]`, `workspaceFolders?.[0]`, or unscoped `vscode.workspace.rootPath` use and route it through the selected folder; confirm none remain besides `src/workspace/folder-selection.ts`. Run `npm run lint`, `npm run compile`, `npm run test:unit`.

**Checkpoint**: In a multi-root window the extension loads from and runs workflows against the selected folder; single-root behavior is unchanged.

---

## Phase 4: User Story 2 - Every Capability Follows the Selected Folder (Priority: P1)

**Goal**: Status bar names the selected folder in multi-root windows; excluded-file marking, IntelliSense, and Rust Analyzer are proven bound to the selected folder only.

**Independent Test**: With `trezor-firmware` as the second folder, IntelliSense, managed compile database, excluded-file badges, Rust Analyzer, and the status bar reflect that folder, and files in the first folder carry no exclusion badge (quickstart › IntelliSense, Excluded Files, And Rust Analyzer).

### Tests for User Story 2

- [X] T012 [P] [US2] In `src/test/unit/ui/status-bar.test.ts` add cases: `update(state, ctx, true, "trezor-firmware")` sets `tooltip` to `Selected folder: trezor-firmware`; `update(state, ctx, true)` (no folder name) leaves `tooltip` `undefined`; a call without the name after one with it clears the tooltip.
- [X] T013 [P] [US2] In `src/test/unit/workflow/excluded-files-refresh.test.ts` add a case with two workspace folders where the mocked `findFiles` returns results only for the `RelativePattern` base it is given: assert `findFiles` is called only with patterns based on the selected folder, and a file under the other folder that matches the same glob is not in the excluded set.
- [X] T014 [P] [US2] In `src/test/unit/workflow/intellisense-service.test.ts` (or `clangd-backend.test.ts` if the managed-path logic lives there) add a case where the service's workspace folder is a non-first folder and assert the managed `.tbench/compile_commands.json` link and `.clangd` paths are computed under that folder's `uri.fsPath`.

### Implementation for User Story 2

- [X] T015 [US2] In `src/ui/status-bar.ts` add an optional fourth parameter `selectedFolderName?: string` to `StatusBarPresenter.update`; when visible set `this._item.tooltip = selectedFolderName ? \`Selected folder: ${selectedFolderName}\` : undefined`. Update the doc comment.
- [X] T016 [US2] In `src/extension.ts` `refreshStatusBar` pass `(vscode.workspace.workspaceFolders?.length ?? 0) > 1 ? workspaceFolder.name : undefined` as the new argument to `_statusBar?.update(...)`.
- [X] T017 [US2] Verify (no change expected) that `src/intellisense/excluded-files-refresh.ts` builds candidates via `new vscode.RelativePattern(workspaceFolder, relativeGlob)` and that `src/build/artifact-file-watcher.ts`, `src/manifest/manifest-service.ts`, `src/presets/preset-service.ts`, and `src/workspace/repository-config.ts` watchers are rooted at the folder they are given; fix any watcher that uses a bare-string glob (which would match across all folders). Run `npm run test:unit`.

**Checkpoint**: All capabilities reflect the selected folder; the status bar tooltip names it only in multi-root windows.

---

## Phase 5: User Story 3 - Understand Which Folder Was Chosen (Priority: P2)

**Goal**: Log the selected folder and the reason at activation; provide the change log line for US4.

**Independent Test**: Open a multi-root window, run `Trezor Bench: Show Logs`, and read the selected folder and reason (quickstart › Selection In A Multi-Root Window).

### Tests for User Story 3

- [X] T018 [P] [US3] In `src/test/unit/observability/log-channel.test.ts` add cases: `logFolderSelection` writes `Selected workspace folder: <fsPath> — tbench.toml found` / `— default manifest found` / `— no folder qualified; using the first folder`; `logFolderSelectionChange(previous, next)` writes `Workspace folder selection changed: <old fsPath> → <new fsPath> — <reason text>; reload the window to continue.` and, for `next` undefined, `Workspace folder selection changed: <old fsPath> → none; reload the window to continue.`

### Implementation for User Story 3

- [X] T019 [US3] In `src/observability/log-channel.ts` add `logFolderSelection(selection: FolderSelection)` and `logFolderSelectionChange(previous: vscode.WorkspaceFolder, next: FolderSelection | undefined)` producing the exact lines from `contracts/multi-root-workspace.md` › Log Output, using `describeFolderSelectionReason` from `src/workspace/folder-selection.ts` and the existing `log` helper.
- [X] T020 [US3] In `src/extension.ts` call `logFolderSelection(selection)` immediately after the selection is computed (T010) and before any workspace-specific service is created.

**Checkpoint**: Activation log names the selected folder and why.

---

## Phase 6: User Story 4 - Folder List Changes Are Handled Safely (Priority: P2)

**Goal**: Re-run selection on folder-list changes; on a different result, release the folder, block commands with a reload-required reason, and offer `Reload Window`.

**Independent Test**: Remove the selected folder: no workflow launches against it, header actions disable, a `Reload Window` notification appears, and `Build`/`Flash to Device`/`Start Debugging` report that a reload is required (quickstart › Folder-List Changes).

### Tests for User Story 4

- [X] T021 [P] [US4] Create `src/test/unit/workspace/folder-change.test.ts` for the pure evaluator `evaluateFolderChange(current, folders, exists)` (T026): unchanged when a non-qualifying folder is appended; unchanged when folders are reordered but the same folder is still selected; `{ next }` when a qualifying folder is added before a fallback selection; `{ next }` when reordering puts a different qualifying folder first; `{ next }` when the selected folder is removed; `{ next: undefined }` when the last folder is removed. Also test `registerFolderChangeWiring` via the mock `onDidChangeWorkspaceFolders`: unchanged → `onUnchanged` called; changed → `onRelease(next)` called exactly once and later events ignored.
- [X] T022 [P] [US4] In `src/test/unit/workflow/preconditions.test.ts` add `reloadRequired: true` cases: yields `reload-required` when the workspace is supported; `workspace-unsupported` still wins when no folder is open; `reload-required` precedes `manifest-missing`; message equals `Build Workflow is blocked: the workspace folder Trezor Bench was using has changed. Reload the window to continue.`
- [X] T023 [P] [US4] In `src/test/unit/workflow/flash-upload-actions.test.ts` add the same `reload-required` precedence and message cases for artifact actions with message `The workspace folder Trezor Bench was using has changed. Reload the window to continue.`
- [X] T024 [P] [US4] In `src/test/unit/workflow/intellisense-service.test.ts` add a `release()` case: after release the cpptools payload is cleared, `onDidRefreshPayload` fires a null payload (so excluded-file badges/overlays clear), and subsequent `scheduleRefresh` calls perform no refresh and no file I/O.
- [X] T025 [P] [US4] In `src/test/unit/tasks/build-task-provider.test.ts` add a case asserting `provideTasks` returns `[]` when `getWorkspaceFolder` returns `undefined`.

### Implementation for User Story 4

- [X] T026 [US4] Create `src/workspace/folder-change-wiring.ts` exporting `type FolderChangeOutcome = "unchanged" | { next: FolderSelection | undefined }`, pure `evaluateFolderChange(current: vscode.WorkspaceFolder, folders: readonly vscode.WorkspaceFolder[] | undefined, exists?): FolderChangeOutcome` (uses `selectWorkspaceFolder` and `isSameFolder`), and `registerFolderChangeWiring(context, current, { onUnchanged(): void; onRelease(next: FolderSelection | undefined): void })` that subscribes once to `vscode.workspace.onDidChangeWorkspaceFolders`, calls `onUnchanged` or (once) `onRelease`, and ignores all events after release.
- [X] T027 [US4] In `src/commands/build-workflow.ts` add `"reload-required"` to `WorkflowBlockReason`, add `reloadRequired: boolean` to the precondition input, evaluate it immediately after `workspace-unsupported` and before `manifest-missing`, add the message `Build Workflow is blocked: the workspace folder Trezor Bench was using has changed. Reload the window to continue.`, and update the priority-order doc comment.
- [X] T028 [P] [US4] In `src/commands/artifact-actions.ts` add `"reload-required"` to `ArtifactActionBlockReason` and the input, evaluated right after `workspace-unsupported`, with message `The workspace folder Trezor Bench was using has changed. Reload the window to continue.`
- [X] T029 [US4] In `src/commands/command-deps.ts` add `isReloadRequired(): boolean` to `CommandDeps`; pass `reloadRequired: deps.isReloadRequired()` in `src/commands/build-workflow-commands.ts` and `src/commands/artifact-actions-commands.ts`; in `src/ui/context-keys.ts` accept a `reloadRequired` input and feed it into the `tbench.workflowBlocked` evaluation (update its callers in `src/extension.ts`). Fix any unit-test `CommandDeps` fixtures (e.g. `src/test/unit/workflow-test-helpers.ts`) to supply `isReloadRequired: () => false` (depends on T027, T028).
- [X] T030 [US4] In `src/commands/debug-launch-commands.ts` check `deps.isReloadRequired()` first in the `tbench.startDebugging` handler: call `logDebugLaunchFailure("reload-required", { detail: ... })`, `revealLogs()`, and `notifyError("Cannot start debugging: the workspace folder Trezor Bench was using has changed. Reload the window to continue.")`, then return. Add `"reload-required"` to the debug-launch failure kind union in `src/observability/log-channel.ts` (or wherever `logDebugLaunchFailure`'s kind type is declared).
- [X] T031 [US4] In `src/intellisense/intellisense-service.ts` add `release()`: mark the service released, clear the cpptools custom-configuration payload, fire `onDidRefreshPayload` with a null payload, clear runtime IntelliSense state, and make `scheduleRefresh` and any pending debounced refresh no-ops afterwards. Do not touch `.tbench/compile_commands.json` or `.clangd` on disk.
- [X] T032 [US4] Move the `onDidChangeWorkspaceFolders` subscription out of `src/intellisense/intellisense-wiring.ts` (lines ~84-88) and update the surrounding comment; the `workspace-change` refresh is now scheduled from the folder-change wiring's `onUnchanged`.
- [X] T033 [US4] In `src/extension.ts` add a module-owned `_reloadRequired = false` flag, set `isReloadRequired: () => _reloadRequired` on `commandDeps`, change the task wiring `getWorkspaceFolder` to `() => (_reloadRequired ? undefined : workspaceFolder)`, and implement a `release()` closure that, in order: sets `_reloadRequired = true`; disposes `repositoryConfigService` (watcher and poller), `_manifestStateSubscription`, `_manifestService`, `_presetStateSubscription`, `_presetService`, and `_artifactFileWatcher`; calls `_intelliSenseService?.release()` then disposes it; stops the Rust Analyzer service via `stopRustAnalyzerConfiguration` (registers `{}`); clears `_manifestState`, `_presetState`, `_buildSelection`, and resolved options; hides the status bar; sets context keys `tbench.workflowBlocked=true`, `tbench.startDebuggingEnabled=false`, `tbench.flashApplicable=false`, `tbench.uploadApplicable=false`, `tbench.binaryExists=false`, `tbench.mapExists=false`; and shows `vscode.window.showWarningMessage("Trezor Bench: The workspace folder Trezor Bench was using has changed. Reload the window to continue.", "Reload Window")` that runs `workbench.action.reloadWindow` when chosen (use the existing notify helper if it supports actions, keeping the `Trezor Bench:` prefix convention). Guard slot-based callbacks (`refreshStatusBar`, `refreshBuildArtifacts`, `refreshArtifactFileWatcher`, `refreshRustAnalyzer`) so they do nothing once released.
- [X] T034 [US4] In `src/extension.ts` call `registerFolderChangeWiring(context, workspaceFolder, { onUnchanged: () => { _intelliSenseService?.scheduleRefresh("workspace-change"); refreshStatusBar(); }, onRelease: (next) => { logFolderSelectionChange(workspaceFolder, next); release(); } })` after services are wired (depends on T019, T026, T031, T032, T033). Run `npm run lint`, `npm run compile`, `npm run test:unit`.

**Checkpoint**: Folder-list changes either keep running against the same folder or release it and require a reload; no work targets a removed folder.

---

## Phase 7: User Story 5 - Folder-Scoped Settings Agree With Their Fixes (Priority: P3)

**Goal**: The cpptools configuration-provider check reads the same folder scope the fix writes.

**Independent Test**: With the selected folder not first, trigger the provider warning, apply the fix, refresh, and the warning is gone; a wrong value only in an unrelated folder produces no warning (quickstart › Provider Fix Scope).

### Tests for User Story 5

- [X] T035 [P] [US5] In `src/test/unit/workflow/intellisense-provider-readiness.test.ts` (and `cpptools-backend.test.ts` if readiness is tested there) assert via the T002 mock call log that `evaluateCpptoolsReadiness(folder)` calls `getConfiguration("C_Cpp", folder.uri)`, and that `checkProviderReadiness(folder)` / `resolveIntelliSenseBackend(folder)` pass the folder through; assert the readiness result follows the scoped value only.

### Implementation for User Story 5

- [X] T036 [US5] In `src/intellisense/cpptools-backend.ts` change `evaluateCpptoolsReadiness()` to `evaluateCpptoolsReadiness(workspaceFolder: vscode.WorkspaceFolder)` and read `vscode.workspace.getConfiguration("C_Cpp", workspaceFolder.uri)` (line ~100), matching `applyProviderSettingFix` (line ~142).
- [X] T037 [US5] In `src/intellisense/intellisense-backend.ts` add a `workspaceFolder` parameter to `resolveIntelliSenseBackend` and `checkProviderReadiness` and pass it to `evaluateCpptoolsReadiness`; in `src/intellisense/intellisense-service.ts` pass the stored `_workspaceFolder` at every call site (skip the readiness check when it is undefined); update any other callers found by grep. Run `npm run compile` and `npm run test:unit`.

**Checkpoint**: Check and fix address the same folder scope.

---

## Phase 8: User Story 6 - Debugging Starts in the Selected Folder (Priority: P3)

**Goal**: Run and Debug entries appear only under the selected folder and resolve only there; `Start Debugging` stays scoped to the selected folder.

**Independent Test**: With a file from the unrelated folder active, `Start Debugging` scopes the session to `trezor-firmware`, and the Run and Debug picker lists Trezor Bench entries only under it (quickstart › Debugging).

### Tests for User Story 6

- [X] T038 [P] [US6] In `src/test/unit/workflow/run-debug-provider.test.ts` add cases: `provideDebugConfigurations(selected)` returns entries; `provideDebugConfigurations(other)` and `provideDebugConfigurations(undefined)` return `[]`; when the folder getter returns `undefined` (released) every folder returns `[]`; `resolveDebugConfiguration(other, tbenchConfig)` returns `undefined`, logs `wrong-folder`, and notifies an error; resolution while released logs `reload-required`; non-tbench configurations pass through untouched.
- [X] T039 [P] [US6] In `src/test/unit/workflow/execute-debug-launch.test.ts` add or confirm a case asserting `debug.startDebugging` receives the passed-in (non-first) workspace folder as its first argument.

### Implementation for User Story 6

- [X] T040 [US6] In `src/debug/run-debug-provider.ts` add a `getWorkspaceFolder: () => vscode.WorkspaceFolder | undefined` constructor parameter. `provideDebugConfigurations(folder)` returns `[]` unless the getter returns a folder and `folder` is that folder (`isSameFolder`). `resolveDebugConfiguration` for `type: tbench` first rejects when the getter returns `undefined` (`logProviderDebugLaunchFailure("reload-required", …)`, `revealLogs()`, `notifyError("Cannot start debugging: the workspace folder Trezor Bench was using has changed. Reload the window to continue.")`) or when `folder` is defined and not the selected folder (`logProviderDebugLaunchFailure("wrong-folder", …)` with a message naming the selected folder). Add both kinds to the provider failure kind union in `src/observability/log-channel.ts`.
- [X] T041 [US6] In `src/debug/run-debug-wiring.ts` add `getWorkspaceFolder` to `RunDebugWiringDeps` and pass it to the provider; in `src/extension.ts` supply `getWorkspaceFolder: () => (_reloadRequired ? undefined : workspaceFolder)` (uses the US4 flag; if US6 lands first, pass `() => workspaceFolder`). Run `npm run compile` and `npm run test:unit`.

**Checkpoint**: Debug sessions and Run and Debug entries are scoped to the selected folder.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Consolidated documentation and final verification required by the Delivery Workflow.

- [X] T042 [P] Update `specs/product-spec.md` sections `Workspace Assumptions And Scope`, `Status Bar` › `Displayed Information` (tooltip), `IntelliSense` (`Compile Commands And Provider Integration`, `Excluded-File Visibility`, `Refresh And Warning Behavior`), `Rust Analyzer Configuration` (multi-root sentence), `Extension Configuration` › `Repository Path Configuration`, `Startup And Refresh Behavior` (`Activation`, `Other Refresh Triggers`), `Availability And Blocking Model` › `Shared Blocking Conditions` (no folder-count block; reload-required condition), and `Command Surface` › `Start Debugging`, describing folder selection, the released state, and reload behavior per `contracts/multi-root-workspace.md`.
- [X] T043 [P] Update `specs/glossary.md`: redefine `workspace` and `workspace root` to refer to the selected folder; add `multi-root window`, `selected folder`, and `folder selection reason` using the definitions in `spec.md` › Key Entities.
- [X] T044 [P] Update `README.md` › `Workspace Requirements`: multi-root windows are supported; Trezor Bench selects one `trezor-firmware` folder (first with `tbench.toml`, else first with the default manifest, else the first folder) and ignores the others; changing which folder qualifies requires a window reload.
- [X] T045 [P] Add under `## Unreleased` › `### Added` in `CHANGELOG.md`: "Multi-root windows are now supported. Trezor Bench finds the `trezor-firmware` folder among the open folders and works against it; other folders are ignored."
- [X] T046 Sweep `src/` comments and test names for leftover single-root/multi-root wording (e.g. `src/workspace/workspace-guard.ts`, `src/commands/unsupported-workspace-commands.ts`) and for feature/requirement identifiers per Principle VI; fix only wording made stale by this feature.
- [X] T047 Run `npm run lint`, `npm run compile`, and `npm run test:unit`; all must pass. Attempt `npm test` and record whether the integration suites pass or are blocked by the environment.
- [ ] T048 Manually validate per `specs/013-multi-root-workspace/quickstart.md` (selection, workflows, IntelliSense/excluded files/Rust Analyzer, provider fix scope, debugging, fallback, folder-list changes, single-root parity) and note any deviation.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup; blocks all stories.
- **US1 (Phase 3)**: after Foundational. Defines `selection`/`workspaceFolder` in `extension.ts` that every later story uses.
- **US2 (Phase 4)**: after US1 (T016 edits `refreshStatusBar` next to T010).
- **US3 (Phase 5)**: after US1 (T020 needs `selection`).
- **US4 (Phase 6)**: after US1 and US3 (T034 calls `logFolderSelectionChange` from T019).
- **US5 (Phase 7)**: after Foundational (T002 mock); independent of US1–US4 in code.
- **US6 (Phase 8)**: after US1; T041 uses the US4 reload flag when present.
- **Polish (Phase 9)**: after all desired stories.

### User Story Dependencies

```text
Setup → Foundational → US1 ─┬─ US2
                            ├─ US3 ── US4 ── US6 (flag)
                            └─ US6 (folder filter)
           Foundational ─────── US5
```

### Within Each User Story

- Write tests first and confirm they fail, then implement.
- Pure modules before wiring; wiring in `src/extension.ts` last.
- `src/extension.ts` tasks (T010, T016, T020, T033, T034, T041) are sequential; never run two in parallel.

### Parallel Opportunities

- T002 and T003 (different files).
- US1: T005, T006, T008, T009 in parallel.
- US2: T012, T013, T014 in parallel.
- US4: T021–T025 in parallel; T027 and T028 in parallel.
- US5 can proceed entirely in parallel with US1–US4.
- Polish: T042–T045 in parallel.

---

## Parallel Example: User Story 4

```bash
# Tests first, all in different files:
Task: "folder-change evaluator + wiring tests in src/test/unit/workspace/folder-change.test.ts"
Task: "reload-required workflow cases in src/test/unit/workflow/preconditions.test.ts"
Task: "reload-required artifact cases in src/test/unit/workflow/flash-upload-actions.test.ts"
Task: "IntelliSenseService.release() case in src/test/unit/workflow/intellisense-service.test.ts"
Task: "empty task list case in src/test/unit/tasks/build-task-provider.test.ts"

# Then the two block-reason additions together:
Task: "reload-required in src/commands/build-workflow.ts"
Task: "reload-required in src/commands/artifact-actions.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (constitution) and Phase 2 (selection module).
2. Phase 3: bind to the selected folder and lift the folder-count block.
3. **Stop and validate**: `npm run test:unit`, then quickstart › Selection and Workflows in a two-folder window.

### Incremental Delivery

1. US1 → usable multi-root support (MVP).
2. US2 → tooltip and proof that IntelliSense/excluded files/Rust Analyzer follow the folder.
3. US3 → selection is explainable from logs.
4. US4 → safe folder-list changes with release and reload.
5. US5 → provider warning clears after its fix.
6. US6 → Run and Debug scoped to the selected folder.
7. Polish → docs and final verification.

---

## Notes

- Do not remove managed on-disk files (`.tbench/compile_commands.json`, `.clangd`) on release.
- Persisted state stays per VS Code workspace; nothing is keyed by folder.
- Never watch `tbench.toml` or manifest paths in non-selected folders.
- Single-root tooltip stays unset; existing integration suites must pass unchanged.
