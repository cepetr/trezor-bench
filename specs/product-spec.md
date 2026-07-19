# Product Specification: Trezor Firmware Tools

**Status**: Draft baseline
**Last Updated**: 2026-06-23

## Purpose

This document is the active product-level specification for Trezor Firmware Tools.
It describes the product as it exists for users and workspace maintainers, without relying on the historical 001-006 delivery slices.

## Product Summary

The extension exists to simplify common workflows when working inside the `trezor-firmware` repository.

It makes build-context selection and build-option selection more comfortable and more visible inside VS Code through a dedicated tree-view workflow, instead of requiring users to manage those choices indirectly.

It also reduces or eliminates manual VS Code configuration needed for C/C++ IntelliSense, build tasks, and debug launch setup, so the workspace can provide a more consistent experience with less editor-specific setup effort.

## Workspace Assumptions And Scope

The extension is intended for work inside a `trezor-firmware` workspace shape and assumes that the workspace contains the files, directories, and generated artifacts needed for firmware-oriented build, IntelliSense, and debug workflows.

The extension expects one open workspace folder. Its workflow features are designed for a single-root workspace and are treated as unsupported when no folder is open or when multiple workspace folders are open.

At a high level, the extension expects these workspace inputs:

- A manifest file as described in the `Manifest Structure` section and located using the settings described in the `Extension Configuration` section.
- A cargo workspace, artifacts root, and debug templates path located using the settings described in the `Extension Configuration` section.

The extension does not define or manage the repository's build system itself. It assumes that the workspace and its generated artifacts follow repository-specific conventions that the configured manifest and settings describe.

## Core Capabilities

The extension's main configuration surface is the Configuration view, a dedicated tree view in VS Code that is available from the activity bar.

At a high level, the tree view is organized like this:

```text
Trezor
└── Configuration
	├── Build Selection
	│   ├── Model
	│   ├── Target
	│   └── Component
	├── Build Options
	│   ├── [option group or option]
	│   └── ...
	└── Build Artifacts
		├── Compile Commands
		├── Binary
		├── Map File
		└── Executable
```

The core capabilities below describe what this side-bar experience enables for the user.

### Build Context Management

The extension provides a clear way to choose, review, and keep track of the active build context through the `Build Selection` part of the tree view.

The `Build Selection` section is structured around three selectors: model, target, and component.

The `Build Selection` section remains present in the tree view and is expanded by default.

Each selector is shown as a header row. The row label names the selector and the row description shows the currently active value. If no active build context has been resolved yet, the selector shows `—` instead of stale or guessed text.

Selecting a selector header expands its available choices under that row. Only one selector is expanded at a time, so opening one selector collapses the others.

When a selector is expanded, the available choices are shown in manifest-defined order. The active choice is marked explicitly in the list, and selecting a different choice immediately updates the active build context and refreshes the dependent state described in `Startup And Refresh Behavior`.

The active build context may also be shown in the VS Code status bar, giving the user a compact summary outside the Configuration view.

The available models, targets, and components are defined in the manifest file for the workspace.

At a high level, this part of the tree view is organized like this:

```text
Build Selection
├── Model
│   ├── T3W1
│   ├── T3T1
│   ├── T2T1
│   └── ...
├── Target
│   ├── Hardware
│   ├── Emulator
│   └── ...
└── Component
	├── Firmware
	├── Prodtest
	├── Bootloader
	└── ...
```

When the manifest is still loading, the section stays visible and shows a loading placeholder instead of hiding the selectors.

When the manifest file is missing, the section stays visible and shows a warning that the manifest file was not found together with the expected manifest path.

When the manifest file is invalid, the section stays visible and shows a warning summary of the validation error count together with a prompt to check the Problems view for details.

### Build Option Management

The extension provides a dedicated way to review and adjust build options for the active build context through the `Build Options` part of the tree view.

The `Build Options` section remains present in the tree view and is initially collapsed instead of being auto-expanded on activation.

The available build options are defined in the manifest file for the workspace.

- Build options represent option flags passed to the `cargo xtask` build utility used for building Trezor firmware.
- Build options may appear as checkbox options or multistate options. Checkbox options let the user turn an option on or off. Multistate options let the user choose one state from a fixed set of possible values.
- Each build option may also be enabled or disabled for a specific combination of model, target, and component through a `when` condition defined in the manifest file.
- Build options may also be grouped for readability. Grouping is visual organization inside the tree view rather than a separate configuration concept, so grouped and ungrouped options can appear together in the same section.

Checkbox options are adjusted directly on their own row.

Multistate options are shown as header rows whose descriptions show the currently active state. Expanding a multistate option reveals its available states, and selecting a state immediately makes it active for the current build context.

Grouped options are shown under group headers, while ungrouped options appear directly in the section. Grouping follows manifest declaration order, so grouped and ungrouped options can be interleaved in one section rather than being reordered into separate blocks.

Non-default selections are visually emphasized so users can distinguish changed values from the effective defaults at a glance. Option descriptions and multistate state descriptions are available as tooltips on the corresponding rows.

At a high level, this part of the tree view is organized like this:

```text
Build Options
├── Bitcoin Only
├── Debugging
│   └── ...
├── Signing
│   ├── Production
│   ├── QA Bootloader
│   └── ...
└── ...
```

This capability exists so workspace-defined build choices are easier to understand and update, especially when option availability depends on the current selection.

Only options that are available for the active build context are shown in the visible tree. If a previously saved value belongs to an option that is temporarily unavailable, that value is preserved as described in `Persistence And Defaults`, but the unavailable option is not shown as an active control until it becomes available again.

When the manifest is still loading, the section stays visible and shows a loading placeholder.

When the manifest is missing or invalid, the section stays visible and shows that build options are unavailable for that reason instead of showing stale controls.

When workflow-blocking availability-rule errors are present in the manifest, the section stays visible and shows a warning that the build workflow is blocked together with a prompt to check the Problems view for details.

When the manifest defines no build options at all, the section shows `No build options defined`.

When build options exist in the manifest but none apply to the current model, target, and component selection, the section shows `No options available for the active build context`.

### Workflow Actions

The extension provides a single in-editor entry point for common firmware workflows related to the active build context.

Workflow actions are available not only from artifact rows. They are also exposed from the Configuration view overflow menu, and selected high-priority actions are available directly as icons in the Configuration view header. Most workflow actions are also available from the VS Code Command Palette, and build-related actions are available as build tasks.

- **Build**: Produces the main build output for the active build context.
- **Clippy**: Runs lint-oriented checks for the active build context.
- **Check**: Runs validation-oriented checks without serving as the main build action.
- **Clean**: Clears build outputs so the user can restart from a clean workspace state.
- **Flash to Device**: Sends the active binary artifact to a device when that action is applicable.
- **Upload to Device**: Uploads the active binary artifact when that action is applicable.
- **Start Debugging**: Starts a debug session for the active build context when debugging is available.

Some workflow actions are available only when the manifest file defines them as applicable for the active build context. For example, `Flash to Device` and `Upload to Device` are available only when the selected component's `flashWhen` or `uploadWhen` condition matches the current model, target, and component selection.

### Build Artifacts

Build workflow actions create build artifacts for the active build context. These artifacts are shown in the `Build Artifacts` part of the tree view and can be used by other actions such as `Flash to Device`, `Upload to Device`, or `Start Debugging`.

