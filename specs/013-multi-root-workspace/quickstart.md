# Quickstart: Validate Multi-Root Workspace Support

## Prerequisites

- VS Code 1.105 or newer.
- A `trezor-firmware` checkout with `tbench.toml` or the default manifest at `core/embed/xtask/tf-tools/manifest.yaml`, plus built artifacts for at least one build context.
- One or two unrelated folders (for example a notes folder and a scratch repository).
- Extension dependencies installed with `npm ci`.
- Rules and messages are defined in [contracts/multi-root-workspace.md](contracts/multi-root-workspace.md); state shapes in [data-model.md](data-model.md).

## Automated Validation

```bash
npm run lint
npm run compile
npm run test:unit
npm test
```

Expected: lint and compile are clean; unit suites for folder selection, folder-change evaluation, block reasons, cpptools readiness scope, Run and Debug folder filtering, status bar tooltip, and log output pass; every pre-existing integration suite passes unchanged (single-root and no-folder parity).

## Selection In A Multi-Root Window

1. Create a workspace with the unrelated folder first and `trezor-firmware` second; open it.
2. Run `Trezor Bench: Show Logs`.

Expected: the log names the `trezor-firmware` folder and the reason (`tbench.toml found` or `default manifest found`). `Build Selection`, `Build Options`, and `Build Artifacts` are filled from that folder. Hovering the status bar item shows `Selected folder: trezor-firmware`.

3. Reorder so `trezor-firmware` is first, reload, and check the log again.

Expected: the same folder is selected; the tooltip still names it.

## Workflows And Artifact Actions

1. With a loaded manifest, resolved build context, and valid presets, run `Build`, `Clippy`, `Check`, and `Clean`.
2. With a present binary artifact, run `Flash to Device` and `Upload to Device`.

Expected: every command launches a task whose working directory is under the `trezor-firmware` folder; no command is rejected for having several folders open.

## IntelliSense, Excluded Files, And Rust Analyzer

1. Select a build context whose compile commands artifact is present and run `Refresh IntelliSense`.
2. If clangd is the backend, inspect `.tbench/compile_commands.json` and `.clangd` in the `trezor-firmware` folder and confirm neither exists in the first folder.
3. Place a `.c` file under a path in the first folder that mirrors an excluded-file glob (for example `core/embed/x.c`).
4. Select `Rust Analyzer: Select Configuration…` → `Model Specific`.

Expected: the compile database applies from the second folder's artifacts; managed clangd files live only under `trezor-firmware`; the `.c` file in the first folder shows no exclusion badge or overlay while excluded files in `trezor-firmware` do; the generator runs from the `trezor-firmware` cargo workspace.

## Provider Fix Scope

1. With the Microsoft C/C++ extension installed, set `C_Cpp.default.configurationProvider` to another value in the `trezor-firmware` folder settings and leave it unset or correct elsewhere.
2. Trigger `Refresh IntelliSense`, accept the `Fix` action, and refresh again.

Expected: the warning appears based on the `trezor-firmware` folder's effective value, the fix writes that folder's settings, and the warning does not reappear. Setting the provider wrongly only in the unrelated folder produces no warning.

## Debugging

1. Open a file from the unrelated folder in the editor.
2. Invoke `Start Debugging`, then open the Run and Debug picker.

Expected: the session is scoped to `trezor-firmware` and `${workspaceFolder}` in the launched configuration resolves to it; the picker lists Trezor Bench entries only under the `trezor-firmware` folder.

## Fallback Selection

1. Open a workspace with two folders where neither contains `tbench.toml` or the default manifest.

Expected: the log records that no folder qualified and the first folder was used. `Build` is blocked by the missing-manifest reason evaluated against that folder, not by folder count.

## Folder-List Changes

1. In a bound multi-root window, add a non-qualifying folder at the end.

Expected: no notification; the extension keeps running against the same folder; excluded-file evaluation refreshes.

2. Remove the `trezor-firmware` folder from the workspace.

Expected: a warning notification offers `Reload Window`; the log records the previous folder, the new selection (or none), and the reason; Configuration view header actions are disabled; `Build`, `Flash to Device`, and `Start Debugging` report that a window reload is required; no task launches and no file under the removed folder is read or written.

3. Dismiss the notification, then invoke `Build` again.

Expected: still blocked with the reload-required message.

4. Re-add the folder and choose `Reload Window` from a fresh change notification, or reload manually.

Expected: after reload, the extension activates against the newly selected folder with every capability bound to it.

5. Remove the last folder from a single-root window.

Expected: the existing no-folder behavior: warning, workflow actions blocked, no workspace state loaded.

## Single-Root Parity

1. Open `trezor-firmware` alone.

Expected: behavior identical to the previous release; the status bar tooltip is unchanged; the activation log line names the folder and its reason.
