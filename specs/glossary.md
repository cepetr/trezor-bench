# Glossary

This glossary defines the preferred product and documentation terms used by the extension specifications.

## Product And Workspace Terms

| Term | Definition | Preferred Usage / Notes |
| --- | --- | --- |
| **Trezor Firmware Tools** | The formal product name of the extension. | Use in the title, introduction, and places where the official product name matters. |
| **Trezor** | The compact user-facing label used in space-constrained UI surfaces. | Use for the activity bar container title, command category prefix, and other compact UI labels. Do not use it as a replacement for the formal product name in general prose. |
| **the extension** | The default prose reference to Trezor Firmware Tools after first mention. | Preferred term for most requirement and behavior statements throughout the specification. |
| **tf-tools** | Short internal identifier for the product. | Use for file names, setting prefixes, variable names, command ids, and compact references. Do not use as the main product name in user-facing prose. |
| **workspace** | The single opened VS Code workspace folder in which the extension operates. | The product assumes a single-root workspace. |
| **workspace root** | The root directory of the opened workspace folder. | Use when describing how relative settings or manifest paths are resolved. |
| **workspace maintainer** | A person who authors or updates the manifest, templates, and workspace-specific settings consumed by the extension. | Useful when requirements address repository configuration rather than day-to-day usage. |
| **user** | A person operating the extension inside VS Code. | Default actor for product behavior unless a narrower role is needed. |

## Configuration Terms

| Term | Definition | Preferred Usage / Notes |
| --- | --- | --- |
| **active build context** | The currently selected combination of model, target, and component that drives visible UI state and runtime behaviors. | Preferred product term when behavior depends on the current selection. Stays separate from the active preset, which never appears in build-context display text. |
| **active configuration** | The persisted workspace-state record that stores the selected model id, target id, component id, active preset id, and save timestamp. | Use for persistence and normalization behavior; avoid using it as a synonym for any visible UI section. Records persisted before preset support was added have no preset id and are read as the default preset. |
| **Configuration view** | The tree view contributed by the extension inside the `Trezor` activity bar container. | Preferred term for the extension's main side-bar surface. |
| **Build Selection** | The Configuration view section that shows the current model, target, component, and preset selectors. | Use this exact capitalization for the UI surface. |
| **preset** | A named, ordered collection of build-option value fragments defined in the shared `presets.toml` file or the optional `user-presets.toml` file, matched against the active model, component, and target-derived emulator state. | Use for the named choices offered under the `Presets` selector, distinct from the always-available default preset. |
| **active preset** | The single preset selection — a named preset or the default preset — used to derive preset-effective build-option values for `Build`, `Clippy`, and `Check`. | Its id is stored in the active configuration but stays separate from the active build context and its display text. |
| **default preset** | The always-available synthetic `Default` choice under the `Presets` selector. It applies matching shared and user preset-file defaults without selecting a named preset and never produces a `-p` command-line argument. | Use `Default` (capitalized) for the UI label; use "default preset" in prose describing its behavior. |
| **model** | A manifest-defined firmware family or device line available for selection. | User-facing labels come from `model.name`; rules and persistence use `model.id`. |
| **target** | A manifest-defined build target available for selection, such as a hardware or emulator variant. | User-facing labels prefer `target.shortName` when present, otherwise `target.name`. |
| **component** | A manifest-defined buildable firmware component available for selection. | User-facing labels come from `component.name`; rules and persistence use `component.id`. |
| **target display name** | The label shown for the selected target in the UI and task labels. | Defined as `target.shortName` when present, otherwise `target.name`. |
| **selection normalization** | The process of restoring or correcting saved selections so they always resolve to valid manifest entries. | Use when describing startup recovery and manifest-change handling. |

## Manifest Terms

