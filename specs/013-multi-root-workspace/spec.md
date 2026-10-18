# Feature Specification: Multi-Root Workspace Support

**Feature Branch**: `[013-multi-root-workspace]`

**Created**: 2026-10-18

**Status**: Draft

**Input**: User description: "Multi-root workspace support: locate the trezor-firmware folder. Today Trezor Bench always uses the first workspace folder and blocks Build, Clippy, Check, Clean, Flash, and Upload whenever more than one folder is open. Users who keep trezor-firmware open next to unrelated folders (notes, trezor-suite, scratch repos) cannot use the extension, or get panes filled from the wrong folder. Goal: in a multi-root window, Trezor Bench finds the one trezor-firmware folder and works fully against it. Other folders are ignored."

**Affected Product Areas**: `Workspace Assumptions And Scope`, `Status Bar`, `IntelliSense` (`Compile Commands And Provider Integration`, `Excluded-File Visibility`, `Refresh And Warning Behavior`), `Rust Analyzer Configuration`, `Extension Configuration` (`Repository Path Configuration`), `Startup And Refresh Behavior` (`Activation`, `Other Refresh Triggers`), `Availability And Blocking Model` (`Shared Blocking Conditions`), and `Command Surface` (`Build`, `Clippy And Check`, `Clean`, `Flash And Upload`, `Start Debugging`) in `specs/product-spec.md`. Glossary terms used: `the extension`, `workspace`, `workspace root`, `manifest`, `repository configuration`, `manifest path`, `preset`, `Configuration view`, `status bar item`, `log output`, `blocked command`, `IntelliSense`, `configuration provider`, `managed compile database`, `excluded-file scope`, `Rust Analyzer configuration`, `debug template`, `Start Debugging`, `Flash to Device`, `Upload to Device`. New glossary terms introduced by this feature: **multi-root window** and **selected folder** (defined under `Key Entities`); the existing `workspace` and `workspace root` definitions must be updated to refer to the selected folder.

**Governance note**: The constitution's Technical Guardrails currently state that the extension may assume a single-root workspace unless a future amendment expands that scope. Delivering this feature requires that guardrail to be amended in the same change.

## Clarifications

### Session 2026-10-18

- Q: When a folder-list change makes a different folder the selected folder, should Trezor Bench rebind all its services to the new folder in place, or release the old folder and ask the user to reload the window? → A: Release and prompt: immediately stop watchers, block workflows, and clear managed state for the old folder, then show a notification with a `Reload Window` action. Until reload, the extension stays in a blocked state.
- Q: In a multi-root window where no folder contains a root `tbench.toml` or the default manifest, should Build, Clippy, Check, Clean, Flash, and Upload run against the fallback first folder, or stay blocked as they are today? → A: Run against the fallback folder. Folder count never blocks; only the shared blocking conditions evaluated against that folder apply.
- Q: If a `tbench.toml` or default manifest appears in a non-selected folder that comes earlier in workspace order, should Trezor Bench notice and offer a reload, or only re-evaluate on folder-list changes and window reload? → A: Re-evaluate only at activation and on folder-list changes. Marker files in other folders are not watched; a manual window reload picks them up.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Work Against the trezor-firmware Folder in a Multi-Root Window (Priority: P1)

A firmware developer keeps `trezor-firmware` open alongside unrelated folders such as personal notes, `trezor-suite`, or a scratch repository. Whatever position `trezor-firmware` occupies in the folder list, Trezor Bench loads its manifest, presets, and artifacts from that folder, fills the Configuration view from it, and runs Build, Clippy, Check, Clean, Flash to Device, and Upload to Device against it.

**Why this priority**: This is the core problem. Without it the extension is unusable in a multi-root window, or shows panes filled from an unrelated folder.

**Independent Test**: Open a window whose first folder is an unrelated folder and whose second folder is a `trezor-firmware` checkout. Verify that `Build Selection`, `Build Options`, and `Build Artifacts` are filled from the second folder and that `Build` launches with that folder as its working location.

**Acceptance Scenarios**:

1. **Given** a multi-root window where the first folder is unrelated and a later folder contains a root `tbench.toml`, **When** the extension activates, **Then** the manifest, presets, and artifacts are loaded from the later folder and the Configuration view shows that folder's models, targets, components, and presets.
2. **Given** a multi-root window where no folder contains a root `tbench.toml` but a later folder contains a manifest at the default manifest path, **When** the extension activates, **Then** that later folder is selected and its manifest is loaded.
3. **Given** a multi-root window where more than one folder qualifies, **When** the extension activates, **Then** the first qualifying folder in workspace order is selected.
4. **Given** a multi-root window where no folder qualifies, **When** the extension activates, **Then** the first folder is selected and treated exactly as a single-root window would treat that folder today, including running workflow and artifact actions against it when the shared blocking conditions allow.
5. **Given** a multi-root window with a selected folder, a loaded manifest, a resolved active build context, and a valid preset state, **When** the user invokes `Build`, `Clippy`, `Check`, or `Clean`, **Then** the command runs against the selected folder and is not rejected because several folders are open.
6. **Given** a multi-root window with a present binary artifact for the active build context, **When** the user invokes `Flash to Device` or `Upload to Device`, **Then** the action runs against the selected folder's artifact and is not rejected because several folders are open.
7. **Given** a single-root window, **When** the extension activates, **Then** behavior is identical to today.
8. **Given** no folder is open, **When** the extension activates, **Then** the existing unsupported-workspace behavior is unchanged: a warning is shown, workflow actions stay blocked, and no workspace-specific state is loaded.

---

### User Story 2 - Every Capability Follows the Selected Folder (Priority: P1)

A firmware developer in a multi-root window expects IntelliSense, excluded-file marking, Rust Analyzer configuration, and the status bar to describe the `trezor-firmware` folder, and expects files in the other folders to be left alone.

**Why this priority**: Partial support would be confusing: a correct Configuration view next to IntelliSense or excluded-file badges computed from the wrong folder is worse than a clear block.

**Independent Test**: In a multi-root window with `trezor-firmware` as the second folder, select a build context with a present compile commands artifact and verify that IntelliSense, the managed compile database, excluded-file badges, Rust Analyzer configuration, and the status bar all reflect that folder while files in the first folder carry no exclusion badge.

**Acceptance Scenarios**:

1. **Given** a selected folder with a present compile commands artifact, **When** IntelliSense refreshes, **Then** the compile database is resolved from the selected folder's artifacts root and applied through the active IntelliSense backend.
2. **Given** the clangd backend is active, **When** IntelliSense refreshes, **Then** the managed compile database link and the managed `.clangd` file are maintained under the selected folder's root, not under the first folder.
3. **Given** excluded-file scope is configured with workspace-relative folder globs, **When** excluded-file evaluation runs, **Then** the globs are resolved against the selected folder's root, and files that live in other workspace folders are never marked as excluded.
4. **Given** model-specific Rust Analyzer mode is selected, **When** the configuration refreshes, **Then** the generator runs from the selected folder's cargo workspace and the conflict check inspects the selected folder's folder-scope settings.
5. **Given** the status bar item is visible, **When** the user hovers over it in a multi-root window, **Then** the tooltip names the selected folder.
6. **Given** the status bar item is visible, **When** the user hovers over it in a single-root window, **Then** the tooltip is unchanged from today.
7. **Given** a selected folder, **When** `tbench.toml`, the manifest, the preset files, or artifact files change inside a non-selected folder, **Then** the extension does not react to those changes.

---

### User Story 3 - Understand Which Folder Was Chosen (Priority: P2)

A firmware developer or workspace maintainer troubleshooting unexpected behavior in a multi-root window can see from the log output which folder Trezor Bench selected and why.

**Why this priority**: Folder selection is automatic and silent by design; when it picks an unexpected folder the user must be able to find out without guessing.

**Independent Test**: Open a multi-root window, run `Trezor Bench: Show Logs`, and verify that the log names the selected folder and the reason it was chosen.

**Acceptance Scenarios**:

1. **Given** a folder is selected because it contains a root `tbench.toml`, **When** activation completes, **Then** the log output records the selected folder and states that it was chosen because of its repository configuration file.
2. **Given** a folder is selected because it contains the default manifest path, **When** activation completes, **Then** the log output records the selected folder and states that it was chosen because of its manifest.
3. **Given** no folder qualifies, **When** activation completes, **Then** the log output records that no folder qualified and that the first folder was selected as a fallback.
4. **Given** the selected folder changes after a folder-list change, **When** the extension handles the change, **Then** the log output records the previous folder, the new folder, and the reason for the new selection.

