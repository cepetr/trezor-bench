# Phase 0 Research: Build Preset Support

**Branch**: `009-build-preset-support` | **Date**: 2026-07-31 | **Spec**: `specs/009-build-preset-support/spec.md`

**File Reference Rule**: Use workspace-relative paths for any repository file references written into this document.

## Sources Consulted

- `specs/009-build-preset-support/spec.md` — feature requirements, edge cases, failure modes.
- `specs/product-spec.md` — `Build Context Management`, `Build Option Management`, `Configuration View Iconography`, `Build Context Display Conventions`, `Status Bar`, `Startup And Refresh Behavior`, `Persistence And Defaults`, `Availability And Blocking Model`, `Command Surface` (`Build`, `Clippy And Check`, `Clean`), `Manifest Structure` → `options`, `Errors, Notifications, And Logging`.
- `specs/glossary.md` — `active build context`, `active configuration`, `Build Selection`, `Build Options`, `build option`, `checkbox option`, `multistate option`, `option state`, `default state`, `xtask`, `Build`, `Clippy`, `Check`.
- `.specify/memory/constitution.md` v1.7.0 — all five principles plus Delivery Workflow scope discipline.
- Upstream `xtask` preset contract on branch `cepetr/xtask-build-presets`: `docs/core/build/xtask.md`, `core/embed/xtask/src/presets.rs`, `core/embed/xtask/src/options.rs`, `core/embed/xtask/tf-tools/presets.toml`, `core/embed/xtask/tf-tools/manifest.yaml`.
- Existing implementation: `src/manifest/manifest-service.ts`, `src/manifest/validate-manifest.ts`, `src/manifest/when-expressions.ts`, `src/configuration/active-config.ts`, `src/configuration/normalize-config.ts`, `src/configuration/build-options.ts`, `src/commands/build-workflow.ts`, `src/tasks/build-task-provider.ts`, `src/ui/configuration-tree.ts`, `src/extension.ts`, `src/observability/diagnostics.ts`, `src/observability/log-channel.ts`, `src/workspace/settings.ts`, `package.json`.

No `NEEDS CLARIFICATION` markers remain in the Technical Context after the decisions below.

---

## Decision 1 — TOML parsing library

**Decision**: Parse both preset files with `smol-toml` (v1.7.1, BSD-3-Clause, zero runtime dependencies), added as a `dependencies` entry in `package.json`.

**Rationale**:

- The preset contract is full TOML 1.0 (arrays of tables, inline tables, arrays). Hand-writing a subset parser would be a large new abstraction and would drift from what `xtask` accepts, violating Principle V (`Keep It Small And Clear`) rather than honoring it.
- `smol-toml` preserves object key insertion order, so `Object.keys(parsed)` yields first-declaration order for `[[name]]` groups. That is exactly what FR-003 requires for listing preset names.
- `[[name]]` arrays of tables parse to `Record<string, Array<Fragment>>`, matching the upstream `BTreeMap<String, Vec<Preset>>` shape one-to-one.
- Its `TomlError` carries `line`, `column`, and `codeblock`, which maps directly onto the `ValidationIssue.range` shape already used by `src/observability/diagnostics.ts` for FR-028/FR-030 diagnostics.
- Ships CJS (`dist/index.cjs`) and ESM (`dist/index.js`) builds with no native code, so both `tsc -p ./` (CommonJS unit tests) and the `esbuild --main-fields=module,main` bundle work unchanged.

**Alternatives considered**:

- `@iarna/toml` — TOML 0.5 only; the upstream contract is TOML 1.0.
- `@ltd/j-toml` — LGPL-3.0 and a heavier API surface than needed.
- `toml` (npm) — TOML 0.4, unmaintained.
- Hand-rolled subset parser — rejected: more code than the dependency, and any divergence from `xtask` produces silently wrong effective values, which Principle IV forbids.

---

## Decision 2 — Preset file location

**Decision**: Resolve both preset inputs as `<cargo-workspace>/xtask/tf-tools/presets.toml` and `<cargo-workspace>/xtask/tf-tools/user-presets.toml`, where `<cargo-workspace>` is the existing `resolveCargoWorkspacePath(workspaceFolder)` result from `src/workspace/settings.ts`. No new settings are introduced. A change to `tfTools.cargoWorkspacePath` restarts the preset service.