| Term | Definition | Preferred Usage / Notes |
| --- | --- | --- |
| **manifest** | The YAML file that defines available models, targets, components, build options, debug profiles, and related rules. | This is the runtime source of truth for product behavior. |
| **manifest path** | The workspace setting that points to the manifest file. | Exposed as `tfTools.manifestPath`. |
| **tf-tools manifest** | Shorthand for the manifest file used by Trezor Firmware Tools. | Acceptable short form when the file itself is the subject. |
| **manifest status** | The current load state of the manifest: `loaded`, `missing`, or `invalid`. | Use when describing command gating and warning surfaces. |
| **validation issue** | A concrete manifest problem found during parsing or validation. | Use for structured problems that may become diagnostics or logs. |
| **when expression** | A manifest-defined availability rule composed from `model(...)`, `target(...)`, `component(...)`, `all(...)`, `any(...)`, and `not(...)`. | Use this term consistently for option and debug availability rules. Avoid looser names like "condition string". |

## Build Option Terms

| Term | Definition | Preferred Usage / Notes |
| --- | --- | --- |
| **Build Options** | The Configuration view section that shows manifest-driven build options. | Use this exact capitalization for the UI surface. |
| **build option** | A manifest-defined option that can affect build behavior and command arguments. | Generic term covering both checkbox and multistate forms. |
| **checkbox option** | A build option that is either enabled or disabled. | Preferred term over "boolean option" in user-facing prose. |
| **multistate option** | A build option that exposes one selected state from a fixed list. | Preferred term over "enum option" in user-facing prose. |
| **option state** | One selectable value inside a multistate option. | Use when describing state labels, defaults, and persistence. |
| **default state** | The multistate option state whose manifest-declared value is `null`, used when no explicit override is stored and no applicable preset fragment sets the option. A multistate option that declares no such state and receives no preset value is unresolved rather than falling back to a manifest-authored default. | A multistate option's states no longer require a manifest-authored default for this term to apply. |
| **preset-effective value** | The value of a build option after all applicable shared and user default and named-preset fragments have been overlaid, before any explicit build-option override. | Use when describing the value Build Options display and Build/Clippy/Check use when no override is stored. |
| **build-option override** | A persisted, user-selected option value that differs from the current preset-effective value. | Visually emphasized and emitted explicitly for `Build`, `Clippy`, and `Check`; a stored value equal to the preset-effective value is not an override. Authored against the active preset, so changing the active preset discards it. |
| **option availability** | Whether a build option is currently visible and effective for the active build context. | Driven by a `when` expression when one is defined. |
| **option group** | A named visual grouping of build options in the tree view. | Use only for UI organization; it is not a separate configuration entity. |

## Artifact And Task Terms

| Term | Definition | Preferred Usage / Notes |
| --- | --- | --- |
| **Build Artifacts** | The Configuration view section that reports artifact status and exposes artifact-related actions. | Use this exact capitalization for the UI surface. |
| **artifacts root** | The directory configured by `tfTools.artifactsPath` that contains model-specific artifact folders. | Preferred term over generic phrases like "artifacts directory" when precision matters. |
| **artifact folder** | The model-defined subfolder under the artifacts root where that model's derived files are expected. | Comes from `model.artifactFolder`. |
| **artifact basename** | The shared base filename stem formed from `component.artifactName` plus `target.artifactSuffix`. | Useful when describing compile commands, binary, and map file derivation. |
| **compile commands artifact** | The `.cc.json` file that represents the expected compile database for the active build context. | Preferred product term over raw filename references when discussing IntelliSense. |
| **binary artifact** | The `.bin` file expected for the active build context when flash or upload is applicable. | Use for row state and action enablement. |
| **map file artifact** | The `.map` file expected for the active build context when binary-related actions are applicable. | Use for row state and the open-map action. |
| **executable artifact** | The executable file derived for debug launch from artifact name, suffix, and executable extension. | Preferred term when discussing debug readiness. |
| **artifact status** | The user-facing presence state of an artifact row: `valid` or `missing`. | Use for tree row descriptions, not for low-level file existence checks. |
| **xtask** | The workspace's Cargo-based task runner used by the extension to launch build-related firmware workflows. | Use this term when referring to the command backend that receives model, target, component, and build-option arguments. |
| **workflow task environment** | The process environment used when the extension launches a `cargo xtask` workflow task. | Formed from the VS Code session environment plus entries from `tfTools.taskExtraEnv` after configuration variable references are resolved. |
| **task extra environment** | The workspace setting object that supplies additional environment variables for workflow tasks. | Exposed as `tfTools.taskExtraEnv`. |
| **configuration variable reference** | A `${...}` placeholder in a tf-tools setting value that the extension resolves when reading that setting. | Covers supported VS Code variable-reference forms such as `${workspaceFolder}` and `${env:NAME}`. Distinct from tf-tools debug substitution tokens in debug templates. |
| **Build** | The primary command and task that runs the active firmware build workflow. | Capitalize when referring to the named command. |
| **Clippy** | The command and task that runs lint-oriented firmware checks for the active build context. | Capitalize as the task/command name. |
| **Check** | The command and task that runs non-building validation for the active build context. | Capitalize as the task/command name. |
| **Clean** | The command and task that clears build outputs without using active-build-context-derived arguments. | Capitalize as the task/command name. |
| **Flash to Device** | The user-facing command or row action that writes the active binary artifact to a device when applicable. | Use this exact capitalization when referring to the UI action. `Flash` is acceptable only as a shorter secondary reference after the full name is established. |
| **Upload to Device** | The user-facing command or row action that uploads the active binary artifact when applicable. | Use this exact capitalization when referring to the UI action. `Upload` is acceptable only as a shorter secondary reference after the full name is established. |

