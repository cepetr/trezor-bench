# Implementation Plan: Multi-Root Workspace Support

**Branch**: `013-multi-root-workspace` | **Date**: 2026-10-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/013-multi-root-workspace/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

Replace the "first workspace folder" assumption with an explicit folder selection step that runs once at activation: the first folder in workspace order whose root holds `tbench.toml` or the built-in default manifest path becomes the selected folder, and the first folder is the fallback. Every folder-bound service already takes a `vscode.WorkspaceFolder`, so the bulk of the change is feeding the selected folder instead of `workspaceFolders[0]`, removing the folder-count blocking condition, scoping the one unscoped setting read (the cpptools provider check) to the selected folder, filtering Run and Debug entries to that folder, naming the folder in the status bar tooltip, and logging the selection reason. Folder-list changes re-run selection; when the result differs, the extension releases the folder (disposes watchers and services, clears runtime IntelliSense and Rust Analyzer state, blocks commands with a reload-required reason) and offers `Reload Window`. The constitution's single-root guardrail, `specs/product-spec.md`, `specs/glossary.md`, and the README are amended in the same change.

Affected product-spec areas: `Workspace Assumptions And Scope`, `Status Bar`, `IntelliSense` (`Compile Commands And Provider Integration`, `Excluded-File Visibility`, `Refresh And Warning Behavior`), `Rust Analyzer Configuration`, `Extension Configuration` (`Repository Path Configuration`), `Startup And Refresh Behavior` (`Activation`, `Other Refresh Triggers`), `Availability And Blocking Model` (`Shared Blocking Conditions`), and `Command Surface` (`Build`, `Clippy And Check`, `Clean`, `Flash And Upload`, `Start Debugging`). Required glossary terms: `the extension`, `workspace`, `workspace root`, `manifest`, `repository configuration`, `manifest path`, `preset`, `Configuration view`, `status bar item`, `log output`, `blocked command`, `IntelliSense`, `configuration provider`, `managed compile database`, `excluded-file scope`, `Rust Analyzer configuration`, `debug template`, `Start Debugging`, `Flash to Device`, `Upload to Device`. New glossary terms: `multi-root window`, `selected folder`, `folder selection reason`.

## Technical Context

**Language/Version**: TypeScript 5.8 targeting VS Code 1.105+ and Node.js in the desktop extension host

**Primary Dependencies**: VS Code Extension API (`workspace.workspaceFolders`, `workspace.onDidChangeWorkspaceFolders`, `workspace.getConfiguration(section, scope)`, `debug.startDebugging(folder, …)`, `DebugConfigurationProvider`, `StatusBarItem.tooltip`, `workbench.action.reloadWindow`), Node.js `fs` for marker-file presence probes, and the existing repository-configuration, manifest, preset, IntelliSense, Rust Analyzer, task, and debug services

**Storage**: VS Code workspace state, unchanged and still keyed per VS Code workspace (not per folder); managed `.tbench/compile_commands.json` and `.clangd` files under the selected folder's root; no new persisted state

**Testing**: Mocha unit tests against the `vscode` mock (`npm run test:unit`) plus `@vscode/test-electron` integration tests (`npm test`); `npm run lint` and `npm run compile`

**Target Platform**: VS Code 1.105+ desktop extension host on supported desktop operating systems

**Project Type**: Single-package VS Code extension

**Performance Goals**: Folder selection adds at most two synchronous file-presence probes per open folder at activation and per folder-list change; no new watchers, timers, or background work

**Constraints**: Exactly one selected folder; selection re-evaluated only at activation and on folder-list changes; no watching of marker paths in non-selected folders; release never reads from, writes to, launches tasks in, or starts debug sessions in a removed folder; services are not rebound in place, the new folder becomes active only after a window reload; single-root and no-folder behavior unchanged

**Scale/Scope**: One new pure selection module, one folder-change wiring module, one release routine in the composition root, one new block reason for workflow, artifact, and debug surfaces, one tooltip addition, one logging addition, and documentation amendments (constitution, product spec, glossary, README, changelog)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Design Gate