At a high level, this part of the tree view is organized like this:

```text
Build Artifacts
├── Compile Commands
├── Binary         [Flash to Device] [Upload to Device]
├── Map File       [Open]
└── Executable     [Start Debugging]
```

- **Compile Commands**: Represents the compile commands artifact for the active build context and supports editor assistance aligned with that context.
- **Binary**: Represents the binary artifact produced for the active build context and is used by `Flash to Device` and `Upload to Device` when those actions are applicable.
- **Map File**: Represents the map file artifact associated with the active build context and exposes a row-level open action when the map file exists.
- **Executable**: Represents the executable artifact for the active build context and is used by `Start Debugging` when debugging is available.

Each artifact row uses its row description to show the current availability state for the active build context. When the artifact exists, the description shows `valid`. When it does not exist, the description shows `missing`.

Each artifact row also shows a tooltip containing the resolved artifact path for the active build context. When the artifact is missing, the tooltip must make clear that the artifact is missing and still show the resolved path that was checked.

Build-artifact state is refreshed when the active build context changes, when relevant workspace settings change, and when the expected artifact files for the active build context are created, updated, or deleted on disk. The extension reconciles the expected artifact files on a one-second interval while an active context is available, so this remains reliable even when an external tool does not produce a filesystem watcher event. This keeps the `Build Artifacts` section aligned when artifact-producing tools are run outside extension-managed tasks.

### Artifact Row Actions

Some artifact rows expose actions directly in the tree view rather than acting as general command surfaces.

- The `Binary` row can expose `Flash to Device` and `Upload to Device` when those actions are applicable.
- The `Map File` row can expose an open action when the active map file artifact exists.
- The `Executable` row can expose `Start Debugging` when debugging is available.

These row actions follow the same artifact and applicability state shown in the tree view. When the related artifact is missing, the row remains visible but its action is disabled.

#### Map File Open Action

The `Map File` row exposes an `Open` action directly on the row rather than through the Configuration view header, overflow menu, or Command Palette.

The action is enabled only when the active map file artifact exists. If the `Map File` row is present but the artifact is missing, the row remains visible and the action is disabled.

When the action succeeds, the extension opens the resolved map file in an editor.

If invocation is attempted without a valid map-file path, the action returns without opening anything. If opening the file fails after a path has been resolved, the extension shows a user-visible error and records the failure in log output.

## Configuration View Iconography

The `Trezor` activity-bar container and the `Configuration` view use the shared SVG icon asset from `images/tf-tools.svg` as their identifying icon. This is distinct from the extension package logo asset.

- Activity-bar container icon: `images/tf-tools.svg`
- Configuration view icon: `images/tf-tools.svg`
- Top-level section icons: none for `Build Selection`, `Build Options`, and `Build Artifacts`
- `Build Selection` selector icons: `circuit-board` for `Model`, `target` for `Target`, `extensions` for `Component`
- Active selector-choice icon: `check`
- Inactive selector-choice spacer: `images/blank-tree-icon.svg`
- Multistate build-option header icon: `list-selection`
- Active multistate-state icon: `check`
- Inactive multistate-state spacer: `images/blank-tree-icon.svg`
- Warning-row icon: `warning`
- Placeholder-row icon: `info`
- Artifact-row status icons: `pass` when the artifact is available, `error` when the artifact is missing
- `Build` action icon: `tools`
- `Clippy` action icon: `checklist`
- `Check` action icon: `check-all`
- `Clean` action icon: `trash`
- `Refresh IntelliSense` action icon: `refresh`
- `Flash to Device` action icon: `zap`
- `Upload to Device` action icon: `arrow-up`
- `Open Map File` action icon: `go-to-file`
- `Start Debugging` action icon: `debug-alt`

## Build Context Display Conventions

Several user-facing surfaces show the active build context using the same display conventions.

The shared build-context display format is:

```text
{model-name} | {target-display} | {component-name}
```

In that format, `target-display` uses the manifest target `shortName` when one is defined and otherwise uses the target `name`.

Some surfaces embed that shared format inside a larger label. For example, a workflow task may use a label such as:

```text
Build {model-name} | {target-display} | {component-name}
```

## Status Bar

The extension can show the active build context in the VS Code status bar as a compact summary outside the Configuration view.

This surface exists so the current model, target, and component remain visible even when the Configuration view is not focused.

### Displayed Information

When visible, the status bar shows the active build context using the shared display conventions defined in `Build Context Display Conventions`.

### Visibility Rules

The status bar item is shown only when all of these conditions are true:

- the manifest is loaded successfully
- the active build context resolves to current manifest entries
- `tfTools.showConfigurationInStatusBar` is enabled

If any of these conditions stops being true, the status bar item is hidden rather than shown with stale or partial information.

### Interaction

The status bar entry is not only informational. Selecting it focuses the extension's `Configuration` view so the user can move directly from the compact summary to the full build-selection and build-option surface.

### Refresh Behavior

The status bar stays aligned with the same active build context and manifest state described in `Startup And Refresh Behavior`.

It is refreshed when the active build context changes, when manifest reload changes the resolved selection labels, and when `tfTools.showConfigurationInStatusBar` is toggled.

## IntelliSense

The extension aligns C/C++ editor assistance with the active build context through the `Compile Commands` artifact shown in `Build Artifacts`.

This capability has two user-visible outcomes:

- the active compile database is used to drive IntelliSense for the current model, target, and component selection
- the same inclusion data can also be used to mark files that are outside the active build configuration

### Compile Commands And Provider Integration

The extension resolves the expected compile-commands artifact for the active build context and treats that artifact as the source of truth for IntelliSense.

The expected compile-commands path is constructed as `<artifacts-root>/<artifactFolder>/<artifactName><artifactSuffix>.cc.json`, where `artifacts-root` comes from `tfTools.artifactsPath`, `artifactFolder` comes from the selected model, `artifactName` comes from the selected component, and `artifactSuffix` comes from the selected target and defaults to an empty string when omitted.

The `Compile Commands` row in `Build Artifacts` shows whether that artifact is currently available for the active build context. When the artifact exists, the row shows `valid` and its tooltip shows the resolved artifact path. When it does not exist, the row shows `missing` and its tooltip states that the artifact is missing and shows the resolved artifact path that was checked.

When IntelliSense refresh runs and the active compile-commands artifact is available, the extension parses the active compile database and applies the resulting configuration through the active IntelliSense backend so editor assistance follows the currently selected model, target, and component.

The extension supports two IntelliSense backends and selects one automatically:

- **Microsoft C/C++ (`cpptools`)** is preferred. It is used when the installed `ms-vscode.cpptools` extension exposes the supported custom-configuration API and the workspace `C_Cpp.default.configurationProvider` setting points to `cepetr.tf-tools`. In this mode the parsed compile database is pushed to cpptools through its custom configuration provider.
- **clangd (`llvm-vs-code-extensions.vscode-clangd`)** is used as a fallback when cpptools cannot be used — either because the Microsoft C/C++ extension is not installed (as in editors such as Cursor, which provide C/C++ support through clangd instead) or because an installed Microsoft C/C++ extension does not expose the supported custom-configuration API — and the clangd extension is installed. In this mode the extension points clangd at the active compile database rather than pushing per-file configuration.

When cpptools is installed but a different configuration provider is active, the extension treats this as a misconfiguration to be fixed and does not silently fall back to clangd.

