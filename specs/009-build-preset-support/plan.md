# Implementation Plan: Build Preset Support

**Branch**: `009-build-preset-support` | **Date**: 2026-07-31 | **Spec**: `specs/009-build-preset-support/spec.md`

**Input**: Feature specification from `specs/009-build-preset-support/spec.md`

**Note**: This plan follows the `/speckit-plan` workflow and keeps repository file references workspace-relative.

**File Reference Rule**: Use workspace-relative paths for any repository file references written into this plan.

## Summary

Add `xtask` build-preset support to the Configuration view: a fourth `Presets` selector under `Build Selection`, preset-relative build-option display and override semantics, and preset-aware argument generation for `Build`, `Clippy`, and `Check`.

The design adds one new read-only input slice — `src/presets/` with a `PresetService` modeled on the existing `ManifestService`, a pure TOML parser/validator, and a pure resolution layer — and then threads its output through the three existing seams: `ActiveConfig` gains a `presetId`, `ResolvedOption` becomes preset-relative (`presetValue`, `presetState`, `isOverride`), and `deriveWorkflowArguments` gains the `-p` pair plus override-only flag emission. Everything else the extension does stays byte-identical: the build-context display, status bar, task labels, command names, artifact resolution, IntelliSense, and the `Clean`, `Flash to Device`, `Upload to Device`, and `Start Debugging` argument lists.

Preset files are resolved from the same directory `xtask` itself reads (`<cargo-workspace>/xtask/tf-tools/`), so the extension can never disagree with the build it launches. Two distinct failure tiers are kept apart: a file-level invalid input replaces the preset choices with an error row and blocks `Build`/`Clippy`/`Check` through a new `tfTools.presetBlocked` context key, while `Clean` stays available; an option-level unrepresentable value reports on its own row and blocks the same three commands without discarding the rest of the preset data.

## Product Documentation Alignment

**Affected Product Areas**: `Core Capabilities` → `Build Context Management` and `Build Option Management`; `Configuration View Iconography`; `Build Context Display Conventions`; `Status Bar`; `Startup And Refresh Behavior`; `Persistence And Defaults`; `Availability And Blocking Model`; `Command Surface` → `Build`, `Clippy And Check`, `Clean`; `Manifest Structure` → `options`; `Errors, Notifications, And Logging`.

**Source Anchor**:

- `specs/product-spec.md`: `Build Selection` is a selector-per-row surface with one selector expanded at a time and manifest-ordered choices; `Build Options` shows only context-available options, emphasizes non-default selections, and keeps its section visible with placeholders in every failure state; the shared build-context display is `{model-name} | {target-display} | {component-name}`; `Build`/`Clippy`/`Check` share one argument mapping and `Clean` runs with a fixed label and no arguments; blocked actions stay visible but disabled; file-backed problems become diagnostics and runtime problems go to the dedicated log channel.
- `specs/glossary.md`: `active build context`, `active configuration`, `Build Selection`, `Build Options`, `build option`, `checkbox option`, `multistate option`, `option state`, `default state`, `xtask`, `Build`, `Clippy`, `Check` keep their existing meanings; `active configuration` is extended to carry the preset id; `preset`, `active preset`, `default preset`, `preset-effective value`, and `build-option override` are added.
- Upstream contract on branch `cepetr/xtask-build-presets`: `docs/core/build/xtask.md`, `core/embed/xtask/src/presets.rs`, `core/embed/xtask/src/options.rs`.

**Scope Guard**: This plan adds preset discovery and selection, preset-relative build-option behavior, and preset-aware argument generation for `Build`, `Clippy`, and `Check`. It does not change `Clean`, `Flash to Device`, `Upload to Device`, `Start Debugging`, artifact resolution, IntelliSense, excluded-file visibility, status-bar content, command names, or task labels. It introduces no preset authoring, editing, or creation capability, and no support for older preset formats.

**Terminology Guard**: Use `active build context`, `active configuration`, `Configuration view`, `Build Selection`, `Build Options`, `build option`, `checkbox option`, `multistate option`, `option state`, `xtask`, `Build`, `Clippy`, and `Check` exactly as defined in `specs/glossary.md`. Use `preset`, `active preset`, `default preset`, `preset-effective value`, and `build-option override` exactly as they will be defined there by the FR-029 update. The active preset stays separate from the active build context and never appears in build-context display text.

**Critical Product Details**:

- `Presets` is the fourth selector, positioned directly below `Component`, and follows the existing expand/collapse, active-choice, loading, and refresh conventions — including the single-expanded-selector rule.
- The synthetic `Default` choice is always present and always first, even when neither file declares a `[[defaults]]` fragment. It means defaults-only behavior and never emits a preset argument; `-p default` is never emitted.
- The preset id lives in the same workspace-scoped active-configuration record as model, target, and component, and follows the same save/restore/normalize/refresh lifecycle — while staying out of every display string.
- An absent `presets.toml` behaves exactly like an empty file and is never reported.
- A file-level invalid preset input replaces the choices under `Presets` with an error row, logs details, raises diagnostics on the offending file, blocks `Build`/`Clippy`/`Check`, and preserves the saved preset id without resolving it.
- Effective-value precedence is shared defaults → user defaults → shared active-preset fragments → user active-preset fragments → explicit overrides, with file order preserved inside each layer and omitted keys retaining prior values.
- Fragment applicability is evaluated against the active model, the active component (upstream `project`), and the active target's emulator flag.
- The manifest stays the source of truth for which options exist and how they are displayed; multistate options no longer require a manifest-authored default.
- Build-option controls show preset-effective values when no override exists, and emphasize only values that differ from the active preset's calculated values.
- `Build`, `Clippy`, and `Check` append `-p <name>` only for a named preset and emit option flags only for differing overrides.
- `Clean` retains its pre-feature availability and arguments, including when a preset file is invalid.
- `specs/product-spec.md` and `specs/glossary.md` must be updated in this same change (FR-029).

## Technical Context

**Language/Version**: TypeScript 5.8 targeting ES2022, CommonJS output for tests and an esbuild CJS bundle for the extension host.

**Primary Dependencies**: VS Code Extension API 1.105; `smol-toml` 1.7.1 (new runtime dependency, BSD-3-Clause, zero transitive dependencies) for preset TOML parsing; existing `yaml` manifest parser, `jsonc-parser`, and `minimatch`; Node.js `fs/promises` and `path`; existing output-channel and diagnostic-collection helpers.

**Storage**: Existing workspace state only — `tfTools.activeConfig` gains an optional `presetId`; `tfTools.buildOptions` keeps its shape. Preset files are read-only external inputs at `<cargo-workspace>/xtask/tf-tools/presets.toml` and `<cargo-workspace>/xtask/tf-tools/user-presets.toml`. No new settings.

**Testing**: Mocha TDD unit suites under `src/test/unit/` plus the `@vscode/test-electron` integration harness under `src/test/integration/`, with new fixture workspaces under `test-fixtures/workspaces/`. Coverage spans TOML parsing and validation, preset availability and precedence, effective-value mapping, override detection, argument derivation, tree presentation, persistence and normalization, diagnostics, and regression of every surface the preset must not touch.

**Target Platform**: VS Code 1.105+ desktop extension host, single-root workspace.

**Project Type**: Single-package VS Code extension.

**Performance Goals**: Preset and option surfaces reflect a preset-file or build-context change within two seconds and with no window reload (SC-004). Preset loading is two small file reads behind the existing 300 ms watcher debounce; resolution is a pure overlay over a handful of fragments and is recomputed synchronously on every refresh.

**Constraints**: Single-root workspace; manifest-driven behavior with no hardcoded model, component, or option matrices; explicit failure visibility with no silent fallbacks or guessed argument values; the extension must read exactly the preset files `xtask` reads; `Clean`, flash, upload, and debug behavior must remain provably unchanged; no new user-facing settings and no new contributed commands in `package.json`.

**Scale/Scope**: One extension package. Roughly four new source modules under `src/presets/`, changes to seven existing modules, one `package.json` dependency plus two `enablement` clauses, six new fixture workspaces, and consolidated-documentation updates.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Post-Phase-1 re-check: passed.