- **I. TypeScript Extension First — PASS**: All changes are TypeScript against stable VS Code 1.105 APIs. `workspaceFolders`, `onDidChangeWorkspaceFolders`, scoped `getConfiguration`, folder-scoped `startDebugging`, and `workbench.action.reloadWindow` are long-stable.
- **II. Manifest-Driven Behavior — PASS**: Folder selection uses only the presence of repository data (`tbench.toml` or the default manifest path); manifest, presets, artifacts, and debug templates still come from repository configuration resolved against the selected folder. No firmware matrix or alternate artifact inference is added.
- **III. Tests Are Mandatory — PASS WITH NOTE**: Selection, folder-change evaluation, block reasons and messages, status bar tooltip, cpptools setting scope, Run and Debug folder filtering, and log output receive unit coverage against the `vscode` mock and real temp directories. Integration-level coverage of folder-list changes is not feasible in the existing harness (it opens no workspace, and changing the first folder of a window restarts the extension host). Existing integration suites must pass unchanged to demonstrate single-root and no-folder parity. See `Complexity Tracking`.
- **IV. Failures Must Be Visible — PASS**: Selection and its reason are logged on activation and on every change; the released state shows a notification with a `Reload Window` action; blocked invocations name the reload requirement through the shared blocked behavior; Run and Debug resolution for a non-selected folder is logged and reported.
- **V. Keep It Small And Clear — PASS**: One pure selection function, one small wiring module, and a release routine in `extension.ts`. No per-folder sessions, no rebinding, no folder picker, no new persisted state.
- **VI. Code Must Stand Alone — PASS**: Source and tests describe folder selection, release, and reload in plain language without feature or requirement identifiers.
- **Technical Guardrails — AMENDMENT REQUIRED**: The guardrail "The extension may assume a single-root workspace unless a future amendment expands that scope" must be amended in the same change. The amended guardrail states that the extension operates against exactly one workspace folder, the selected folder, chosen as described in `specs/product-spec.md`, and never against several folders at once. This is a MINOR constitution version bump (1.8.0 → 1.9.0) because it expands project obligations.
- **Delivery workflow — PASS**: `specs/product-spec.md` and `specs/glossary.md` were read. The feature spec already carries their blocking rules, activation ordering, settings scope, debug template, status bar, and refresh details. Product-spec, glossary, README, and changelog updates are planned as explicit tasks.

### Post-Design Gate

Phase 1 preserves every pre-design result. The contract keeps repository data authoritative, defines the release state and its visible surfaces, and adds no behavior outside the affected product areas. The only exception recorded in `Complexity Tracking` is the test-level substitution for folder-list changes.

## Project Structure

### Documentation (this feature)

```text
specs/013-multi-root-workspace/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── multi-root-workspace.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── workspace/
│   ├── folder-selection.ts        # new: pure selection + same-folder comparison
│   ├── folder-change-wiring.ts    # new: onDidChangeWorkspaceFolders → unchanged | release
│   ├── workspace-guard.ts         # hasSupportedWorkspace only; folder-count guard removed
│   └── settings.ts                # unchanged (already folder-scoped)
├── commands/
│   ├── build-workflow.ts          # reload-required block reason; folder-count wording removed
│   ├── build-workflow-commands.ts # reloadRequired input; hasSupportedWorkspace
│   ├── artifact-actions.ts        # reload-required block reason
│   ├── artifact-actions-commands.ts
│   ├── debug-launch-commands.ts   # reload-required guard
│   └── command-deps.ts            # isReloadRequired()
├── intellisense/
│   ├── cpptools-backend.ts        # readiness check scoped to the selected folder
│   ├── intellisense-service.ts    # passes folder scope; release() clears runtime state
│   └── intellisense-wiring.ts     # workspace-change handler moves to folder-change wiring
├── debug/
│   ├── run-debug-provider.ts      # entries only for the selected folder; rejects others
│   └── run-debug-wiring.ts        # getWorkspaceFolder dep
├── ui/
│   ├── status-bar.ts              # optional selected-folder tooltip
│   └── context-keys.ts            # reloadRequired input; hasSupportedWorkspace
├── observability/log-channel.ts   # logFolderSelection / logFolderSelectionChange
├── extension.ts                   # select folder, log, wire change handler, release()
└── test/
    ├── unit/workspace/folder-selection.test.ts      # new
    ├── unit/workspace/folder-change.test.ts         # new
    ├── unit/workflow/preconditions.test.ts          # reload-required
    ├── unit/workflow/flash-upload-actions.test.ts   # reload-required
    ├── unit/workflow/intellisense-provider-readiness.test.ts  # scope
    ├── unit/workflow/run-debug-provider.test.ts     # folder filtering
    ├── unit/ui/status-bar.test.ts                   # tooltip
    └── unit/observability/                          # selection log lines

.specify/memory/constitution.md    # guardrail amendment, version 1.9.0
specs/product-spec.md              # affected sections updated
specs/glossary.md                  # workspace, workspace root, new terms
README.md                          # Workspace Requirements
CHANGELOG.md                       # Unreleased entry
```