When the clangd backend is active, the extension makes the active compile database discoverable to clangd without requiring manual setup:

- it maintains a managed compile database at `.tf-tools/compile_commands.json` in the workspace root as a link to the active compile-commands artifact, and retargets that link whenever the active build context changes;
- it ensures the workspace `.clangd` configuration points clangd at the `.tf-tools` directory. If no `.clangd` file exists, the extension creates one it owns and marks it as managed by Trezor Firmware Tools. If a `.clangd` file already exists without the managed marker and without a matching `CompilationDatabase` entry, the extension does not modify it and instead logs a warning that clangd may not discover the managed compile database;
- it restarts the clangd language server after applying or clearing the managed compile database so clangd reloads the current configuration.

The managed `.tf-tools/compile_commands.json` link and the managed `.clangd` file are generated workspace-local artifacts rather than authored configuration, so they are not intended for version control.

The extension does not intentionally keep using a stale compile database from another build context. If the expected active artifact is unavailable, it clears the previously applied IntelliSense state instead of silently reusing a different artifact. For the clangd backend, clearing removes the managed `.tf-tools/compile_commands.json` link and restarts clangd.

### Excluded-File Visibility

The same active compile database is also used to determine whether a file belongs to the active build configuration.

Files outside the active compile database can be marked as excluded when they also match the excluded-file scope configured through `tfTools.excludedFiles.fileNamePatterns` and `tfTools.excludedFiles.folderGlobs`.

The excluded-file scope follows these rules:

- `fileNamePatterns` is matched against the file basename only, including name and extension.
- `fileNamePatterns` matching is case-sensitive and does not support subpath matching.
- `folderGlobs` can be written either as absolute paths or as paths relative to the workspace root.
- `folderGlobs` can use `**` to match recursively under all subfolders of a directory.
- both setting lists use `/` separators in patterns, and candidate file paths are normalized to `/` separators before matching.
- if either `fileNamePatterns` or `folderGlobs` is empty, excluded-file marking is effectively disabled until both lists contain at least one value.

When a file is marked excluded:

- the VS Code Explorer shows an exclusion badge
- the Explorer can also gray the file when `tfTools.excludedFiles.grayInTree` is enabled
- open editors can show a first-line warning overlay when `tfTools.excludedFiles.showEditorOverlay` is enabled

These indicators explain that the file is not included in the active build configuration.

Excluded-file visibility is therefore part of the IntelliSense capability, but it is a separate user-facing outcome from compile-database-driven editor configuration.

### Refresh And Warning Behavior

IntelliSense state refreshes automatically as described in `Startup And Refresh Behavior`, including activation, manifest changes, active build-context changes, relevant artifact-file changes for the active build context, artifact-path changes, workspace changes, and relevant setting changes.

The extension also provides `Refresh IntelliSense` as a manual way to re-run IntelliSense evaluation for the active build context without changing the current selection.

When IntelliSense prerequisites are not satisfied, the extension reports that state explicitly instead of silently pretending IntelliSense is aligned:

- if the active compile-commands artifact is missing, the extension clears previously applied IntelliSense state and the `Compile Commands` row shows the missing state
- if no supported IntelliSense backend is available — neither the Microsoft C/C++ extension exposing the supported custom-configuration API nor the clangd extension — the extension reports that IntelliSense integration is unavailable
- if the Microsoft C/C++ extension is installed but a different configuration provider is active, the extension reports the misconfiguration and can offer a workspace-setting fix, and does not fall back to clangd while that misconfiguration stands

When excluded-file input data becomes unavailable, excluded-file badges and overlays are also cleared so stale excluded-file state does not remain visible after the active context changes.

## Extension Configuration

The extension exposes workspace-scoped VS Code settings under the `tfTools` namespace. These settings let a workspace maintainer point the extension at the correct manifest, cargo workspace, artifacts directory, and debug-template directory, configure workflow task environment, and control optional UI behavior.

At a high level, the settings fall into four groups:

- **Workspace paths**: Control where the extension looks for the manifest file, the cargo workspace, build artifacts, and debug templates.
- **Task environment**: Control extra environment variables merged into workflow task processes.
- **Visibility settings**: Control whether the active build context is shown in the status bar and how excluded files are marked in the Explorer and editors.
- **Excluded-file scope settings**: Control which files are eligible to be marked as excluded from the active build configuration.

### Configuration Variable References

String values in tf-tools resource-scoped settings support a subset of VS Code variable references from the editor variables reference. VS Code does not expand these references when settings are read through the Extension API, so the extension resolves them when consuming affected settings.

Supported references include:

- `${workspaceFolder}` and the deprecated `${workspaceRoot}` alias
- `${workspaceFolderBasename}`
- `${env:NAME}`
- `${config:section.key}`
- `${userHome}` and `${cwd}`

Other VS Code variable forms are left unchanged, including editor, selection, command, input, executable-path, and path-separator references.

Variable substitution is single-pass. Substituted values are not re-expanded.

This applies to path settings, `tfTools.taskExtraEnv`, and excluded-file glob settings. Boolean settings are not subject to variable expansion.

### Workspace Path Settings

- `tfTools.manifestPath`: string, default `core/embed/xtask/tf-tools/manifest.yaml`. Path to the manifest file, relative to the workspace root unless given as an absolute path or expanded to one through configuration variable references.
- `tfTools.cargoWorkspacePath`: string, default `core/embed`. Path to the cargo workspace used for build-related tasks, relative to the workspace root unless given as an absolute path or expanded to one through configuration variable references. If the setting is cleared, the workspace root is used.
- `tfTools.artifactsPath`: string, default `core/build-xtask/artifacts`. Absolute or workspace-relative path to the build artifacts directory. If the setting is cleared, artifact-based IntelliSense resolution is disabled. Supports configuration variable references.
- `tfTools.debug.templatesPath`: string, default `core/embed/xtask/tf-tools/debug`. Path to the directory that contains debug template files, relative to the workspace root unless given as an absolute path or expanded to one through configuration variable references.

### Task Environment Settings

- `tfTools.taskExtraEnv`: object with string keys and string values, default `{}`. Extra environment variables merged into tf-tools workflow task processes on top of the VS Code session environment. Applies to `Build`, `Clippy`, `Check`, `Clean`, `Flash to Device`, and `Upload to Device` tasks launched by the extension. Keys and values support configuration variable references as described above. Non-object values and non-string entries are ignored.

### Visibility Settings

- `tfTools.showConfigurationInStatusBar`: boolean, default `true`. Controls whether the active build configuration is shown in the VS Code status bar.
- `tfTools.excludedFiles.grayInTree`: boolean, default `true`. Controls whether excluded files are grayed in the Explorer in addition to showing an exclusion badge.
- `tfTools.excludedFiles.showEditorOverlay`: boolean, default `true`. Controls whether excluded files show a warning overlay in the editor.

### Excluded-File Scope Settings

- `tfTools.excludedFiles.fileNamePatterns`: array of strings, default `['*.c']`. Basename-only, case-sensitive glob patterns that define which file names are eligible for excluded-file marking. Supports configuration variable references in each pattern string.
- `tfTools.excludedFiles.folderGlobs`: array of strings, default `['core/embed/**', 'core/vendor/**']`. Absolute or workspace-relative folder globs that define where excluded-file marking applies, including recursive matches with `**`. Supports configuration variable references in each pattern string.