## IntelliSense And File-Visibility Terms

| Term | Definition | Preferred Usage / Notes |
| --- | --- | --- |
| **IntelliSense** | The editor assistance aligned to the active compile database and delivered through the configured C/C++ provider. | Keep the VS Code spelling and capitalization. |
| **compile database** | The parsed compile-commands data used to derive per-file C/C++ configuration. | Product-facing equivalent of the compile commands artifact contents. |
| **configuration provider** | The C/C++ IntelliSense provider that tf-tools integrates with. | In this product, this is either the cpptools custom configuration provider contract or the clangd language server driven through a managed compile database. |
| **IntelliSense backend** | The C/C++ tooling tf-tools drives to deliver IntelliSense: either Microsoft C/C++ (`cpptools`) or clangd (`llvm-vs-code-extensions.vscode-clangd`). | cpptools is preferred; clangd is the fallback used when cpptools cannot be used and the clangd extension is installed. |
| **managed compile database** | The `.tf-tools/compile_commands.json` link maintained in the workspace root that points the clangd backend at the active compile-commands artifact. | Use when describing how the clangd backend discovers the active compile database. |
| **provider readiness** | Whether a supported IntelliSense backend is installed and usable for tf-tools: cpptools configured with `cepetr.tf-tools` as the provider, or the clangd extension installed. | Use when describing prerequisite warnings. |
| **excluded file** | A file that falls within excluded-file scope but is not included in the active compile database. | Preferred user-facing term for the feature. |
| **excluded-file scope** | The combination of configured filename patterns and folder globs that limits where excluded-file marking applies. | Prefer this term over "rules" when describing the overall scope behavior. |
| **Explorer badge** | The exclusion marker shown in the VS Code Explorer for excluded files. | Use for the explorer surface specifically. |
| **editor overlay** | The first-line warning shown inside editors for excluded files when enabled. | Use for the editor surface specifically. |

## Debug Terms