---

### User Story 4 - Folder List Changes Are Handled Safely (Priority: P2)

A firmware developer adds, removes, or reorders folders in a multi-root window. When the change affects which folder Trezor Bench should use, the extension releases the old folder, blocks its actions, and asks for a window reload. It never keeps working against a folder that is no longer open.

**Why this priority**: Running builds or writing managed files into a folder the user has removed is a correctness and safety problem, but folder-list changes are less frequent than ordinary use.

**Independent Test**: In a multi-root window, remove the selected folder and verify that no workflow can be launched against it and no refresh reads or writes under it; then add a qualifying folder and verify that the extension offers a window reload and binds to it after the reload.

**Acceptance Scenarios**:

1. **Given** the selected folder is removed from the window, **When** the folder list changes, **Then** the extension stops all watching, refreshing, and workflow launching against that folder, clears managed IntelliSense and Rust Analyzer state applied for it, and shows a notification with a `Reload Window` action.
2. **Given** a folder is added that qualifies and precedes the currently selected non-qualifying fallback folder, **When** the folder list changes, **Then** the extension releases the current folder as in scenario 1 and shows the reload notification.
3. **Given** folders are reordered so that a different qualifying folder now comes first, **When** the folder list changes, **Then** the extension releases the current folder as in scenario 1 and shows the reload notification.
4. **Given** a folder is added or reordered without changing which folder is selected, **When** the folder list changes, **Then** the extension keeps running against the same folder without a reload prompt, and excluded-file evaluation is refreshed as today.
5. **Given** the reload notification is shown and the user dismisses it, **When** the user later invokes a workflow command, `Start Debugging`, or an artifact action, **Then** the command is blocked with an error explaining that a window reload is required, and the Configuration view header actions remain disabled.
6. **Given** the reload notification is shown and the user chooses `Reload Window`, **When** the window reloads, **Then** the extension activates against the newly selected folder with every capability bound to it.
7. **Given** the last folder is removed, **When** the folder list changes, **Then** the extension enters the existing no-folder behavior.

---

### User Story 5 - Folder-Scoped Settings Agree With Their Fixes (Priority: P3)

A firmware developer in a multi-root window who sees the C/C++ configuration-provider warning applies the offered one-step fix once and the warning goes away, because the check and the fix address the same folder.

**Why this priority**: A check that reads one scope while its fix writes another produces a warning the user cannot clear. It affects fewer users than the stories above but is a visible defect once hit.

**Independent Test**: In a multi-root window where the selected folder is not first, trigger the configuration-provider warning, apply the offered fix, refresh IntelliSense, and verify that the warning no longer appears.

**Acceptance Scenarios**:

1. **Given** the Microsoft C/C++ extension is installed and the configuration-provider setting is not set for the selected folder, **When** IntelliSense refreshes, **Then** the warning is shown based on the effective value for the selected folder.
2. **Given** the warning is shown and the user applies the offered fix, **When** IntelliSense refreshes again, **Then** the configuration-provider check passes for the selected folder and the cpptools backend is used.
3. **Given** the configuration-provider setting is already correct for the selected folder but incorrect for another folder, **When** IntelliSense refreshes, **Then** no warning is shown.
4. **Given** any other setting the extension reads for the workspace, **When** it is read in a multi-root window, **Then** the effective value for the selected folder is used.

---

### User Story 6 - Debugging Starts in the Selected Folder (Priority: P3)

A firmware developer in a multi-root window starts a debug session from Trezor Bench, and debug templates that reference `${workspaceFolder}` resolve to the `trezor-firmware` folder regardless of which folder the active editor belongs to.

**Why this priority**: Debug templates rely on `${workspaceFolder}`; resolving it to an unrelated folder produces a session that fails or attaches to the wrong binary.

**Independent Test**: In a multi-root window with `trezor-firmware` as the second folder, open a file from the first folder, invoke `Start Debugging`, and verify the session is scoped to the second folder.

**Acceptance Scenarios**:

1. **Given** a resolved debug profile and a present executable artifact, **When** the user invokes `Start Debugging` while the active editor belongs to a non-selected folder, **Then** the debug session starts scoped to the selected folder and `${workspaceFolder}` in the debug template resolves to it.
2. **Given** debug profiles are exposed as Run and Debug entries, **When** the user starts one from the Run and Debug view, **Then** that session is scoped to the selected folder.
3. **Given** debug templates are read from the debug templates path, **When** a session starts, **Then** the templates are read from the selected folder.