These settings are intended to be adjusted at the workspace level so the extension behaves consistently for all users working in the same repository.

## Startup And Refresh Behavior

The extension keeps the tree view, status bar, IntelliSense integration, artifact state, and workflow availability aligned with the current workspace state. This behavior starts at activation and continues whenever the manifest, relevant settings, or the active build context change.

### Activation

When the extension activates, it always registers the configuration tree view and initializes the dedicated log output so the side-bar surface and persistent failure trail are available immediately.

If the workspace is unsupported or no workspace folder is open, the extension shows a warning, keeps workflow actions blocked, and does not attempt to load workspace-specific manifest, artifact, or IntelliSense state.

If the workspace is supported, the extension:

- Resolves the configured manifest path, artifacts path, cargo workspace path, and debug templates path.
- Starts the manifest service and begins watching the configured manifest file.
- Initializes the status-bar presenter, IntelliSense service, and excluded-file visibility services.
- Restores the persisted active build context when possible and normalizes it against the loaded manifest if previously saved values are no longer valid.
- Restores persisted build-option selections and resolves them against the active build context.
- Updates the tree view, status bar, diagnostics, log output, workflow blocking state, artifact rows, and action enablement from the loaded state.
- Schedules an initial IntelliSense refresh.

### Manifest Change

The manifest service watches the configured manifest file for create, change, and delete events and reloads it with debounce behavior so rapid edits do not trigger excessive refreshes.

When the manifest changes:

- The manifest is re-read and re-validated.
- Diagnostics and log output are refreshed to reflect the new manifest state.
- The active build context is restored and normalized again so stale model, target, or component ids are replaced with valid selections.
- Build options are re-resolved against the updated manifest and the current active build context.
- The tree view is refreshed, including build selection, build options, warning states, and artifact rows.
- Workflow blocked state, artifact-action applicability, and debugging availability are recomputed.
- IntelliSense is updated with the new manifest state and refreshed so compile-commands and excluded-file state follow the new configuration.

If the manifest becomes missing or invalid, the extension keeps the UI available but shows the failure through warnings, diagnostics, log output, and blocked workflow state. Missing manifests are warning-level log records; invalid manifests are error-level log records.

### Setting Change

The extension reacts to changes in relevant `tfTools` settings without requiring a window reload.

- If `tfTools.manifestPath` changes, the extension restarts the manifest service for the newly resolved file path and then follows the normal manifest-change flow.
- If `tfTools.artifactsPath` changes, the extension updates artifact resolution immediately, refreshes build-artifact rows, recomputes artifact-dependent action state, and refreshes IntelliSense.
- If `tfTools.debug.templatesPath` changes, the extension refreshes debug-related availability state so subsequent debug launches use the new templates location.
- If `tfTools.showConfigurationInStatusBar` changes, the status bar is updated immediately.
- If `tfTools.taskExtraEnv` changes, subsequent workflow task launches use the updated environment. Existing running tasks are not restarted.
- If any excluded-file visibility or scope setting changes, the extension refreshes excluded-file evaluation so Explorer decorations and editor overlays match the new settings.

### Active Build Context Change

When the user changes the active model, target, or component from the tree view, the extension persists the new active build context and refreshes dependent state immediately.

- The selected model, target, or component is written to workspace state.
- The resulting build context is normalized so the saved combination always resolves to valid manifest entries.
- Build options are re-resolved for the new context, so context-specific options may appear, disappear, or change availability.
- The tree view is refreshed to show the new active selection, updated option state, and updated artifact rows.
- The status bar is refreshed to show the new active configuration when enabled.
- IntelliSense is refreshed so compile-commands, excluded-file evaluation, and related editor assistance follow the new context.
- Flash, upload, map-file, and debugging availability are recomputed from the new context and current artifact state.

### Other Refresh Triggers

- Relevant artifact-file changes for the active build context refresh build-artifact state and IntelliSense so newly produced, updated, or removed artifacts become visible in the tree view and related actions without requiring the build to be launched by the extension.
- A manual IntelliSense refresh command re-runs IntelliSense evaluation without changing the active build context.
- Workspace-folder changes trigger IntelliSense refresh so excluded-file evaluation stays aligned with the current workspace shape.

## Persistence And Defaults

The extension remembers the active build context and build-option selections in workspace-scoped persistent state so they can be restored across sessions for the same workspace.

### Active Build Context Persistence

The extension persists the selected model, target, and component as the active build context.

When the workspace is opened again and the manifest loads successfully, the extension restores that saved build context if the saved ids still resolve to manifest entries.

If a saved model, target, or component id no longer exists after a manifest change, the extension normalizes that part of the saved build context to a valid entry from the current manifest. The extension uses the first available entry of that kind when a saved value is missing or stale.

This normalization behavior is also part of the refresh flow described in the `Startup And Refresh Behavior` section.

### Build Option Persistence

The extension persists build-option selections separately from the active model, target, and component selection.

- Checkbox options are stored as enabled or disabled selections.
- Multistate options are stored as the selected state.

When the extension restores build-option selections, it resolves them against the current active build context and current manifest.

If an option is temporarily unavailable in the current context, its saved value is preserved but does not affect the visible UI or emitted build arguments until the option becomes available again.

### Default Values

When no active build context has been saved yet, the extension defaults to the first available model, first available target, and first available component from the loaded manifest.

When no explicit build-option value has been saved yet:

- Checkbox options default to disabled.
- Multistate options default to the manifest-defined default state.
- If no multistate state is marked as default, the first state in the manifest-defined order becomes the effective default.

### Invalid Saved State After Manifest Change

If the manifest changes and previously saved state no longer matches the current manifest:

- Saved model, target, and component ids are replaced with valid current entries, as described above.
- Saved multistate selections that no longer match any current state fall back to the option's effective default selection.
- Saved values for options that are merely unavailable in the current context are preserved and may become active again if the context changes back.

This behavior ensures that the extension restores as much prior workspace state as possible while keeping the active UI and emitted build arguments consistent with the current manifest.

## Availability And Blocking Model

This section defines the shared rules used by user-facing commands and command surfaces.

### Availability States

User-facing commands and actions may be visible and executable, visible but disabled, or unavailable for the current workspace state.

A command or action is considered available when the current workspace, manifest state, active build context, and required artifacts satisfy its preconditions.

A command or action is considered unavailable when the current context does not support that behavior at all. In that case, the command may be hidden from context-specific surfaces rather than shown in a disabled state.

A command or action is considered blocked when it belongs to the current command surface but execution is prevented by a known blocking condition such as unsupported workspace state, missing manifest, invalid manifest, missing required artifact, or failed applicability checks.

### Shared Blocking Conditions

The extension uses shared blocking rules across workflow-oriented commands.

Commands may be blocked when:

- no supported workspace folder is open
- the manifest file is missing
- the manifest file is invalid
- workflow-blocking manifest validation issues are present
- the active build context is incomplete or unresolved
- a command depends on an artifact that does not exist
- a command is defined only for contexts where a manifest rule, such as `when`, `flashWhen`, or `uploadWhen`, matches the current selection, and that rule does not match

Some commands also have command-specific blocking conditions. These are documented in the relevant command sections below.

### Hidden Versus Disabled Versus Blocked

The extension distinguishes between hidden actions, disabled actions, and blocked commands.

A command or action is hidden when it does not apply to the current surface or current build context and should not be presented as a current choice.