| Term | Definition | Preferred Usage / Notes |
| --- | --- | --- |
| **Start Debugging** | The user-facing command and inline action that starts a debug session for the active build context. | Use this exact capitalization for the UI action. |
| **debug profile** | One manifest-defined debug entry owned by a component and evaluated against the active build context. | Preferred term over "debug config" because the final launch configuration is derived, not stored directly in the manifest. |
| **debug profile resolution** | The process of evaluating the selected component's debug profiles in declaration order, collecting all matching profiles into an ordered set, and choosing the first matching profile as the default. | Use when describing debug availability, Run and Debug entry generation, and launch preparation. |
| **matching debug profile set** | The ordered collection of component-owned debug profiles whose `when` expressions evaluate to true for the active build context. | Use when describing how Run and Debug entries are generated or how the default profile is derived. |
| **default debug profile** | The first matching debug profile in declaration order for the selected component, used by direct `Start Debugging` actions and by the default Run and Debug entry. | Use when contrasting the default choice from profile-specific Run and Debug entries. |
| **debug template** | The JSONC file referenced by a debug profile and loaded at launch time. | Preferred term over "launch template" in this product. |
| **debug templates path** | The workspace setting that points to the directory containing debug templates. | Exposed as `tfTools.debug.templatesPath`. |
| **debug variable** | A tf-tools substitution variable available during template resolution. | Covers built-in variables and profile-defined `tfTools.debug.var:<name>` entries. |
| **built-in debug variable** | A substitution variable derived from the active model, target, component, artifact path, executable, or debug profile name. | Use when distinguishing built-ins from profile-defined variables. |
| **profile-defined debug variable** | A substitution variable declared in a manifest debug profile under `vars`. | Use this term instead of just "custom variable" for precision. |
| **substitution token** | A `${...}` placeholder found in a debug template before tf-tools substitution runs. | Use when describing template inputs rather than resolved values. |
| **declaration order** | The order in which debug profiles appear in the manifest. The first matching profile in declaration order is the default debug profile. No separate priority field or other precedence mechanism overrides this order. | Use when describing default profile selection and why declaration position determines the default choice. |
| **debug resolution failure** | A launch-blocking failure that occurs while selecting a matching debug profile, loading its template, or resolving tf-tools debug variables. | Use for failures before VS Code starts the debug session. |

## Availability Terms

| Term | Definition | Preferred Usage / Notes |
| --- | --- | --- |
| **available action** | A command or row action that is currently shown and can be executed. | Use when all prerequisites for the current surface are satisfied. |
| **disabled action** | A command or row action that remains visible to indicate capability, but cannot currently be executed because a prerequisite is missing. | Use for discoverable-but-not-runnable states such as missing artifacts. |
| **blocked command** | A command whose execution is rejected after invocation because the current workspace or manifest state does not allow it. | Use when the extension reports a failure instead of starting the action. |
| **hidden action** | A command or row action omitted from a surface because it does not apply to the current build context or surface. | Use when the action should not be presented at all. |
| **action enablement state** | The combined visible/runnable state of a command or row action on a particular surface. | Useful when specifying hidden versus disabled versus blocked behavior. |

## Settings And Observability Terms

| Term | Definition | Preferred Usage / Notes |
| --- | --- | --- |
| **resource-scoped setting** | A VS Code setting that can vary by workspace rather than being globally fixed. | Use when describing tf-tools configuration settings. |
| **configuration variable resolution** | The extension behavior that expands supported `${...}` references while reading string-based tf-tools settings. | VS Code does not perform this automatically for extension settings; tf-tools resolves supported references in path settings, `tfTools.taskExtraEnv`, and excluded-file glob settings. |
| **command surface** | A user-facing place where a command is exposed, such as the Command Palette, a view header, an overflow menu, or an inline row action. | Use when describing shared command availability and visibility rules across multiple entry points. |
| **invalid when expression** | A manifest `when`, `flashWhen`, or `uploadWhen` expression that cannot be parsed, validated, or resolved against known ids. | Use for manifest validation failures rather than runtime false results. |
| **status bar configuration item** | The status bar entry that shows the active build context and opens the Configuration view. | Preferred product phrase over generic "status bar text". |
| **diagnostic** | A persistent file-backed problem shown through the Problems view and relevant editors. | Use for manifest-backed validation issues. |
| **log output** | The dedicated `Trezor Firmware Tools` output channel that records runtime warnings, errors, and detail. | Preferred term over generic "logs" when the VS Code output channel is meant. |
| **user-visible error** | An error surfaced directly in the UI, typically as a VS Code notification or disabled action state. | Use when distinguishing transient UX feedback from persistent diagnostics or logs. |