---

### Edge Cases

- Two or more folders qualify: the first qualifying folder in workspace order is selected; the others are ignored. Operating against several `trezor-firmware` folders at once is out of scope.
- No folder qualifies: the first folder is selected and the fallback is logged. Workflow and artifact actions are not blocked by folder count in this case either; they are gated only by the shared blocking conditions evaluated against that folder, which in practice blocks them when that folder has no manifest.
- A qualifying folder's `tbench.toml` is present but invalid: the folder still qualifies for selection because the file exists, and the existing blocking repository-configuration error state applies.
- `tbench.toml` or the default manifest is created in a non-selected folder: selection is not re-evaluated until the folder list changes or the window is reloaded. The extension does not watch marker paths in non-selected folders.
- The selected folder is removed while a workflow task is running: the running task continues under VS Code's ownership, but the extension launches no further tasks and performs no further refreshes against that folder.
- The user dismisses the reload notification: the extension stays in the released state with workflow, debugging, and artifact actions blocked until the window is reloaded; the blocking reason names the required reload.
- The active editor belongs to a non-selected folder: workflow commands, `Start Debugging`, and `Refresh IntelliSense` still operate on the selected folder.
- A file in a non-selected folder matches the excluded-file scope patterns: it is not marked as excluded, because excluded-file marking applies only within the selected folder.
- The configuration-provider setting is correct at the workspace-file level but overridden to another provider at the selected folder level: the check reports a misconfiguration because the effective value for the selected folder is wrong, and the fix corrects the folder level.
- A folder is added or removed without changing the selected folder: no rebind or reload prompt occurs; only the existing excluded-file refresh runs.

## Requirements *(mandatory)*

### Functional Requirements

**Folder selection**

- **FR-001**: When at least one workspace folder is open, the extension MUST select exactly one folder as the selected folder before loading any workspace-specific state.
- **FR-002**: The selected folder MUST be the first folder in workspace order that contains a root `tbench.toml` file or a file at the default manifest path. Both markers are checked by presence only; file validity does not affect selection.
- **FR-003**: When no folder qualifies, the extension MUST select the first workspace folder and treat it as the selected folder for every requirement below, including FR-009.
- **FR-004**: When no workspace folder is open, the extension MUST retain the existing unsupported-workspace behavior unchanged.
- **FR-005**: In a single-root window, selection MUST resolve to the only folder and all behavior MUST remain identical to current behavior.

**Capabilities bound to the selected folder**

- **FR-006**: Repository configuration, the manifest, preset files, the artifacts root, the cargo workspace, and the debug templates path MUST be resolved from the selected folder's root.
- **FR-007**: File watching for repository configuration, the manifest, preset files, and artifact files MUST cover only the selected folder; changes in other folders MUST NOT trigger refreshes.
- **FR-008**: The Configuration view and the status bar item MUST reflect state loaded from the selected folder.
- **FR-009**: `Build`, `Clippy`, `Check`, `Clean`, `Flash to Device`, `Upload to Device`, and artifact row actions MUST execute against the selected folder and MUST NOT be blocked solely because more than one folder is open. The shared blocking condition "no supported workspace folder is open" MUST apply only when no folder is open.
- **FR-010**: IntelliSense MUST resolve the compile commands artifact from the selected folder and, when the clangd backend is active, MUST maintain the managed compile database link and managed `.clangd` file under the selected folder's root.
- **FR-011**: Excluded-file evaluation MUST resolve workspace-relative folder globs against the selected folder's root and MUST NOT mark files outside the selected folder as excluded.
- **FR-012**: Rust Analyzer configuration MUST run model-specific generation from the selected folder's cargo workspace and MUST perform its conflict check against the selected folder's folder-scope settings.
- **FR-013**: `Start Debugging` and Run and Debug entries MUST start sessions scoped to the selected folder, so that `${workspaceFolder}` in debug templates resolves to it regardless of the active editor.
- **FR-014**: Every setting the extension reads for the workspace MUST be read as the effective value for the selected folder, and every setting the extension writes for the workspace MUST be written for the selected folder, so that a check and its corresponding fix address the same scope. This explicitly includes the C/C++ configuration-provider check and its one-step fix.