**Rationale**:

- `core/embed/xtask/src/presets.rs` resolves the preset directory as `workspace_dir()?.join("xtask/tf-tools")` — relative to the cargo workspace, which is precisely what `tfTools.cargoWorkspacePath` already models (default `core/embed`). The extension therefore reads exactly the files `xtask` will read, satisfying FR-020 and SC-003.
- With the default settings this resolves to `core/embed/xtask/tf-tools/presets.toml`, the same directory as the default `tfTools.manifestPath`, so nothing changes for a stock workspace.
- Adding settings would expand the configuration surface without a requirement asking for it (Principle V).

**Alternatives considered**:

- Derive from `dirname(tfTools.manifestPath)` — rejected: a user who repoints only `manifestPath` would make the extension read preset files that `xtask` does not read, producing arguments that disagree with the launched build.
- New `tfTools.presetsPath` setting — rejected: no requirement, and it would allow the same divergence.

---

## Decision 3 — Deriving the upstream `emulator` filter value

**Decision**: The `when.emulator` filter is matched against `targetFlagIsEmulator = target.flag === "--emulator" || target.flag === "-e"`, computed from the active target's manifest `flag` field. No manifest schema change.

**Rationale**:

- Upstream `PresetFilter::matches` compares `when.emulator` against `args.emulator`, and `args.emulator` is true exactly when `-e/--emulator` is present on the command line. The extension is the party that emits the target flag, so this is an identity, not a heuristic: the filter value equals what the launched command will actually set.
- It stays manifest-driven (Principle II) — the value comes from manifest target data, not a hardcoded `targetId === "emulator"` comparison.
- Requires no new manifest field, so existing manifests keep working (Principle V).

**Alternatives considered**:

- Match `targetId === "emulator"` — rejected: hardcodes an id the manifest is free to rename, which Principle II forbids.
- Add an `emulator: true` boolean to manifest targets — rejected: a schema change plus product-spec `targets` update for information already carried by `flag`.

---

## Decision 4 — Mapping preset option keys to manifest build options

**Decision**: Add an optional `id` field to `BuildOption` in `src/manifest/manifest-types.ts`, populated from the manifest `options[].id`. A preset fragment key matches a build option when the key equals that `id`; when a manifest entry omits `id`, the fallback match key is its `flag` with leading dashes stripped.

**Rationale**:

- Upstream `BuildOptions` uses `#[serde(rename_all = "kebab-case")]`, so preset keys are kebab-case option names (`btc-only`, `dbg-console`, `source-lines`). The tf-tools manifest already uses those same strings as `options[].id`.
- The existing `BuildOption.key` is a persistence key derived from the flag (`--btc-only` → `btc_only`) and is deliberately not the CLI-facing name, so it cannot be used for matching without an assumption about the flag shape.
- `specs/product-spec.md` documents `options[].id` as optional with `flag` defaulting to `--<id>`, so carrying `id` through is a two-line parser change and makes the mapping explicit rather than inferred.

**Alternatives considered**:

- Reverse-derive the key from `flag` only — rejected: breaks for any option that declares an explicit `flag` different from `--<id>`, which the manifest schema permits.

---

## Decision 5 — Option keys the manifest does not define are ignored, not errors

**Decision**: A fragment key that matches no manifest build option contributes nothing and produces no validation issue and no diagnostic. It is recorded in log output at informational level only when it is the first time that key is seen for a file load.

**Rationale**:

- The real shared `core/embed/xtask/tf-tools/presets.toml` sets `asan`, which the tf-tools manifest deliberately does not expose. Treating unknown keys as errors would report the workspace's own committed preset file as invalid and block Build for every user.
- FR-018 keeps the manifest as the source of truth for which options the extension supports; options outside that set are `xtask`'s business, not the extension's.
- `xtask` itself rejects unknown keys via `deny_unknown_fields`, so genuine typos are still caught — by the build, at the layer that owns the full option list.

**Alternatives considered**:

