# Research: Multi-Root Workspace Support

## Folder Selection Rule

- **Decision**: Select the first folder in `vscode.workspace.workspaceFolders` order whose root contains `tbench.toml`; if none, the first folder whose root contains the built-in default manifest path `core/embed/xtask/tf-tools/manifest.yaml`; if none, the first folder. Probe with `fs.existsSync`; never parse either file for selection.
- **Rationale**: Presence of repository data is the only signal the product already relies on, it is cheap, and it keeps selection deterministic and explainable in one log line. Using the built-in default path rather than a `tbench.toml`-configured path avoids parsing a possibly invalid file just to pick a folder; a folder with `tbench.toml` already qualifies by the first rule.
- **Alternatives considered**: Inspecting for a cargo workspace or validating the manifest was rejected as deeper inspection the spec excludes. A manual folder picker or a setting naming the folder was rejected as out of scope and as new state to persist.

## Where Selection Lives

- **Decision**: A pure `selectWorkspaceFolder(folders, exists)` in a new `src/workspace/folder-selection.ts`, returning the folder and a `repository-config | default-manifest | fallback` reason. `requireWorkspaceFolder` and `isWorkflowWorkspaceSupported` are removed from `workspace-guard.ts`; `hasSupportedWorkspace` stays.
- **Rationale**: Every folder-bound service already accepts a `vscode.WorkspaceFolder`, so selection is the single new concept and belongs in one small, testable module. Removing the folder-count guard is what lifts the multi-root block.
- **Alternatives considered**: Keeping `isWorkflowWorkspaceSupported` for the fallback case was rejected because the clarification states folder count never blocks.

## Lifting The Folder-Count Block

- **Decision**: Feed `workspaceSupported` from `hasSupportedWorkspace()` (any folder open) in workflow, artifact-action, and context-key evaluation. Reword the `workspace-unsupported` message to "requires an open workspace folder".
- **Rationale**: The reason and its precedence already exist; only the input and wording change. After the last folder is removed, the live check turns false and the existing no-folder message applies, matching the spec's "existing no-folder behavior".
- **Alternatives considered**: Deleting the `workspace-unsupported` reason was rejected because the no-folder activation path still reports it directly.

## Released State And Reload

- **Decision**: Add a `reload-required` block reason to workflow and artifact actions (evaluated immediately after `workspace-unsupported`) and a matching debug-launch failure. Commands stay registered and read a reload-required flag through `CommandDeps.isReloadRequired()`. Release disposes the repository-config, manifest, preset, artifact-watcher, and IntelliSense services, stops the Rust Analyzer service (which registers `{}`), clears build state, hides the status bar, sets blocked context keys, and shows a warning with a `Reload Window` action that runs `workbench.action.reloadWindow`.
- **Rationale**: Commands cannot be unregistered and re-registered safely; a flag plus the shared blocked behavior gives the required error. Disposing services is the only way to guarantee no further reads, writes, task launches, or refreshes against the old folder, and every service already has a `dispose`. The clarification chose release-and-prompt over in-place rebinding, so no service is recreated.
- **Alternatives considered**: Rebinding services to the new folder in place was rejected per clarification. Unregistering commands was rejected because invoking an unregistered command errors with a VS Code message instead of the shared blocked behavior.

## Managed On-Disk Files On Release

- **Decision**: On release, clear only runtime state: the cpptools payload, the excluded-file snapshot (publish a null payload), the IntelliSense runtime state, and the Rust Analyzer contributor object. Do not remove `.tbench/compile_commands.json` or `.clangd` under the old folder.
- **Rationale**: Removing the link is a write under a folder that may already be removed from the window, which the spec forbids. The existing clear path already reconciles a link left on disk by a previous session when that folder is next activated, so nothing is lost.
- **Alternatives considered**: Removing the link only when the old folder is still open was rejected as a branch that buys little; clangd is restarted by the next activation anyway.

## Folder-Change Detection