**Structure Decision**: Keep the single extension package and the existing capability folders. Folder selection and folder-change handling live under `src/workspace/` beside the repository-configuration code they complement. Release logic stays in the composition root because it touches every module-owned service slot; no new service class is introduced.

## Implementation Design

### Folder Selection At Activation

1. `hasSupportedWorkspace()` keeps gating the no-folder path; that path is unchanged.
2. `selectWorkspaceFolder(folders, exists)` returns the first folder whose root contains `tbench.toml`, else the first folder whose root contains `core/embed/xtask/tf-tools/manifest.yaml` (the built-in default from `REPOSITORY_PATH_DEFAULTS.manifest`, never the `tbench.toml`-configured path), else the first folder. The result carries a reason: `repository-config`, `default-manifest`, or `fallback`. Presence is checked with `fs.existsSync`; file validity is not inspected.
3. The selection is logged immediately, before any workspace-specific state loads, and its folder replaces every current use of `workspaceFolders[0]` (`requireWorkspaceFolder` is deleted).
4. Everything downstream already receives a `vscode.WorkspaceFolder`: repository configuration, manifest and preset services, artifact watcher, IntelliSense, excluded files, Rust Analyzer runner and conflict inspection, task execution, and debug launch. No per-service changes are needed for binding.

### Blocking Model

- `isWorkflowWorkspaceSupported()` (exactly one folder) is removed. Workflow, artifact-action, and context-key evaluation pass `hasSupportedWorkspace()` as `workspaceSupported`, so `workspace-unsupported` now fires only when no folder is open. Its message drops the multi-root wording.
- A new `reload-required` reason is added to `WorkflowBlockReason` and `ArtifactActionBlockReason`, evaluated right after `workspace-unsupported` and before manifest checks, and fed from `CommandDeps.isReloadRequired()`. `Start Debugging` checks the same flag first and logs a `reload-required` debug-launch failure.
- `tbench.workflowBlocked` is set from the same inputs, so Configuration view header actions are disabled in the released state. `tbench.startDebuggingEnabled`, `tbench.flashApplicable`, and `tbench.uploadApplicable` are set false on release.

### Settings Scope

- `evaluateCpptoolsReadiness` reads `C_Cpp.default.configurationProvider` through `getConfiguration("C_Cpp", selectedFolder.uri)`, matching the scope `applyProviderSettingFix` already writes. The IntelliSense service passes its stored folder.
- All other `tbench` and `rust-analyzer` reads already take the folder URI; `onDidChangeConfiguration` checks already pass it. No other change.

### Debugging

- `executeDebugLaunch` already calls `debug.startDebugging(selectedFolder, …)`, so `${workspaceFolder}` resolves to the selected folder regardless of the active editor.
- `RunDebugConfigProvider` gains a `getWorkspaceFolder` getter. `provideDebugConfigurations(folder)` returns entries only when `folder` is the selected folder, so a multi-root Run and Debug picker shows Trezor Bench entries once, under the selected folder. `resolveDebugConfiguration` rejects a tbench configuration for any other folder or while released, with a logged and notified failure.
- Debug templates are read from `resolveDebugTemplatesPath(selectedFolder)`, unchanged.

