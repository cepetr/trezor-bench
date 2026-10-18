# Data Model: Multi-Root Workspace Support

## Folder Selection

The outcome of running the selection rules over the open workspace folders. Computed at activation and on every folder-list change; never persisted.

| Field | Type | Rules |
| --- | --- | --- |
| `folder` | `vscode.WorkspaceFolder` | The selected folder. Equal to the only folder in a single-root window. |
| `reason` | `"repository-config" \| "default-manifest" \| "fallback"` | `repository-config` when `<folder>/tbench.toml` exists; else `default-manifest` when `<folder>/core/embed/xtask/tf-tools/manifest.yaml` exists; else `fallback` (first folder). |

Rules:

- Folders are examined in `workspace.workspaceFolders` order; the first match wins, and the `repository-config` pass over all folders precedes the `default-manifest` pass.
- Presence only: file contents are never read for selection.
- No folders open: no selection; the existing no-folder path runs.
- Two selections are the same when `folder.uri.toString()` is equal.

## Selected-Folder Session

Module-owned runtime state in the composition root describing whether the extension is bound to its selected folder.

| Field | Type | Rules |
| --- | --- | --- |
| `selectedFolder` | `vscode.WorkspaceFolder` | Fixed for the lifetime of the extension host session. |
| `reloadRequired` | boolean | `false` after activation; set `true` by release and never reset without a window reload. |

State transitions:

- `bound` → `bound`: folder-list change whose re-evaluated selection is the same folder. Side effects: `workspace-change` IntelliSense refresh, status bar refresh.
- `bound` → `released`: folder-list change whose re-evaluated selection is a different folder or no folder. Side effects: services disposed, runtime IntelliSense and Rust Analyzer state cleared, build state cleared, status bar hidden, blocked context keys set, reload notification shown.
- `released` → `released`: further folder-list changes are ignored; no notification is repeated.
- `released` → `bound`: only through window reload (fresh activation).

## Folder Change Outcome

Result of evaluating one `onDidChangeWorkspaceFolders` event.

| Value | Meaning |
| --- | --- |
| `unchanged` | Re-evaluated selection is the current selected folder. |
| `{ next: FolderSelection }` | A different folder is now selected. |
| `{ next: undefined }` | No folder is open any more. |

## Block Reasons (extended)

| Surface | Reason | Position in precedence | Message |
| --- | --- | --- | --- |
| Workflow (`Build`, `Clippy`, `Check`, `Clean`) | `workspace-unsupported` | first | `Build Workflow requires an open workspace folder.` (multi-root wording removed) |
| Workflow | `reload-required` | second, before `manifest-missing` | `Build Workflow is blocked: the workspace folder Trezor Bench was using has changed. Reload the window to continue.` |
| Artifact actions (`Flash to Device`, `Upload to Device`) | `workspace-unsupported` | first | unchanged: `Trezor Bench requires an open workspace folder.` |
| Artifact actions | `reload-required` | second | `The workspace folder Trezor Bench was using has changed. Reload the window to continue.` |
| `Start Debugging` | `reload-required` | before manifest checks | `Cannot start debugging: the workspace folder Trezor Bench was using has changed. Reload the window to continue.` |

Inputs: `workspaceSupported` is `hasSupportedWorkspace()` (at least one folder open); `reloadRequired` is the session flag.

## Context Keys In The Released State

| Key | Value |
| --- | --- |
| `tbench.workflowBlocked` | `true` |
| `tbench.startDebuggingEnabled` | `false` |
| `tbench.flashApplicable`, `tbench.uploadApplicable` | `false` |
| `tbench.binaryExists`, `tbench.mapExists` | `false` |

## Status Bar Tooltip

| Condition | Tooltip |
| --- | --- |
| More than one folder open at refresh time | `Selected folder: <selectedFolder.name>` |
| Exactly one folder open | unset (unchanged from today) |

## Log Records

| Event | Line |
| --- | --- |
| Activation | `Selected workspace folder: <fsPath> — <reason text>` |
| Selection changed | `Workspace folder selection changed: <old fsPath> → <new fsPath or none> — <reason text>; reload the window to continue.` |

Reason text: `tbench.toml found`, `default manifest found`, `no folder qualified; using the first folder`.

## Unchanged Persisted State

Build selection, build options, and Rust Analyzer mode remain in `workspaceState`, keyed per VS Code workspace (the `.code-workspace` file or untitled workspace in a multi-root window). Nothing is keyed by folder.