- **Decision**: One `onDidChangeWorkspaceFolders` subscription in a new `src/workspace/folder-change-wiring.ts`. It re-runs selection and compares by `uri.toString()`. Same folder: schedule the existing `workspace-change` IntelliSense refresh and refresh the status bar. Different or none: log and release once. The existing handler in `intellisense-wiring.ts` moves here so one place decides.
- **Rationale**: The spec forbids watching marker files in non-selected folders, so the folder-list event is the only legitimate trigger. Comparing by URI is stable across reorders and renames of `name`.
- **Alternatives considered**: Watching `tbench.toml` in every folder was rejected per clarification. Comparing by index was rejected because reorders that keep the same folder must not release.

## Settings Scope For The Provider Check

- **Decision**: `evaluateCpptoolsReadiness` reads `C_Cpp.default.configurationProvider` via `getConfiguration("C_Cpp", selectedFolder.uri)`.
- **Rationale**: Unscoped `getConfiguration` returns the workspace-level effective value, while `applyProviderSettingFix` writes `ConfigurationTarget.WorkspaceFolder` for the selected folder. In a multi-root window those can disagree, producing a warning the fix cannot clear. Scoping the read to the same folder makes check and fix address one scope. All other reads (`tbench.*`, `rust-analyzer.*`) are already scoped.
- **Alternatives considered**: Writing the fix at workspace level was rejected because a folder-level override would still shadow it and because the current folder-level write is established behavior.

## Run And Debug In A Multi-Root Window

- **Decision**: `provideDebugConfigurations(folder)` returns tbench entries only when `folder` is the selected folder; `resolveDebugConfiguration` rejects (log plus notification) when the folder is not the selected one or the extension is released. `Start Debugging` keeps calling `debug.startDebugging(selectedFolder, …)`.
- **Rationale**: VS Code queries dynamic providers once per workspace folder, so without filtering the picker would list identical entries under every folder and launching one under an unrelated folder would resolve `${workspaceFolder}` to that folder. Passing the selected folder to `startDebugging` is what makes `${workspaceFolder}` resolve correctly irrespective of the active editor.
- **Alternatives considered**: Substituting `${workspaceFolder}` ourselves in templates was rejected; VS Code already performs that substitution against the session's folder.

## Status Bar Tooltip

- **Decision**: `StatusBarPresenter.update` accepts an optional selected-folder name; when present the tooltip is `Selected folder: <name>`, otherwise the tooltip is unset. The caller passes the name only when more than one folder is open at refresh time.
- **Rationale**: Keeps single-root output byte-identical and puts the multi-root check in one place beside the existing enablement read.
- **Alternatives considered**: Appending the folder name to the status text was rejected because the text format is a shared display convention.

## Logging Format

- **Decision**: `Selected workspace folder: <fsPath> — <reason>` on activation, where reason is one of `tbench.toml found`, `default manifest found`, or `no folder qualified; using the first folder`. On change: `Workspace folder selection changed: <old fsPath> → <new fsPath | none> — <reason>; reload the window to continue.`
- **Rationale**: One line answers "which folder and why" without inspecting disk, matching the existing repository-configuration log style.
- **Alternatives considered**: An information notification on activation was rejected as noise; the spec wants selection silent except in the log.

## Test Strategy For Folder-List Changes

- **Decision**: Unit-test selection with real temp directories and injected probes, folder-change evaluation with injected folder lists, and release-visible surfaces (block reasons, provider filtering, tooltip, logs) against the `vscode` mock. Keep all existing integration suites unchanged as the single-root and no-folder parity check. Document manual multi-root validation in `quickstart.md`.
- **Rationale**: The integration harness opens no workspace folder, and VS Code restarts the extension host when the first folder of a window changes, so a folder-change integration test cannot observe the release path.
- **Alternatives considered**: A second electron run against a multi-root `.code-workspace` fixture was rejected for this feature as a harness change affecting every suite; it can be revisited separately.

## Governance Amendment

- **Decision**: Amend the constitution guardrail to "The extension operates against exactly one workspace folder, the selected folder, chosen as described in `specs/product-spec.md`; it never operates against several folders at once." Bump to 1.9.0 with a sync impact report. Update `specs/product-spec.md` affected sections, `specs/glossary.md` (`workspace`, `workspace root`, new `multi-root window`, `selected folder`, `folder selection reason`), README `Workspace Requirements`, and `CHANGELOG.md`.
- **Rationale**: The delivery workflow requires consolidated documentation and the constitution to change in the same change as the behavior.
- **Alternatives considered**: None; required by the constitution.