### Status Bar And Logging

- `StatusBarPresenter.update` takes an optional selected-folder name. When provided (only when more than one folder is open at refresh time), the tooltip reads `Selected folder: <name>`; otherwise the tooltip is cleared, preserving single-root behavior.
- `logFolderSelection(selection)` writes `Selected workspace folder: <path> — <reason text>` on activation. `logFolderSelectionChange(previous, next)` writes the previous folder, the new folder or `none`, the new reason, and that a reload is required.

### Folder List Changes And Release

1. `registerFolderChangeWiring` subscribes once to `onDidChangeWorkspaceFolders`. It re-runs `selectWorkspaceFolder` over the current folders and compares the result to the selected folder by URI.
2. Same folder: schedule the existing `workspace-change` IntelliSense refresh (moved here from `intellisense-wiring.ts`) and refresh the status bar so the tooltip tracks the folder count.
3. Different folder or none: log the change and call `release()` once; later folder events are ignored while released.
4. `release()` in `extension.ts`, in order: set the reload-required flag; dispose the repository-config service (stops the `tbench.toml` watcher and poller) and the manifest and preset services and subscriptions; dispose the artifact file watcher; call `IntelliSenseService.release()` (clears the cpptools payload, publishes a null payload so exclusion badges and overlays clear, marks runtime state cleared) and dispose it; stop the Rust Analyzer service (registers `{}`); clear manifest, preset, selection, and resolved-option state; hide the status bar; set the blocked context keys; show a warning notification with a `Reload Window` action that runs `workbench.action.reloadWindow`.
5. Managed on-disk files (`.tbench/compile_commands.json`, `.clangd`) are not touched on release: removing them would write under a folder that may have been removed. They are reconciled on the next activation of that folder, as the existing clear path already handles a link left by a previous session.
6. Command handlers stay registered; the task provider's `getWorkspaceFolder` returns `undefined` while released so no tasks are provided; the Run and Debug provider returns no entries and rejects resolution.

### Critical Product-Spec Details To Preserve

- Selection checks presence only; an invalid `tbench.toml` still qualifies its folder and then enters the existing blocking repository-configuration error state.
- Marker files in non-selected folders are never watched; the only selection triggers are activation and `onDidChangeWorkspaceFolders`.
- `workspace-unsupported` precedes `reload-required`, so removing the last folder reports the existing no-folder message while still being released.
- Excluded-file candidates come from `findFiles(new RelativePattern(selectedFolder, glob))`, so files in other folders never receive badges or overlays; the test must assert this with a second folder.
- Persisted state stays per VS Code workspace; nothing is keyed by folder.
- The single-root tooltip stays empty; the folder name is added only when more than one folder is open.
- A running workflow task continues under VS Code's ownership after release; the extension launches no further tasks.

### Verification Strategy

- Pure tests: selection order and reasons with injected presence probes and with real temp directories; same-folder comparison; folder-change evaluation (added, removed, reordered, unchanged, last removed).
- Precondition tests: `reload-required` ordering and messages for workflow and artifact actions; `workspace-unsupported` message no longer mentions multi-root.
- Readiness tests: cpptools check reads the provider setting with the selected folder scope and reports based on that scope only.
- Provider tests: Run and Debug entries are produced only for the selected folder; resolution for another folder or while released is rejected and logged.
- Status bar tests: tooltip present with the folder name in multi-root, absent in single-root.
- Log tests: selection and change lines include path and reason.
- Integration: all existing suites pass unchanged (single-root and no-folder parity). Manual multi-root validation per `quickstart.md`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| No integration-level coverage for folder-list changes (Principle III asks for it where feasible) | The integration harness opens no workspace folder, and VS Code restarts the extension host when the first folder of a window is added, removed, or changed, so `updateWorkspaceFolders`-driven tests cannot observe the release path. | Adding a second electron harness that opens a multi-root `.code-workspace` fixture would duplicate the test runner and change what every existing suite sees; the release path is instead covered by unit tests with injected folder lists and by the manual quickstart. |