- [x] **I. TypeScript Extension First** — all new code is TypeScript against the stable VS Code API at the 1.105 baseline. `smol-toml` is a pure-JS, zero-dependency library that both `tsc` (CommonJS) and the esbuild bundle resolve without special handling. No work is done for older VS Code releases.
- [x] **II. Manifest-Driven Behavior** — the manifest stays authoritative for which options exist, their labels, groups, availability, types, and states (FR-018). Preset applicability is evaluated from manifest data only: model ids, component ids, and the active target's `flag` (research Decision 3) — no hardcoded firmware matrix and no id-string special-casing. Preset inputs are resolved from the existing `tfTools.cargoWorkspacePath` setting, and invalid or missing inputs trigger visible normalization or explicit failure rather than stale state.
- [x] **III. Tests Are Mandatory** — every user story gets primary-path unit coverage plus integration coverage. The changed areas are exactly the ones the constitution names as requiring integration-level tests: VS Code integration (tree, context keys, commands), manifest parsing (`BuildOption.id`), task execution (argument derivation via the task provider), diagnostics (preset issues), and persisted state (`presetId`, legacy records). Tests are scheduled before their implementation tasks.
- [x] **IV. Failures Must Be Visible** — the two-tier failure model in research Decision 10 gives every failure a user-visible surface plus a persistent signal: an error row under `Presets` or on the affected option row, a diagnostic on the file that caused it, and a `Trezor Firmware Tools` log entry. Blocked launches report a reason and log it. No path falls back to a guessed argument set or to stale preset data.
- [x] **V. Keep It Small And Clear** — one new slice reusing the existing service/parse/state pattern rather than a new architecture; no new settings, no new contributed commands, no new persistence store. The TOML dependency replaces a parser we would otherwise have to write and keep in sync with `xtask`. Identifiers stay short (`PresetState`, `PresetFilter`, `presetValue`, `isOverride`). No complexity exception is required.
- [x] **Product-spec alignment** — affected areas are named above, the design stays inside them, and the `specs/product-spec.md` / `specs/glossary.md` updates are part of this change (FR-029), not a follow-up.
- [x] **Product-detail capture** — the `Critical Product Details` list and `Critical Detail Reconciliation` below carry the tree-view, event-ordering, persistence, command-visibility, and argument-shape details forward explicitly.
- [x] **Scope discipline** — no requirement outside the declared affected product areas is introduced. The one place where the design touches a neighboring behavior (`Clean` enablement) exists precisely to *prevent* a scope leak, and is covered by FR-025.

## Critical Detail Reconciliation

Behaviors that are easy to approximate rather than implement, with where they live and how they are enforced.

- **`Clean` must not be caught by preset blocking.** `package.json` currently gates all four workflow actions on the single `tfTools.workflowBlocked` key, so reusing it would disable `Clean` whenever a preset file is malformed. Add `tfTools.presetBlocked` and apply it only to the `Build`, `Clippy`, and `Check` `view/title` entries (research Decision 11). Enforce with an integration test asserting `Clean` stays enabled and still launches with no arguments while a preset file is invalid.
- **Preset files must be the ones `xtask` reads.** Resolve them from `resolveCargoWorkspacePath(workspaceFolder)` + `xtask/tf-tools/`, not from the manifest directory, and restart the preset service on a `tfTools.cargoWorkspacePath` change (research Decision 2). Enforce with a unit test over path resolution and an integration test that changes the setting and observes re-resolution.
- **The emulator filter value must equal what the command line will set.** Derive it from the active target's manifest `flag` (research Decision 3), never from `targetId`. Enforce with unit tests covering an emulator target, a hardware target, and a manifest that renames the target ids.
- **Fragment order and layer order are both load-bearing.** Availability and effective values depend on first-declaration order across shared-then-user for names (FR-003) and on file order inside each of the four precedence layers (FR-010, FR-011). Enforce with unit tests using multiple fragments per name in both files, including a later fragment that overrides only one key and leaves the rest intact.
- **Permissiveness where `xtask` is broader than the manifest.** Option keys unknown to the manifest and `when.model`/`when.project` values unknown to the manifest must be tolerated, because the committed `core/embed/xtask/tf-tools/presets.toml` contains both (`asan`; a `project = [… "kernel"]` example). Only `when` *shape* violations are errors (research Decisions 5 and 6). Enforce with unit tests that parse the real upstream file shape and assert it loads clean.
- **Override detection is a comparison, never a stored flag.** `isOverride` is recomputed from `storedValue !== presetValue` on every refresh, and stored selections are never rewritten when the active preset changes (FR-016, FR-017). Enforce with unit tests that switch presets back and forth and assert emphasis and argument emission follow, while the persisted map is untouched.
- **The null-valued multistate state clears the override.** Selecting it persists "no explicit selection", and a stored value equal to that state id is normalized the same way, so an override can never emit the empty flag (research Decision 8). Enforce with unit tests on `normalizeBuildOptions` and on argument derivation, plus a manual quickstart step.
- **A negative checkbox override needs the `=false` form.** Without it, unchecking a preset-enabled option would emit nothing and the launched build would contradict the view (research Decision 9). Enforce with unit tests over `deriveWorkflowArguments` covering on-override, off-override, and equal-to-preset cases, and with a regression assertion that the bare-flag and `<flag>=<value>` forms are unchanged.
- **Recalculate before launch, and block instead of guessing.** `Build`, `Clippy`, and `Check` reload the preset inputs, renormalize, and recompute before deriving arguments; a file-level invalid state or any option mismatch rejects the launch with a visible error plus a log entry (FR-020, research Decision 13). Enforce with an integration test that mutates a preset file and then invokes the command.
- **The saved preset id survives invalidity unresolved.** No preset normalization or write may occur while preset state is invalid; when valid data returns the saved id is restored if available and normalized to `default` only if not (FR-031). Enforce with an integration test that breaks a file, reloads, fixes the file, and asserts both the restore and the normalize branches.
- **Legacy persisted records must not break.** `tfTools.activeConfig` records written before this feature have no `presetId`; they must read as `default` and must not be rewritten merely because of that (data-model §3, §7). Enforce with an integration test that seeds a legacy record.
- **Everything else stays identical.** The build-context display, status bar, task labels, command names, artifact paths, IntelliSense context, and the `Clean`/flash/upload/debug argument lists must not move (FR-024, FR-025, SC-005). Enforce with the existing suites listed in `specs/009-build-preset-support/quickstart.md` under `Regression checks`.
- **Consolidated docs are part of the change.** `specs/product-spec.md` and `specs/glossary.md` must be updated for the fourth selector and its icon, preset-relative option display, the extended active-configuration record, the new refresh triggers, the `-p` and `<flag>=false` argument forms, `Clean`'s exemption, the replaced multistate-default rule, and the five new glossary terms (FR-029). The full list is in `specs/009-build-preset-support/quickstart.md` under `Documentation completion gate`.