A command or action is disabled when it is still meaningful to show the user, but execution is not currently possible. This is used when the user benefits from seeing that the action exists but cannot run yet because a prerequisite is missing.

A command is blocked when the user invokes it from a surface where it is exposed, but the extension rejects execution because the current workspace or manifest state does not allow the operation. In blocked cases, the extension reports the reason through the appropriate user-facing feedback channel.

In general:

- hidden means the action is not presented for the current context
- disabled means the action is presented but cannot currently be executed
- blocked means execution was attempted but the extension refused it because a precondition was not met

## Command Surface

This section documents the user-facing commands, where they appear, and the rules that govern their availability and execution.

Workflow actions that launch `cargo xtask` run `cargo` directly from the configured cargo workspace path using `ProcessExecution`. They inherit the VS Code session environment and merge any entries from `tfTools.taskExtraEnv` after resolving configuration variable references in that setting. They avoid shell-mediated startup so user shell scripts cannot unexpectedly replace toolchain-related environment variables such as `PATH` or `VIRTUAL_ENV`.

### Build

#### Purpose

`Build` is the primary workflow command for producing the main build output for the current model, target, and component selection.

It runs the repository build workflow for the active build context and uses the currently effective build-option selections that apply to that context.

Among workflow actions, `Build` is treated as the main entry point and the default build-oriented action in the Configuration view command surface.

#### Surfaces

`Build` is exposed in these user-facing surfaces:

- as the primary action in the Configuration view header
- in the Configuration view overflow menu
- in the VS Code Command Palette as `Trezor: Build`
- through the VS Code task system as a workspace task for the current active build context

When shown through the VS Code task system, the `Build` task uses a context-specific label based on the shared display conventions defined in `Build Context Display Conventions`, with the `Build ` prefix added ahead of the active build-context display. `Clean` is the only workflow task that uses a fixed label without context-specific suffixes.

Within the VS Code task system, `Build` is also the only workflow task contributed as the primary build task.

#### Preconditions

`Build` follows the shared workflow blocking rules defined in `Availability And Blocking Model`.

In practice, `Build` requires:

- one supported workspace folder
- a manifest that is present and valid
- an active build context that resolves to current manifest entries
- no workflow-blocking manifest issues

`Build` does not require pre-existing output artifacts, because producing build output is the purpose of the command.

The command always uses the currently active model, target, and component selection together with the currently effective build-option selections.

When launched, `Build` runs from the cargo workspace path configured through `tfTools.cargoWorkspacePath` and uses the workflow task environment described above.

The task invokes `cargo xtask build` for the active build context.

At a high level, the command-line shape is:

```text
cargo xtask build <component-id> -m <model-id> [target flag] [effective build-option flags]
```

- `<component-id>` comes from the active component selection.
- `<model-id>` comes from the active model selection.
- `[target flag]` is included only when the selected target defines one in the manifest.
- `[effective build-option flags]` are derived from the build options that are currently available and selected for the active build context.

#### Blocked Behavior

When the shared workflow state is blocked, the Configuration view header entry and overflow entry remain visible but disabled instead of appearing as runnable actions.

If the user invokes `Build` from a surface that still allows invocation while workflow execution is blocked, the extension rejects execution, shows an error message that explains the blocking reason, and writes the failure to the dedicated log output.

If task launch itself fails after preconditions are satisfied, the extension reports that startup failure through an error message and the log output.

#### Successful Result

When `Build` starts successfully, the extension launches the corresponding build task for the active build context.

Starting the command alone does not refresh artifact or IntelliSense state.

When the expected artifact files for the active build context are then created, updated, or deleted on disk, the extension refreshes build-artifact state and IntelliSense-related state so the `Build Artifacts` section, artifact-dependent actions, compile-commands resolution, and excluded-file evaluation reflect the resulting outputs.

This means artifact-producing tools can make artifact rows become available or change status without requiring the user to reload the window or manually refresh the extension state, even when those tools are run outside extension-managed tasks.

### Clippy And Check

#### Purpose

`Clippy` and `Check` are workflow commands for running non-primary validation workflows for the active build context.

`Clippy` runs lint-oriented checks for the current model, target, and component selection. `Check` runs validation-oriented checks for the same active build context without serving as the main build action.

Both commands use the same active build context and the same effective build-option selections as `Build`.

#### Surfaces

`Clippy` and `Check` use the same general command surfaces as `Build`, with one important difference: unlike `Build`, they are not primary header actions.

They are exposed:

- in the Configuration view overflow menu
- in the VS Code Command Palette as `Trezor: Run Clippy` and `Trezor: Run Check`
- through the VS Code task system as workspace tasks for the current active build context

When shown through the VS Code task system, both tasks use the shared display conventions defined in `Build Context Display Conventions`, with `Clippy ` or `Check ` added ahead of the active build-context display.

#### Preconditions

`Clippy` and `Check` follow the same workflow preconditions and shared blocking rules as `Build`.

Like `Build`, they require a supported workspace, a present and valid manifest, a resolved active build context, and no workflow-blocking manifest issues.

They also use the cargo workspace path configured through `tfTools.cargoWorkspacePath` and the workflow task environment described above.

Their command-line shape follows the same argument mapping as `Build`, but with a different xtask subcommand:

```text
cargo xtask clippy <component-id> -m <model-id> [target flag] [effective build-option flags]
cargo xtask check <component-id> -m <model-id> [target flag] [effective build-option flags]
```

That means both commands use the active component selection, active model selection, optional target flag, and effective build-option flags in the same way as `Build`.

#### Blocked Behavior

`Clippy` and `Check` use the same blocked-behavior model as `Build`.

When workflow execution is blocked, their Configuration view overflow entries remain visible but disabled. If invocation is attempted from a surface that still allows execution, the extension rejects the action, shows a user-visible error, and writes the failure to log output.

If task launch fails after preconditions are satisfied, the extension reports that startup failure through an error message and the log output.

#### Successful Result

When either command starts successfully, the extension launches the corresponding workspace task for the active build context.

Unlike `Build`, successful completion of `Clippy` or `Check` does not trigger build-artifact refresh or IntelliSense refresh. Their successful result is the completion of the requested validation workflow itself, not an update of artifact-driven extension state.

### Clean

#### Purpose

`Clean` clears build outputs so the user can restart from a clean workspace state.

Unlike `Build`, `Clippy`, and `Check`, it is not a context-specific validation or build command. Its purpose is to run the workspace clean workflow rather than to execute the active build context with derived build arguments.

#### Surfaces

`Clean` is exposed in the same secondary workflow surfaces as `Clippy` and `Check`:

- in the Configuration view overflow menu
- in the VS Code Command Palette as `Trezor: Run Clean`
- through the VS Code task system as a workspace task

When shown through the VS Code task system, `Clean` is the only workflow task that uses a fixed label rather than a context-specific label. Its task label is simply `Clean`.

#### Preconditions

`Clean` follows the same shared workflow blocking rules as `Build`, `Clippy`, and `Check`.

It requires a supported workspace, a present and valid manifest, a resolved workflow state, and no workflow-blocking manifest issues. It also runs from the cargo workspace path configured through `tfTools.cargoWorkspacePath` and uses the workflow task environment described above.

Its invocation differs from the other workflow tasks because it does not use active-build-context-derived arguments:

```text
cargo xtask clean
```

That means `Clean` does not append model, target, component, or build-option arguments.

