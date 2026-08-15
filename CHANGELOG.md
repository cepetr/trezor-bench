# Changelog

## Unreleased
### Changed
- All notification popups now start with a unified `Trezor Bench:`
### Fixed
- Build, Flash, and Upload now explain when the active build context is incomplete or no longer matches the manifest, instead of failing silently.
- Flash and Upload are now blocked when manifest availability-rule validation errors block workflow actions.
- Debug-profile variables using obsolete `${tfTools.*}` aliases now report a manifest validation error before launch.
- Blocked build messages now identify the correct manifest and preset locations to check.
- Build, Clippy, Check, and Clean tasks can now be referenced from `.vscode/tasks.json`.

## 0.4.2 - 2026-08-13
### Changed
- Build-option tooltip descriptions now appear on a new line below the command-line option or multistate value.
- Build artifact rows now show `present` instead of `valid`, with a consolidated `Updated` row showing the newest artifact's relative age.

## 0.4.1 - 2026-08-11
### Fixed
- Restored the existing repository URL in extension package metadata and README links so the bundled README image resolves correctly.

## 0.4.0 - 2026-08-11
### Changed
- Renamed the extension from Trezor Firmware Tools to Trezor Bench. This is a breaking change: the extension id is now `cepetr.tbench`, and its commands, settings, context keys, debugger and task types, debug variables, persisted workspace state, repository configuration file, and managed IntelliSense directory now use the `tbench` prefix.
- Retained upstream Trezor firmware contract paths under `xtask/tf-tools/`, including the manifest, preset, and debug-template locations.

## 0.3.2 - 2026-08-06
### Fixed
- Multistate build options without an applicable preset value now use their first declared state, so their state choices remain selectable instead of becoming unavailable.

## 0.3.1 - 2026-08-05
### Added
- Added optional root-level `tf-tools.toml` repository configuration for cargo workspace, manifest, build artifacts, debug templates, and xtask preset input paths. Relative paths resolve from the workspace root; changes are applied without reloading the VS Code window.
### Changed
- Removed the `tfTools.cargoWorkspacePath`, `tfTools.debug.templatesPath`, `tfTools.artifactsPath`, and `tfTools.manifestPath` VS Code settings. Their values are not migrated; configure repository paths in `tf-tools.toml` instead.

## 0.3.0 - 2026-08-03
### Added
- Added a `Preset` selector below `Component` in `Build Selection`, listing every preset declared in `presets.toml` and the optional `user-presets.toml` plus a synthetic `Default` choice. The selected preset id is saved and restored with the rest of the active configuration and never appears in the status bar, task labels, or command names.
- Added preset-relative build options: controls display the preset-effective value calculated from shared defaults, user defaults, shared preset fragments, and user preset fragments, and only values explicitly overridden away from that baseline are emphasized. Overrides are discarded for options the newly active preset or build context calculates differently, and retained for those calculated identically.
- Added preset-aware `Build`, `Clippy`, and `Check` execution: the command appends `-p <preset-name>` only for a non-default preset and emits build-option arguments only for overrides that differ from the preset-effective values.
- Added error reporting for preset inputs. A missing `presets.toml` means the repository's `xtask` predates preset support, so the selector reports the file as unavailable; a malformed or invalid preset file replaces the preset choices with an error message. In both cases details go to the log, the saved preset id is preserved, and `Build`, `Clippy`, and `Check` are blocked while `Clean` stays available. An absent `user-presets.toml` remains optional.
- Added persistence of each configuration pane's collapse state across window reloads.
### Changed
- Split the single `Configuration` tree view into three sibling panes in the activity-bar container — `Build Selection`, `Build Artifacts`, and `Build Options`, in that order — each with its own header and divider. Row labels, icons, descriptions, tooltips, checkboxes, inline artifact actions, and placeholder wording are unchanged. `Build Options` starts collapsed.
- Moved the workflow toolbar from the container title to the `Build Selection` pane header, keeping its full membership, order, grouping, icons, and enablement. The host reveals pane header actions on hover or focus and hides them while the pane is collapsed; `Build Options` and `Build Artifacts` expose no workflow actions.
- Selecting the status bar configuration item now opens the container, expands `Build Selection`, and focuses it.
- Renamed the activity-bar container from `Trezor` to `Trezor Firmware Tools`.
- Multistate build options no longer require manifest-authored defaults; the selected state is inferred from the preset-effective value when no override exists.

## 0.2.0 - 2026-07-19
### Added
- Added configuration variable expansion for tf-tools path settings, excluded-file scope settings, and task environment settings.
- Added clangd IntelliSense backend support when cpptools is unavailable.
- Added `tfTools.taskExtraEnv` for extra environment variables passed to Build, Clippy, Check, Clean, Flash, and Upload workflow tasks.
- Added persistent log output for extension activation and key failure paths, including manifest load failures, blocked Flash/Upload actions, map-file open failures, and debug launch failures.
### Changed
- Workflow tasks now launch `cargo xtask` through `ProcessExecution`, inheriting the VS Code session environment without shell-mediated startup.
### Fixed
- Build artifact status and related actions now refresh after running `cargo xtask build` or `cargo xtask clean` outside the extension.

## 0.1.2 - 2026-05-15
### Changed
- Changed the default manifest and debug templates location to core/embed/xtask/tf-tools

## 0.1.1 - 2026-04-22
### Changed
- Lowered the minimum supported VS Code version to 1.105.0