## Project Structure

### Documentation (this feature)

```text
specs/009-build-preset-support/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── preset-files.md              # External preset TOML input contract
│   └── preset-command-arguments.md  # Launched command-line contract
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── presets/                      # NEW slice
│   ├── preset-types.ts           # PresetFilter, PresetFragment, PresetFile, PresetState
│   ├── parse-presets.ts          # TOML text -> PresetFile + ValidationIssue[] (pure)
│   ├── preset-resolution.ts      # availability + effective-value overlay (pure)
│   └── preset-service.ts         # load both inputs, watch, debounce, publish PresetState
├── configuration/
│   ├── active-config.ts          # + presetId, selectPreset, preset-aware restore
│   ├── normalize-config.ts       # + normalizePresetId
│   └── build-options.ts          # ResolvedOption + presetValue/presetState/isOverride
├── commands/
│   └── build-workflow.ts         # -p emission, override-only flags, presets-invalid reason
├── tasks/
│   └── build-task-provider.ts    # thread the active preset into task args
├── manifest/
│   ├── manifest-types.ts         # BuildOption.id, new ValidationCode members
│   └── validate-manifest.ts      # carry options[].id through
├── observability/
│   ├── diagnostics.ts            # preset-state diagnostics
│   └── log-channel.ts            # preset-state and preset-failure logging
├── ui/
│   └── configuration-tree.ts     # Presets selector, error row, preset-relative emphasis
├── workspace/
│   └── settings.ts               # resolve the two preset input paths
├── extension.ts                  # wire PresetService, selectPreset, presetBlocked key
└── test/
    ├── unit/
    │   ├── presets/              # parse, resolution, effective values
    │   ├── configuration/        # preset normalization, override detection
    │   ├── workflow/             # argument derivation, preconditions
    │   └── ui/                   # tree presentation
    └── integration/              # selection, options, workflow, failures

test-fixtures/
└── workspaces/                   # six new preset-* fixture workspaces

package.json                      # smol-toml dependency; two enablement clauses
specs/product-spec.md             # FR-029
specs/glossary.md                 # FR-029
```

**Structure Decision**: Keep the new logic in one focused `src/presets/` slice that mirrors the existing manifest slice — a pure parser, a pure resolver, typed state, and a watching service publishing state changes — so preset handling is recognizable to anyone who has read `src/manifest/`. Everything else is a change at an existing seam: `ActiveConfig` for persistence, `ResolvedOption` for option state, `deriveWorkflowArguments` for command construction, and `ConfigurationTreeProvider` for presentation. No new persistence store, settings, contributed commands, or UI surface is introduced, and the existing unit and integration suites are extended rather than replaced.

## Complexity Tracking

No constitutional violations are required for this design.

The one added runtime dependency (`smol-toml`) is justified under Principle V in `specs/009-build-preset-support/research.md` Decision 1: it replaces a hand-written TOML parser that would be larger than the dependency and would risk silently diverging from the `xtask` contract, which Principle IV forbids.