#### Blocked Behavior

`Clean` uses the same blocked-behavior model as the other workflow commands.

When workflow execution is blocked, its Configuration view overflow entry remains visible but disabled. If invocation is attempted from a surface that still allows execution, the extension rejects the action, shows a user-visible error, and writes the failure to log output.

If task launch fails after preconditions are satisfied, the extension reports that startup failure through an error message and the log output.

#### Successful Result

When `Clean` starts successfully, the extension launches the corresponding workspace task. After successful completion, the extension refreshes the active artifact and IntelliSense state so deleted build outputs are immediately reflected in the Configuration view and workflow command availability.

### Flash And Upload

#### Purpose

`Flash to Device` and `Upload to Device` are artifact-driven workflow commands that operate on the active binary artifact when that action is applicable for the current build context.

They exist to let the user send the active firmware output to a device-oriented downstream workflow without leaving the extension's main workflow surfaces.

#### Surfaces

`Flash to Device` and `Upload to Device` are exposed in the same kinds of command surfaces:

- in the VS Code Command Palette, but only when the corresponding action is applicable
- in the Configuration view overflow menu, but only when the corresponding action is applicable
- as inline actions on the `Binary` row in `Build Artifacts`, but only when the corresponding action is applicable

Unlike `Build`, `Clippy`, `Check`, and `Clean`, these actions are launched as on-demand tasks rather than as standard workflow tasks exposed through the task provider.

#### Applicability And Preconditions

These commands follow the shared availability model, but they add action-specific applicability and artifact requirements.

For either action to be executable, all of the following must be true:

- the workspace is supported
- the manifest is present and valid
- the active build context is resolved
- the corresponding action is applicable for the active build context
- the active binary artifact exists

Applicability is controlled separately for the two actions:

- `Flash to Device` is applicable only when the selected component defines `flashWhen` and that rule matches the active build context
- `Upload to Device` is applicable only when the selected component defines `uploadWhen` and that rule matches the active build context

If the selected component does not define the corresponding rule, that action is unavailable for that context.

When launched, both actions run from the cargo workspace path configured through `tfTools.cargoWorkspacePath` and use the workflow task environment described above.

Their command-line shapes are:

```text
cargo xtask flash <component-id> -m <model-id>
cargo xtask upload <component-id> -m <model-id>
```

Unlike `Build`, `Clippy`, and `Check`, these commands do not append target flags or build-option flags.

#### Labels And Task Shape

When the extension launches one of these actions as a task, it uses a context-specific label based on the shared display conventions defined in `Build Context Display Conventions`.

At a high level, the task labels are:

```text
Flash to Device {model-name} | {target-display} | {component-name}
Upload to Device {model-name} | {target-display} | {component-name}
```

These tasks are on-demand workflow launches and are not contributed as standard build-task picker entries.

#### Blocked Behavior

These actions follow the same general blocked-behavior model as other commands, but they can also be blocked by action-specific conditions.

If an action is not applicable for the current build context, it is not offered on context-sensitive surfaces. If it is applicable but the binary artifact is missing, the action remains visible where appropriate but is disabled.

If invocation is attempted while the action is blocked, the extension shows a user-visible error explaining whether the failure is due to unsupported workspace state, missing or invalid manifest, inapplicable action, or missing binary artifact, and records the blocked attempt in log output.

If task launch fails after preconditions are satisfied, the extension reports that startup failure through an error message and the log output.

#### Successful Result

When either action starts successfully, the extension launches the corresponding on-demand task for the active build context.

Unlike `Build`, successful completion of `Flash to Device` or `Upload to Device` does not trigger automatic build-artifact refresh or IntelliSense refresh. Their successful result is completion of the requested downstream action itself.

### Start Debugging

#### Purpose

`Start Debugging` starts a VS Code debug session for the active build context when the extension can resolve a matching debug profile for the selected component and the expected executable artifact exists.

This action is intended to let the user launch the correct debug configuration directly from extension-managed state, without editing workspace debug configuration by hand.

The same extension-managed state also drives tf-tools-owned entries in VS Code `Run and Debug`, so users can start debugging with standard debug controls such as `F5` without creating or editing `.vscode/launch.json`.

#### Surfaces

`Start Debugging` is exposed on the command surfaces that are directly tied to the active build context:

- The `Configuration view` header.
- The `Configuration view` overflow menu.
- The `Executable` row in `Build Artifacts` as a row action.
- The Command Palette as `Trezor: Start Debugging`.
- VS Code `Run and Debug` as generated tf-tools-owned debug entries for the active build context.

The Command Palette entry is more restrictive than the visible `Configuration view` actions. It is shown only when debugging is currently startable for the active build context.

The `Configuration view` header, overflow menu, `Executable` row action, and Command Palette continue to launch the default matching debug profile immediately. When more than one profile matches, `Run and Debug` additionally exposes profile-specific entries for profile selection.

#### Preconditions

At a high level, debugging is considered available only when all of the following are true:

- The workspace is in a supported state and the manifest is loaded without debug-blocking issues.
- The active model, target, and component resolve to real manifest entries.
- The selected component provides at least one debug profile that matches the active build context.
- The expected executable artifact for the active build context exists.

The executable path is derived from the active build context and the manifest-defined artifact metadata, then checked on disk.

Visible `Start Debugging` actions in the `Configuration view` stay present but disabled when a matching debug profile cannot be resolved or when the executable artifact is missing.

The `Executable` row reflects the same readiness state through its `valid` or `missing` status and tooltip.

`Run and Debug` entry availability is derived from the same manifest, active-context, matching-profile, and executable-artifact checks. Template-file problems, invalid template content, and unresolved tf-tools debug variables remain invocation-time failures rather than hidden availability conditions.

#### Debug Profile Selection

Debugging is resolved only from the selected component's manifest-defined debug profiles.

The extension evaluates those profiles against the active build context and selects the first matching profile in declaration order. A profile without a `when` condition acts as a match-all entry for that component.

The manifest debug model does not support separate profile-priority fields or any other custom precedence layer. When multiple profiles match, declaration order alone decides which profile is selected.

Unsupported legacy debug schema forms, such as top-level debug entries, profile-level executable overrides, priority fields, or obsolete tf-tools variable aliases, MUST be treated as invalid manifest content rather than silently remapped.

If no profile matches, debugging is treated as unavailable for the active build context.

#### Template Resolution

After a matching debug profile is selected, `Start Debugging` loads the profile's debugger template from the configured debug templates path for that invocation.

The template is treated as an input file rather than persisted workspace configuration. The extension resolves tf-tools substitution variables for the active build context, applies them to the template, and launches the resulting configuration through the VS Code debug API.

The extension does not preload or cache debug templates across invocations. Changes to a template file take effect on the next `Start Debugging` attempt.

Template-file problems do not preemptively hide or disable visible `Start Debugging` actions when profile matching and executable checks already pass. They are treated as invocation-time failures.

#### Substitution Variables

`Start Debugging` supports a fixed set of substitution variables in debug templates.

The built-in variables are:

- `${tfTools.artifactPath}` for the active artifact folder path.
- `${tfTools.model.id}` and `${tfTools.model.name}` for the selected model.
- `${tfTools.target.id}` and `${tfTools.target.name}` for the selected target.
- `${tfTools.component.id}` and `${tfTools.component.name}` for the selected component.
- `${tfTools.executable}` for the derived executable file name.
- `${tfTools.executablePath}` for the derived executable path.
- `${tfTools.debugProfileName}` for the selected debug profile name.