- Report unknown keys as errors and block workflows — rejected: contradicted by the committed upstream file; would make the feature unusable on day one.
- Report them as warning diagnostics — rejected: every user would see permanent warnings on a file they cannot fix from the extension.

---

## Decision 6 — `when` filter validation boundary

**Decision**: Validate the *shape* of `when`, not the *membership* of its values.

File-level validation errors (each blocks Build/Clippy/Check and replaces the preset choices with an error row):

- TOML syntax errors.
- A top-level value that is not an array of tables.
- A `when` value that is not a table.
- A `when` field other than `model`, `project`, or `emulator`.
- `when.model` or `when.project` that is not an array of strings.
- `when.emulator` that is not a boolean.

Not errors: `when.model` or `when.project` values that do not correspond to any manifest model or component id. They simply never match, so a fragment guarded by them is skipped.

**Rationale**:

- Upstream `PresetFilter` carries `#[serde(deny_unknown_fields)]` with `Option<Vec<Model>>` / `Option<Vec<Project>>` / `Option<bool>`, so shape violations are hard `xtask` errors and the extension should surface them the same way (Principle IV).
- Membership must stay permissive: `xtask`'s `Project` enum includes `kernel` and `secmon`, which are not tf-tools manifest components — and the committed `presets.toml` documents exactly such a fragment (`project = ["firmware", "kernel"]`) in its trailing example. Validating membership would reject valid files.
- Non-matching values are already handled by the spec: a preset with no matching fragment for the active build context is simply not offered (FR-006), and selection normalization falls back to `Default` (FR-008).

---

## Decision 7 — The reserved preset name `default`

**Decision**: `default` is reserved for the synthetic tree choice. A fragment group literally named `[[default]]` in either file is excluded from the named-preset choice list and reported as a warning-severity validation issue (diagnostic on the offending file plus a log entry). It does not block workflows. `defaults` remains the special base-layer group and is likewise never offered as a choice (FR-005).

**Rationale**:

- FR-008 and FR-031 both normalize an unavailable selection to the id `default`, and FR-021 forbids emitting `-p default`. A user-authored preset actually named `default` would therefore be unreachable, since selecting the synthetic choice can never emit `-p default`.
- Silently dropping it would violate Principle IV. Hard-blocking Build for it would be disproportionate — the file is otherwise valid, and every other preset in it still works.

---

## Decision 8 — Multistate options and the null-valued state

**Decision**: Three coupled rules for `type: multistate` options.