**Visibility**

- **FR-015**: On activation and on every selection change, the log output MUST record the selected folder and the reason for its selection: repository configuration file present, default manifest present, or fallback to the first folder.
- **FR-016**: In a multi-root window, the status bar item tooltip MUST include the name of the selected folder. In a single-root window the tooltip MUST be unchanged.

**Folder list changes**

- **FR-017**: When folders are added, removed, or reordered, the extension MUST re-evaluate folder selection using the same rules as at activation. Folder selection MUST NOT be re-evaluated for any other reason; in particular, the extension MUST NOT watch `tbench.toml` or manifest paths in non-selected folders.
- **FR-018**: When re-evaluation yields the same selected folder, the extension MUST continue running against it without a reload prompt and MUST perform the existing excluded-file refresh.
- **FR-019**: When re-evaluation yields a different selected folder, the extension MUST release the previous folder: stop watching, refreshing, and launching workflows against it, clear managed IntelliSense and Rust Analyzer state applied for it, and block workflow commands, `Start Debugging`, and artifact actions. It MUST then show a notification with a `Reload Window` action. The extension MUST NOT rebind services to the new folder in place; the new folder becomes active only after the window reloads.
- **FR-019a**: While the extension is in the released state, blocked invocations MUST report that a window reload is required, following the shared blocked behavior.
- **FR-020**: The extension MUST never read from, write to, launch tasks in, or start debug sessions in a folder that has been removed from the window.
- **FR-021**: When the last folder is removed, the extension MUST enter the existing no-folder behavior.

### Key Entities

- **multi-root window**: A VS Code window with two or more workspace folders open. Trezor Bench operates against exactly one of them.
- **selected folder**: The single workspace folder that Trezor Bench operates against. Chosen by the folder selection rules; equal to the only folder in a single-root window. Every reference to "workspace" and "workspace root" in product behavior refers to this folder.
- **folder selection reason**: Why a folder was selected: its root `tbench.toml` exists, its default manifest path exists, or no folder qualified and the first folder was used as a fallback. Recorded in the log output.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a multi-root window where the `trezor-firmware` folder is not the first folder, every capability listed in the feature description (manifest, presets, panes, status bar, workflows, artifact actions, debugging, IntelliSense, Rust Analyzer, excluded-file marking) operates against that folder, with zero capabilities still bound to the first folder.
- **SC-002**: Zero workflow or artifact-action invocations are rejected for the reason that more than one folder is open; every rejection in a multi-root window names a shared blocking condition evaluated against the selected folder.
- **SC-003**: A user can determine which folder was selected and why from the log output alone, without inspecting folder contents, on the first attempt.
- **SC-004**: After the selected folder is removed from the window, zero reads, writes, task launches, or debug sessions target that folder.
- **SC-005**: In a multi-root window, applying the C/C++ configuration-provider fix once clears the warning on the next IntelliSense refresh in 100% of cases.
- **SC-006**: In single-root and no-folder windows, all existing automated tests pass unchanged, demonstrating no behavior change for current users.
- **SC-007**: Files in non-selected folders show zero exclusion badges or editor overlays.

## Assumptions

- A folder "qualifies" as `trezor-firmware`-shaped when its root `tbench.toml` exists or the built-in default manifest path (`core/embed/xtask/tf-tools/manifest.yaml`) exists beneath it. No deeper inspection, such as validating file contents or looking for a cargo workspace, is performed.
- When no folder qualifies, the first folder is used and workflow and artifact actions are not blocked by folder count (confirmed in `Clarifications`). The folder-count blocking condition is removed entirely rather than retained for the fallback case.
- Persisted state (build selection, build options, Rust Analyzer mode) continues to be stored per VS Code workspace exactly as today; it is not keyed by folder. In a multi-root window this means the state belongs to the `.code-workspace` file or untitled workspace.
- A window with more than one `trezor-firmware` folder, a per-folder build selection, and a manual folder picker are out of scope. Only the first qualifying folder is used.
- The status bar tooltip addition applies only when more than one folder is open; single-root tooltip text is unchanged.
- Updating `specs/product-spec.md`, `specs/glossary.md`, and the constitution's single-root guardrail is part of delivering this feature and happens alongside implementation, as required by the constitution's Delivery Workflow.