The selected debug profile can also contribute additional variables, exposed as `${tfTools.debug.var:<name>}`.

Substitution is applied to string fields throughout the resolved template, including nested objects and arrays. It replaces only tf-tools variables, leaves non-tf-tools variable syntax unchanged for downstream handling, and runs as a single pass rather than repeatedly expanding replacement results.

For example, a debug template may look like this:

```jsonc
{
	"name": "${tfTools.model.id} | ${tfTools.component.name}",
	"executable": "${tfTools.artifactPath}/kernel.elf",
	"request": "attach",
	"type": "cortex-debug",
	"runToEntryPoint": "main",
	"servertype": "openocd",
	"configFiles": [
		"interface/stlink.cfg",
		"target/stm32u5x.cfg"
	],
	"svdFile": ".vscode/STM32U5Gx.svd",
	"postAttachCommands": [
		"monitor adapter speed 8000",
		"add-symbol-file ${tfTools.executablePath}"
	],
	"presentation": {
		"group": "STM32U5"
	},
}
```

Unknown, invalid, cyclic, or otherwise unresolved tf-tools variables block the launch attempt with a user-visible failure.

#### Blocked And Failure Behavior

If the active build context does not support debugging, `Start Debugging` follows the extension's general blocked-behavior model and reports a user-visible failure instead of starting a session.

Blocked or failed launch attempts include cases such as:

- No matching debug profile for the selected component.
- Missing executable artifact.
- Invalid manifest debug state.
- Unknown active model, target, or component references.
- Missing template file.
- Template path escaping the configured templates root.
- Invalid template content.
- Unknown or unresolved tf-tools debug variables.
- VS Code refusing to start the resolved debug configuration.
- A tf-tools-generated `Run and Debug` entry being started after the active build context has changed.

When launch is blocked by debug-specific resolution, template, variable, or artifact problems, the extension shows an error message and records the failure in the log output. For most blocked debug-launch states, the extension also reveals the log output to direct the user to the detailed failure reason.

When a generated `Run and Debug` entry was created for an older active build context and the user starts it after the context has changed, the extension rejects the stale entry instead of silently redirecting it to the new context.

#### Successful Result

When `Start Debugging` succeeds, the extension starts the resolved debug session for the active build context and then reveals the `Run and Debug` view.

Unlike build-workflow commands, `Start Debugging` does not create or refresh build artifacts as part of its successful result. Its successful result is the start of the requested debug session itself.

### Refresh IntelliSense

#### Purpose

`Refresh IntelliSense` manually re-runs IntelliSense evaluation for the active build context.

Its purpose is to let the user ask the extension to recompute compile-commands resolution, provider readiness, and excluded-file state without changing the active model, target, or component selection.

#### Surfaces

`Refresh IntelliSense` is exposed in secondary command surfaces rather than as a primary workflow action:

- in the Configuration view overflow menu
- in the VS Code Command Palette as `Trezor: Refresh IntelliSense`

It is not exposed as a Configuration view header action, an artifact row action, or a build task.

#### Preconditions

`Refresh IntelliSense` does not use the same strict blocked-workflow model as build-oriented commands.

The command can be invoked even when IntelliSense cannot currently be applied. In that sense, its role is to refresh the extension's IntelliSense state rather than to launch a workflow that requires all prerequisites up front.

Its meaningful result depends on the current workspace and active build-context state, including:

- a supported workspace
- a loaded manifest
- a resolved active build context
- a configured artifacts path
- an available compile-commands artifact for the active build context
- a ready IntelliSense provider configuration

If some of those conditions are missing, the command still completes, but the refresh result reflects the missing or degraded state rather than applying a valid IntelliSense configuration.

#### Result

When invoked, `Refresh IntelliSense` schedules the same IntelliSense refresh pipeline that is also used by automatic refresh triggers elsewhere in the extension.

At a high level, the refresh:

- re-evaluates the active compile-commands artifact for the current build context
- re-checks IntelliSense-provider readiness
- applies the refreshed compile-commands payload when the artifact and provider are both ready
- clears previously applied IntelliSense state when the artifact is missing, the manifest or active context is unavailable, or the provider is not ready
- updates the `Compile Commands` artifact row in `Build Artifacts`
- updates excluded-file evaluation that depends on the active compile database

If the refresh detects a provider-configuration problem, the extension reports that state through its normal warning and log channels and may offer a fix action when the wrong configuration provider is active.

Unlike build-workflow commands, `Refresh IntelliSense` does not change the active build context or produce new artifacts. Its result is an updated IntelliSense integration state for whatever the current workspace and artifact conditions allow.

### Show Logs

#### Purpose

`Show Logs` opens the extension's dedicated log output so the user can inspect persistent runtime detail for manifest loading, workflow execution, IntelliSense refresh, and debug-launch behavior.

Its purpose is diagnostic rather than workflow-oriented. It gives the user direct access to the extension's log output when warnings, blocked actions, or refresh problems need more detail than a popup or tree-view state provides.

#### Surfaces

`Show Logs` is exposed as the `Trezor: Show Logs` command in the VS Code Command Palette.

It is not exposed as a Configuration view header action, overflow action, artifact row action, or task.

#### Result

When invoked, `Show Logs` reveals the extension's `Trezor Firmware Tools` output channel in the VS Code panel.

The command does not depend on the active build context, does not require a valid manifest or supported workflow state, and does not change extension state by itself. Its result is simply to bring the existing log output into view.


## Manifest Structure

The workspace manifest is the source of truth for the build metadata used by the extension. It is a YAML document that defines the selectable build context, the available build options, and the action-related metadata needed by workflow actions, build artifacts, and debugging.

At a high level, the manifest is organized around these top-level collections:

- **models**: Define the selectable model values shown in `Build Selection` and provide model-specific artifact folder information.
- **targets**: Define the selectable target values shown in `Build Selection` and provide target-specific build and artifact metadata.
- **components**: Define the selectable component values shown in `Build Selection` and provide component-specific artifact names, action availability, and debug-profile definitions.
- **options**: Define the build options shown in the `Build Options` part of the tree view.

Collection requirements:

- `models` is required and must contain at least one entry.
- `targets` is required and must contain at least one entry.
- `components` is required and must contain at least one entry.
- `options` is optional.

At a high level, the manifest structure looks like this:

```text
core/embed/xtask/tf-tools/manifest.yaml
├── models
│   └── [model]
├── targets
│   └── [target]
├── components
│   └── [component]
│       └── debug
│           └── [debug profile]
└── options
	└── [build option]
```

### models

Example subtree:

```text
models
└── [model]
	├── id
	├── name
	└── artifactFolder
```

Authored fields:

- `id`: string, required. Stable lowercase model identifier, such as `t3w1` or `t3t1`, used by the extension when tracking the active build context and passed to `xtask` as the model argument.
- `name`: string, required. User-facing model label shown in the UI.
- `artifactFolder`: string, optional. Relative artifact-folder path used when resolving build artifacts for the selected model.

### targets

Example subtree:

```text
targets
└── [target]
	├── id
	├── name
	├── shortName
	├── flag
	├── artifactSuffix
	└── executableExtension
```

Authored fields:

- `id`: string, required. Stable target identifier used by the extension when tracking the active build context.
- `name`: string, required. User-facing target label shown in the UI.
- `shortName`: string, optional. Compact target label used where a shorter display form is needed.
- `flag`: string or null, optional. Target-specific build flag passed to `xtask` when the selected target requires one. The emulator target currently uses `-emu`, while hardware targets use `null`.
- `artifactSuffix`: string, optional. Suffix appended to the component artifact name when deriving artifact file names.
- `executableExtension`: string, optional. Executable filename extension used for the derived executable artifact.

### components

Example subtree:

```text
components
└── [component]
	├── id
	├── name
	├── artifactName
	├── flashWhen
	├── uploadWhen
	└── debug
		└── [debug profile]
			├── name
			├── template
			├── when
			└── vars
				└── [var name]: [string value]
```

Authored fields:

- `id`: string, required. Stable component identifier used by the extension and build workflow and passed to `xtask` as the component argument.
- `name`: string, required. User-facing component label shown in the UI.
- `artifactName`: string, optional. Artifact basename stem used when deriving compile-commands, binary, map-file, and executable paths.
- `flashWhen`: when expression, optional. Availability expression that controls whether `Flash to Device` is applicable for the current build context. If omitted, `Flash to Device` is unavailable for that component.
- `uploadWhen`: when expression, optional. Availability expression that controls whether `Upload to Device` is applicable for the current build context. If omitted, `Upload to Device` is unavailable for that component.
- `debug`: array of debug-profile mappings, optional. Ordered list of debug-profile definitions scoped to the component.

When a component defines `debug` entries, each entry may define these authored fields:

- `name`: string, required. User-facing debug profile name.
- `template`: string, required. Relative path to the debug template used for launch configuration generation.
- `when`: when expression, optional. Availability expression that determines whether the debug profile matches the current build context. If omitted, it is evaluated as `true`.
- `vars`: string-to-string mapping, optional. Additional debug-template variables.

The `vars` mapping defines additional debug-template variables. Each key is a variable name and each value is a string value that can be used during debug-template resolution.

### options

Example subtree:

```text
options
└── [build option]
	├── id
	├── flag
	├── name
	├── description
	├── group
	├── type
	├── when
	├── states
	│   └── [state]
	│       ├── value
	│       ├── name
	│       ├── description
	│       └── default
```

Authored fields:

- `id`: string, optional. Stable option identifier. When `flag` is omitted, the effective flag defaults to a long-form flag derived from `id`.
- `flag`: string, optional. CLI flag string passed to `xtask` when the option is active. If omitted, the effective flag defaults to `--<id>`.
- `name`: string, required. User-facing option label shown in the UI.
- `description`: string, optional. Explanatory text shown for the option.
- `group`: string, optional. Visual group name used to organize options in the tree view.
- `type`: enum, required. Option kind, either `checkbox` or `multistate`.
- `when`: when expression, optional. Availability expression that controls whether the option is available for the current build context. If omitted, it is evaluated as `true`.
- `states`: array of state mappings, required for multistate options. Ordered list of selectable states for multistate options.

When an option uses `type: multistate`, each state may define these authored fields:

- `value`: string or null, optional. Value paired with the option's `flag` when the state is selected. If omitted or set to `null`, the state suppresses the CLI value for that option.
- `name`: string, required. User-facing state label shown in the UI.
- `description`: string, optional. Explanatory text shown for the state.
- `default`: boolean, optional. Marks the state as the default selection.

For multistate options, the effective default selection is derived from the `states` list. If one state is marked with `default: true`, that state is the default. Otherwise, the first state in the list is the default.

Examples:

Checkbox option:

```yaml
- id: disable-optiga
  name: Disable OPTIGA
  description: Disables OPTIGA support.
  when: component(firmware)
  group: Testing
  type: checkbox
```

Multistate option:

```yaml
- id: dbg-console
  name: Debug Console
  description: Selects the debug console backend.
  group: Debugging
  when: target(hardware)
  type: multistate
  states:
    - value: null
      name: Default
      description: Use the component default.
      default: true
    - value: vcp
      name: VCP
      description: Route the debug console over virtual COM port.
    - value: swo
      name: SWO
      description: Route the debug console over SWO.
    - value: system-view
      name: SystemView
      description: Route the debug console over SEGGER SystemView.
```

### Condition Expressions

The manifest uses the same condition-expression language in all `when`-type fields, including option `when`, component `flashWhen`, component `uploadWhen`, and debug-profile `when`.

Supported predicates:

- `model(<id>)`: Matches when `<id>` is the active model id.
- `target(<id>)`: Matches when `<id>` is the active target id.
- `component(<id>)`: Matches when `<id>` is the active component id.

Supported logical functions:

- `all(...)`: Matches when all child expressions evaluate to `true`.
- `any(...)`: Matches when at least one child expression evaluates to `true`.
- `not(...)`: Matches when its single child expression evaluates to `false`.

Expression rules:

- Whitespace between tokens may be ignored.
- `all(...)` and `any(...)` require at least one argument.
- `not(...)` requires exactly one argument.
- If a `when`-type field is omitted, the field follows its default behavior.

Examples:

- `target(hardware)`
- `not(target(emulator))`
- `all(target(hardware), component(firmware))`
- `all(target(hardware), any(model(t3w1), model(t3t1)))`

## Errors, Notifications, And Logging

The extension reports problems through several user-facing channels, depending on the type of problem and how persistent that feedback needs to be.

- **Error, warning, and information popups**: The extension uses the standard VS Code notification popup area in the bottom-right corner for runtime issues that block or degrade behavior.
- **Tree-view status**: Problems related to missing build artifacts are shown directly in the `Build Artifacts` part of the tree view and through disabled row actions or disabled workflow actions, rather than through separate popup notifications.
- **Diagnostics**: Actionable file-backed problems, especially manifest validation errors, are shown as VS Code diagnostics so they are visible in the Problems view and in the affected editor.
- **Log output**: Runtime warnings, runtime errors, manifest-load failures, task-launch failures, refresh failures, integration failures, and debug-launch failures are written to the dedicated `Trezor Firmware Tools` log output channel.

Manifest validation errors are surfaced as diagnostics on the manifest file itself and therefore appear in the Problems panel as well as in the manifest editor.

At a high level, the reporting model is:

```text
Problem occurs
├── Blocking or degrading runtime issue
│   └── bottom-right VS Code popup
├── File-backed validation issue
│   └── Diagnostics / Problems view / editor
├── Missing build artifact
│   └── Build Artifacts row status and disabled actions
└── Persistent runtime detail
	└── Trezor Firmware Tools log output
```

The extension also provides a `Trezor: Show Logs` command so the user can open the log output directly when more detail is needed.

## Terminology Reference

See [glossary.md](glossary.md) for the complete glossary.

### Naming Guidance For Future Specs

- Prefer glossary terms exactly as written in [glossary.md](glossary.md) when drafting new product or change specifications.
- Introduce a new term only when an existing one is demonstrably too broad or misleading.
- If a new term is added, define it in [glossary.md](glossary.md) before using it as a normative requirement term.
- Prefer one canonical term per concept; record synonyms only when they are unavoidable for compatibility with code, settings, or legacy manifest fields.

## Drafting Notes

The terminology reference should remain available in this document, but it does not need to appear before the main product narrative. Future draft sections should continue describing stable product capabilities and scope boundaries using the terminology defined here.