1. **Preset-effective value when no layer sets the option**: the state whose manifest `value` is `null` (parsed to state id `"null"` with an empty flag) when the option declares one; otherwise the option is *unresolved*.
2. **Selecting the null-valued state clears the override.** The persisted value becomes `null` (the storage's existing "no explicit selection" marker), so the row follows the active preset. The manifest label for that state (`Default`) reads correctly as "follow the preset".
3. **A stored value equal to the null state's id is normalized to "no explicit selection"** when build options are resolved, so records persisted before this feature behave identically to rule 2.

**Rationale**:

- FR-019 removes the requirement for a manifest-authored `default`, and FR-013 requires the displayed no-override value to be the preset-effective value. A null-valued state already means "pass no value for this option", which is exactly the meaning of "no preset layer set it".
- The command line has no way to *unset* a value a preset established: `--dbg-console` requires a value (`core/embed/xtask/src/options.rs` declares it as a mapped `ConsoleType`, and `docs/core/build/xtask.md` states it "cannot be used bare"). Treating a null-state selection as a real override would therefore require emitting an argument that cannot exist, and rule 2 avoids inventing one.
- Rule 3 prevents a stale stored `"null"` from being counted as an override that then emits the empty flag — which would report an override in the UI while emitting nothing, contradicting FR-022.

**Follow-on documentation duty**: FR-029's `specs/product-spec.md` and `specs/glossary.md` updates must state rules 1–3 under `Build Option Management`, `Persistence And Defaults` → `Default Values`, and the `default state` glossary entry, replacing the current "multistate options default to the manifest-defined default state" wording.

**Alternatives considered**:

- Treat a null-state selection as an override and block the workflow — rejected: an ordinary UI action would produce a blocked build with no way forward.
- Hide the null-valued state row when a preset sets the option — rejected: FR-018 makes the manifest the source of truth for which states exist.

---

## Decision 9 — Emitting a checkbox override that turns an option *off*

**Decision**: An explicit checkbox override emits `<flag>` when selecting on (unchanged existing form) and `<flag>=false` when selecting off against a preset-effective value of on.

**Rationale**:

- FR-022 requires an argument whenever the selected value differs from the preset-effective value. When a preset sets `frozen = true` and the user unchecks the box, the current emission rule (flag only when true) emits nothing, so the launched build would keep the preset's value and contradict the Configuration view.
- `docs/core/build/xtask.md` documents `--btc-only=false` as the explicit-disable form, and `core/embed/xtask/src/options.rs` declares every boolean option with `num_args = 0..=1, default_missing_value = "true"`, so `=false` is the contract's own negative form, not an invention.
- FR-023's "existing argument forms MUST remain unchanged" is preserved for every case that could already occur before this feature: on-overrides still emit the bare flag, and multistate overrides still emit `<flag>=<value>`. The `=false` form appears only in the newly reachable negative-override case.

**Follow-on documentation duty**: FR-029's product-spec update must document the `=false` form under `Build` / `Clippy And Check` command-line shape.

---

## Decision 10 — Two-tier preset failure model

**Decision**: Distinguish file-level invalidity from per-option mismatch.

| Tier | Trigger | `Presets` selector | Build/Clippy/Check | Saved preset id | Signal |
| --- | --- | --- | --- | --- | --- |
| File-level invalid | Decision 6 error list, or an unreadable file | Header stays; choices replaced by an error row | Blocked | Preserved, never resolved (FR-031) | Log entry + diagnostic on the offending file |
| Option-level mismatch | A known option's preset-effective value is not representable by that option (non-boolean for a checkbox, or a multistate value matching no state id) | Choices listed normally | Blocked | Normalized normally | Log entry + diagnostic on the file that supplied the value; affected option row shows the mismatch |
| Unresolved multistate | No layer set the option and it declares no null-valued state | Choices listed normally | Not blocked | Normalized normally | Log entry only; row shown but not overridable and emits no argument |

**Rationale**: The spec separates these outcomes explicitly — the `Failure Modes & Diagnostics` entry for an unrepresentable preset value blocks the workflow, while the `Edge Cases` entry for an unresolvable multistate value only marks the row unavailable for override. Collapsing them would either block builds for a benign gap or launch a guessed argument set, and Principle IV forbids the latter.

---

## Decision 11 — Blocking Build/Clippy/Check without affecting Clean

**Decision**: Add a `tfTools.presetBlocked` VS Code context key alongside the existing `tfTools.workflowBlocked`. In `package.json`, the `Build`, `Clippy`, and `Check` `view/title` entries become `enablement: "!tfTools.workflowBlocked && !tfTools.presetBlocked"`; `Clean` keeps `enablement: "!tfTools.workflowBlocked"`. `WorkflowBlockReason` gains a `presets-invalid` variant with its own message, evaluated after the manifest reasons.

**Rationale**:

- FR-025 requires Clean to retain its pre-feature argument *and* availability behavior, and the current single `tfTools.workflowBlocked` key gates all four actions together. Reusing it would silently disable Clean whenever a preset file is malformed — a scope violation against the spec's Scope Guard.
- A second key is the smallest change that keeps the two blocking domains independent; no restructuring of the existing precondition helper is needed.

---

## Decision 12 — Position of the `-p` argument

**Decision**: `cargo xtask <sub> <component-id> -m <model-id> [target-flag] [-p <preset>] [option-override-flags]`. The preset pair is emitted after the target flag and before any option overrides, exactly once, and only for a named active preset.

**Rationale**: FR-021 fixes the content and cardinality but not the position. Placing `-p` ahead of the option overrides mirrors the documented precedence chain (presets first, explicit flags last), keeps a single deterministic order for the argument assertions in `src/test/unit/workflow/build-arguments.test.ts`, and leaves the existing prefix `<component-id> -m <model-id> [target-flag]` byte-identical for the `Default` case.

---

## Decision 13 — Recalculating before launch

**Decision**: The Build/Clippy/Check command handlers `await presetService.reload()` before deriving arguments, then recompute available presets, normalize the active preset, and recompute preset-effective values from the fresh state. A reload that yields a file-level invalid state, or any option-level mismatch, blocks the launch with an explanatory error plus a log entry.

**Rationale**: FR-020 requires recalculation from "current preset inputs", and the failure mode for "preset data changes between display and command invocation" requires a fresh calculation with a blocked launch on failure. The file watcher is debounced by 300 ms, so a cached state can legitimately be stale at invocation time. Two small file reads on an already-async command path is cheaper than a correctness gap, and the reload flows through the existing `onDidChangeState` refresh chain so the UI converges too.

---

## Decision 14 — Preset service shape and refresh triggers

**Decision**: Add `PresetService` in `src/presets/preset-service.ts`, modeled on the existing `ManifestService`: it owns the two file URIs, loads and validates both, publishes a `PresetState` through an `onDidChangeState` emitter, and watches both paths for create/change/delete with the same 300 ms debounce. Preset-dependent refresh runs on: activation, preset-state change, manifest-state change, active model/target/component change, and a `tfTools.cargoWorkspacePath` setting change.

**Rationale**:

- FR-026 requires create/change/delete watching with no window reload; FR-009 requires refresh on either preset input or any active build-context axis. Mirroring `ManifestService` keeps one recognizable service shape instead of a second pattern (Principle V), and reuses the debounce behavior the product spec already documents for manifest reloads.
- `tfTools.cargoWorkspacePath` currently has no change handler in `src/extension.ts`; Decision 2 makes it a preset input, so `Setting Change` gains that trigger.

---

## Decision 15 — Diagnostic ranges for preset issues

**Decision**: Attach preset diagnostics to the URI of the file that produced them. Syntax errors use the `TomlError` `line`/`column` converted to a `vscode.Range`. Semantic issues (Decision 6 shape errors, Decision 7 reserved name, Decision 10 mismatches) are anchored to the line of the owning `[[name]]` header, located by a single regex scan over the raw text captured during load; when no header line can be found the range is omitted and `publishDiagnostics` falls back to its existing `Range(0,0,0,0)` behavior.

**Rationale**: Principle IV requires diagnostics for file-backed problems but not character-exact ranges. `smol-toml` returns a document-level position only, so a fragment-header line index is the cheapest way to make the Problems view actionable without a second, range-aware parse.

---

## Decision 16 — `Presets` selector iconography

**Decision**: Use the `layers` codicon for the `Presets` selector header, keeping `check` for the active choice and `images/blank-tree-icon.svg` as the inactive spacer, matching the three existing selectors.

**Rationale**: FR-002 requires the same interaction conventions as the existing selectors, and `Configuration View Iconography` in `specs/product-spec.md` enumerates one distinct icon per selector. `layers` reads as a stack of overlaid option layers, which is what a preset is. It must be added to that product-spec list as part of FR-029.

**Alternatives considered**: `bookmark` (reads as a saved location rather than a layered set) and `settings-gear` (already connotes VS Code settings).

---

## Resolved Ambiguities Requiring Spec Or Product-Doc Text

These are behaviors the implementation must have, that the current `spec.md` does not state explicitly. They are resolved above and must be written into `specs/product-spec.md` and `specs/glossary.md` as part of FR-029 rather than left implicit:

1. Selecting a multistate option's null-valued state clears the override; a stored null-state id is normalized to "no explicit selection" (Decision 8).
2. A checkbox override that turns an option off emits `<flag>=false` (Decision 9).
3. A fragment key unknown to the manifest is ignored rather than reported (Decision 5).
4. `when.model` / `when.project` values unknown to the manifest never match and are not errors (Decision 6).
5. `default` is a reserved preset name; a preset so named is excluded with a warning (Decision 7).
6. Clean's availability is not affected by preset-file invalidity (Decision 11).

None of these introduce behavior outside the feature's declared affected product areas.
