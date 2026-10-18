# Multi-Root Workspace Contracts

## Folder Selection

Inputs: the ordered list of open workspace folders. Output: one selected folder and a reason, or none when no folder is open.

```text
for folder in folders:            # workspace order
  if exists(folder/tbench.toml):                              → (folder, repository-config)
for folder in folders:
  if exists(folder/core/embed/xtask/tf-tools/manifest.yaml):  → (folder, default-manifest)
if folders non-empty:                                         → (folders[0], fallback)
otherwise                                                     → none
```

- Presence only; no file is parsed for selection.
- Evaluated at activation and on every `onDidChangeWorkspaceFolders` event, nowhere else.
- Marker paths in non-selected folders are never watched.

## Binding Guarantee

While bound, every workspace-specific capability resolves against the selected folder's root:

| Capability | Resolution |
| --- | --- |
| Repository configuration | `<selected>/tbench.toml`, watched and polled there only |
| Manifest, presets, artifacts root, cargo workspace, debug templates | `[paths]` resolved from the selected folder's root |
| Task execution (`Build`, `Clippy`, `Check`, `Clean`, `Flash to Device`, `Upload to Device`) | cwd = selected folder's cargo workspace; env = session + `tbench.taskExtraEnv` read for the selected folder; task scope = selected folder |
| IntelliSense | compile commands artifact from the selected folder's artifacts root; managed `.tbench/compile_commands.json` and `.clangd` under the selected folder's root |
| Excluded files | candidates from `findFiles(RelativePattern(selectedFolder, glob))`; files in other folders never marked |
| Rust Analyzer | generator cwd = selected folder's cargo workspace; conflict inspection scoped to the selected folder |
| Settings reads | `getConfiguration(section, selectedFolder.uri)` for `tbench.*`, `rust-analyzer.*`, and `C_Cpp.default.configurationProvider` |
| Settings writes | `ConfigurationTarget.WorkspaceFolder` for the selected folder (provider fix) |
| Debugging | `debug.startDebugging(selectedFolder, …)`; Run and Debug entries provided only for the selected folder |
| Status bar | state from the selected folder; tooltip names the folder when more than one is open |

## Blocking

Folder count never blocks. The `workspace-unsupported` reason applies only when no folder is open. The `reload-required` reason applies while released and is reported through the shared blocked behavior (disabled header actions, error notification naming the reload, log entry).

Precedence: `workspace-unsupported` → `reload-required` → existing reasons in their current order.

## Release Protocol

Triggered once, when a folder-list change makes a different folder (or no folder) the selected folder.

1. Set `reloadRequired`.
2. Dispose: repository-config service (watcher and poller), manifest and preset services and their state subscriptions, artifact file watcher, IntelliSense service (after clearing cpptools payload and publishing a null payload so badges and overlays clear).
3. Stop the Rust Analyzer service: registers `{}` for `cepetr.tbench`.
4. Clear manifest, preset, build selection, and resolved options; hide the status bar.
5. Set context keys: `tbench.workflowBlocked=true`, `tbench.startDebuggingEnabled=false`, `tbench.flashApplicable=false`, `tbench.uploadApplicable=false`, `tbench.binaryExists=false`, `tbench.mapExists=false`.
6. Log the change (previous folder, new folder or none, reason).
7. Show a warning notification: `The workspace folder Trezor Bench was using has changed. Reload the window to continue.` with action `Reload Window` → `workbench.action.reloadWindow`.

Guarantees after release:

- No file under the previous folder is read or written by the extension; managed on-disk files are left as they are.
- No task is launched; the task provider returns no tasks.
- No debug session is started; the Run and Debug provider returns no entries and rejects resolution.
- The reload notification is shown once; dismissing it keeps the released state.

## Run And Debug Provider

| Call | Behavior |
| --- | --- |
| `provideDebugConfigurations(folder)` | Entries only when `folder` is the selected folder and not released; otherwise `[]`. |
| `resolveDebugConfiguration(folder, config)` for `type: tbench` | Rejected (logged `[PROVIDER] wrong-folder` or `reload-required`, error notification) when `folder` is not the selected folder or released; otherwise unchanged. |

## Log Output

```text
Selected workspace folder: /path/to/trezor-firmware — tbench.toml found
Selected workspace folder: /path/to/trezor-firmware — default manifest found
Selected workspace folder: /path/to/notes — no folder qualified; using the first folder
Workspace folder selection changed: /path/to/notes → /path/to/trezor-firmware — tbench.toml found; reload the window to continue.
Workspace folder selection changed: /path/to/trezor-firmware → none; reload the window to continue.
```

## Documentation Amendments

| Document | Change |
| --- | --- |
| `.specify/memory/constitution.md` | Guardrail: operates against exactly one selected folder; version 1.9.0 with sync impact report |
| `specs/product-spec.md` | `Workspace Assumptions And Scope`, `Status Bar` › `Displayed Information`, `IntelliSense` subsections, `Rust Analyzer Configuration` (multi-root sentence), `Repository Path Configuration`, `Activation`, `Other Refresh Triggers`, `Shared Blocking Conditions`, `Start Debugging` |
| `specs/glossary.md` | Update `workspace`, `workspace root`; add `multi-root window`, `selected folder`, `folder selection reason` |
| `README.md` | `Workspace Requirements`: multi-root windows supported; one `trezor-firmware` folder selected |
| `CHANGELOG.md` | `Unreleased` › `Added`: multi-root window support |
