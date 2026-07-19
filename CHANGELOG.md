# Changelog

## 0.1.1 - 2026-04-22
### Changed
- Lowered the minimum supported VS Code version to 1.105.0

## 0.1.2 - 2026-05-15
### Changed
- Changed the default manifest and debug templates location to core/embed/xtask/tf-tools

## 0.1.3 - 2026-07-12
### Added
- Added configuration variable expansion for tf-tools path settings, excluded-file scope settings, and task environment settings.
- Added clangd IntelliSense backend support when cpptools is unavailable.
- Added `tfTools.taskExtraEnv` for extra environment variables passed to Build, Clippy, Check, Clean, Flash, and Upload workflow tasks.
- Added persistent log output for extension activation and key failure paths, including manifest load failures, blocked Flash/Upload actions, map-file open failures, and debug launch failures.
### Changed
- Workflow tasks now launch `cargo xtask` through `ProcessExecution`, inheriting the VS Code session environment without shell-mediated startup.
### Fixed
- Build artifact status and related actions now refresh after running `cargo xtask build` or `cargo xtask clean` outside the extension.
