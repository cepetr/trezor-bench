# Phase 1 Data Model: Build Preset Support

**Branch**: `009-build-preset-support` | **Date**: 2026-07-31 | **Spec**: `specs/009-build-preset-support/spec.md`

**File Reference Rule**: Use workspace-relative paths for any repository file references written into this document.

Types below are described as the TypeScript shapes the implementation introduces or changes. Rationale for each rule lives in `specs/009-build-preset-support/research.md`.

---

## 1. Preset input model

Owned by `src/presets/preset-types.ts`. Produced by `src/presets/parse-presets.ts` from raw TOML text; no I/O.

### `PresetSource`

Which of the two inputs a value came from. Drives precedence layering and diagnostic attribution.

| Field | Type | Notes |
| --- | --- | --- |
| — | `"shared" \| "user"` | `"shared"` = `presets.toml`, `"user"` = `user-presets.toml`. Shared is always layered before user. |

### `PresetFilter`

Parsed `when` table of one fragment. Every field is optional; an omitted field matches every active build context.

| Field | Type | Validation |
| --- | --- | --- |
| `models` | `ReadonlyArray<string>` (optional) | From `when.model`. Must be an array of strings. Values are **not** checked against manifest model ids. |
| `projects` | `ReadonlyArray<string>` (optional) | From `when.project`. Must be an array of strings. Values are **not** checked against manifest component ids. |
| `emulator` | `boolean` (optional) | From `when.emulator`. Must be a boolean. |

Matching rule (FR-012): fields present are combined with AND; values inside one field are combined with OR; an absent field matches all.

### `PresetFragment`

One `[[name]]` table.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | Group name. `"defaults"` is the reserved base-layer name. |
| `source` | `PresetSource` | File that declared it. |
| `order` | `number` | 0-based position within its `(source, name)` group, preserving file order (FR-011). |
| `filter` | `PresetFilter` | Empty object when `when` is absent. |
| `values` | `Readonly<Record<string, PresetRawValue>>` | Every non-`when` key, verbatim. Keys are kebab-case option names. |
| `headerLine` | `number` (optional) | 0-based line of the `[[name]]` header, for diagnostic anchoring. |

`PresetRawValue` = `boolean | string | number`. Other TOML value kinds (arrays, tables, dates) are recorded as-is and become an option-level mismatch if a manifest option claims that key.

### `PresetFile`

| Field | Type | Notes |
| --- | --- | --- |
| `source` | `PresetSource` | |
| `uri` | `vscode.Uri` | Used for diagnostics. |
| `present` | `boolean` | `false` when the file does not exist. An absent file is equivalent to an empty file (FR-027) and never an error. |
| `names` | `ReadonlyArray<string>` | Group names in first-declaration order, excluding `defaults`. Includes a reserved `default` group only for issue reporting; it is filtered out of choices. |
| `fragments` | `ReadonlyArray<PresetFragment>` | All fragments across all groups, in file order. |
| `issues` | `ReadonlyArray<ValidationIssue>` | Reuses the existing `ValidationIssue` type from `src/manifest/manifest-types.ts`. |

### `PresetState`

Published by `PresetService`, mirroring the `ManifestState` discriminated-union pattern.

| Variant | Fields | Meaning |
| --- | --- | --- |
| `{ status: "loaded" }` | `shared: PresetFile`, `user: PresetFile`, `loadedAt: Date`, `validationIssues` | Both inputs parsed. Either or both may be absent-and-empty. May carry warning-severity issues (e.g. reserved `default` name). |
| `{ status: "invalid" }` | `shared`, `user`, `validationIssues`, `loadedAt` | At least one input is unreadable or has an error-severity issue. Preset choices are replaced by an error row; Build/Clippy/Check are blocked; the saved preset id is preserved unresolved. |

`PresetState` is `undefined` before the first load; the `Presets` selector shows the loading placeholder in that window.

New `ValidationCode` members required: `toml-parse`, `invalid-filter`, `reserved-preset-name`, `preset-value-mismatch`.

---

## 2. Preset resolution model

Owned by `src/presets/preset-resolution.ts`. Pure functions over `PresetState` plus the active build context.

### `PresetContext`

The active build context expressed in upstream filter terms.

| Field | Type | Derivation |
| --- | --- | --- |
| `modelId` | `string` | `ActiveConfig.modelId`. |
| `projectId` | `string` | `ActiveConfig.componentId` — upstream `project` maps to the tf-tools component. |
| `emulator` | `boolean` | `target.flag === "--emulator" \|\| target.flag === "-e"` for the active target. |

### `AvailablePreset`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Preset name, or the reserved `"default"` for the synthetic choice. |
| `label` | `string` | `"Default"` for the synthetic choice; otherwise the preset name verbatim. |
| `isDefault` | `boolean` | `true` only for the synthetic choice. |

Availability rules:

- The synthetic `Default` entry is **always** first and always present, including when neither file declares any `[[defaults]]` fragment (FR-004, Acceptance Scenario 1.2).
- A named preset is listed exactly once, at the position of its first declaration, scanning the shared file's `names` then the user file's `names` (FR-003).
- A named preset is listed only when at least one of its fragments — from either file — matches the `PresetContext` (FR-006).
- `defaults` is never listed (FR-005). A group named `default` is never listed (research Decision 7).

### `PresetEffectiveValue`

The preset-effective value for one manifest build option, before explicit overrides.

| Field | Type | Notes |
| --- | --- | --- |
| `optionKey` | `string` | `BuildOption.key`. |
| `state` | `"resolved" \| "unresolved" \| "mismatch"` | See table below. |
| `value` | `boolean \| string` (optional) | Present only when `state === "resolved"`. `boolean` for checkbox, state id for multistate. |
| `rawValue` | `PresetRawValue` (optional) | Present when `state === "mismatch"`, for the diagnostic message. |
| `sourceUri` | `vscode.Uri` (optional) | File that supplied the mismatching value. |

Layering (FR-010, FR-011): start empty, then overlay, in order:

1. matching `shared` `defaults` fragments, in file order;
2. matching `user` `defaults` fragments, in file order;
3. matching `shared` fragments named for the active preset (skipped when the active preset is `default`);
4. matching `user` fragments named for the active preset (skipped when the active preset is `default`).

Within every layer, a later matching fragment replaces an earlier value for the same key; keys a fragment omits keep their prior value.

Raw value → option value:

| Option kind | Raw value | Result |
| --- | --- | --- |
| checkbox | `boolean` | `resolved`, `value = raw` |
| checkbox | anything else | `mismatch` |
| checkbox | absent | `resolved`, `value = false` (upstream implicit disabled) |
| multistate | `String(raw)` matches a state id | `resolved`, `value = that state id` |
| multistate | `String(raw)` matches no state id | `mismatch` |
| multistate | absent, option declares a state with `value: null` | `resolved`, `value = "null"` |
| multistate | absent, no null-valued state | `unresolved` |

Keys that match no manifest option contribute nothing and produce no issue (research Decision 5).

---

## 3. Active configuration (changed)

`ActiveConfig` in `src/configuration/active-config.ts` gains the preset selection, keeping FR-007's single workspace-scoped record.

| Field | Type | Change |
| --- | --- | --- |
| `modelId` | `string` | unchanged |
| `targetId` | `string` | unchanged |
| `componentId` | `string` | unchanged |
| `presetId` | `string` (optional) | **new.** Active preset id. `"default"` for the synthetic choice. Optional so records persisted before this feature deserialize without loss; absent is read as `"default"`. |
| `persistedAt` | `string` | unchanged |

`DEFAULT_PRESET_ID = "default"` is exported from the same module and is the only value that suppresses `-p`.

Lifecycle:

- **Read**: `activePresetId(config)` returns `config?.presetId ?? DEFAULT_PRESET_ID`.
- **Select**: `selectPreset(context, presetId, manifest)` mirrors `selectModel`/`selectTarget`/`selectComponent` — normalize the manifest axes, then write with the new `presetId`.
- **Normalize** (`normalizePresetId` in `src/configuration/normalize-config.ts`): given the saved id and `availableIds: ReadonlySet<string> | undefined`:
  - `availableIds === undefined` → return the saved id unchanged (preset state invalid; FR-031 forbids resolving it);
  - saved id present in `availableIds` → keep it (FR-008, Acceptance Scenario 1.6);
  - otherwise → `DEFAULT_PRESET_ID` (FR-008, Acceptance Scenario 1.4).
- **Write-back**: only when normalization actually changed the id, matching the existing `restoreActiveConfig` behavior. While preset state is invalid no preset write ever occurs.
- **Excluded from display**: the preset never enters the build-context display string, status bar, task labels, or command names (FR-024).

`isConfigValid` is unchanged — it validates manifest axes only, because preset validity is not a manifest property.

---

## 4. Resolved build option (changed)

`ResolvedOption` in `src/configuration/build-options.ts` becomes preset-relative.

| Field | Type | Change |
| --- | --- | --- |
| `option` | `BuildOption` | unchanged |
| `available` | `boolean` | unchanged — manifest `when` against the active build context |
| `value` | `boolean \| string` | unchanged meaning: the value the UI shows and commands consider. Now falls back to the preset-effective value instead of `false` / `defaultState`. |
| `presetValue` | `boolean \| string` (optional) | **new.** The preset-effective value, when `state === "resolved"`. |
| `presetState` | `"resolved" \| "unresolved" \| "mismatch"` | **new.** Mirrors `PresetEffectiveValue.state`. |
| `isOverride` | `boolean` | **new.** `true` only when an explicit stored selection differs from `presetValue`. Drives visual emphasis (FR-015) and argument emission (FR-022). |

Resolution order for `value`:

1. Read the stored selection for `option.key`.
2. Discard it when: it is `null`; it is a multistate value matching no current state id; or it is a multistate value equal to the null-valued state's id (research Decision 8, rule 3).
3. If a selection survives, `value` = that selection and `isOverride = value !== presetValue`.
4. Otherwise `value` = `presetValue` and `isOverride = false`.
5. When `presetState === "unresolved"`, `value` is the null-valued state id if one exists, else the first state id; `isOverride` is forced `false` and the row is not overridable.
6. When `presetState === "mismatch"`, `isOverride` is forced `false` and the option contributes no argument.

FR-016 falls out of step 3: a stored selection equal to `presetValue` yields `isOverride === false`, so it is neither emphasized nor emitted.

FR-017 falls out of the same steps: stored selections are never rewritten when the active preset changes, so a still-differing override survives while `presetValue` is recalculated.

`BuildOption` also gains `readonly id?: string` (research Decision 4).

---

## 5. Argument derivation (changed)

`deriveWorkflowArguments` in `src/commands/build-workflow.ts` takes the active preset id in addition to its current inputs and produces:

```text
<component-id> -m <model-id> [target-flag] [-p <preset-id>] [override-flags…]
```

- `-p <preset-id>` is emitted exactly once and only when `presetId !== "default"` (FR-021). `-p default` is never emitted (FR-021, Acceptance Scenario 3.6).
- `override-flags` come only from options where `available && isOverride` (FR-022), in manifest declaration order.
- Checkbox override → `<flag>` when the selected value is `true`, `<flag>=false` when it is `false` (research Decision 9).
- Multistate override → the selected state's existing `flag` (`<option-flag>=<value>`), unchanged (FR-023).
- `deriveCleanArguments` is untouched and still returns `[]` (FR-025).

`WorkflowBlockReason` gains `"presets-invalid"`, evaluated after `manifest-invalid`, with its own message from `blockReasonMessage`.

---

## 6. Tree presentation (changed)

`src/ui/configuration-tree.ts`:

- `SelectorKind` gains `"preset"`; `SELECTOR_ICONS.preset = "layers"`; `SELECT_COMMANDS.preset = "tfTools.selectPreset"`.
- The `Build Selection` children become `Model`, `Target`, `Component`, `Presets` — the new selector is last, directly below `Component` (FR-001).
- Selector description: the active preset's label, `Default` for the synthetic choice, `—` when nothing has resolved yet.
- Expanded children:
  - preset state `undefined` → `PlaceholderItem("Loading…")`;
  - preset state `invalid` → `WarningItem` naming the failing file plus `PlaceholderItem("Check the Problems view for details")`, replacing all choices (FR-028, FR-030);
  - preset state `loaded` → one `SelectorChoiceItem` per `AvailablePreset`, `Default` first.
- Only one selector expands at a time — the existing `_expandedSelector` single-value state already enforces this, so `"preset"` participates unchanged (FR-002).
- `_isNonDefault` is replaced by `resolved.isOverride` for both the checkbox and multistate emphasis paths and for the group-header rollup (FR-015).
- A `presetState === "mismatch"` option renders with the `warning` icon and a description naming the unrepresentable value; a `presetState === "unresolved"` option renders normally but with its state children non-selectable.

---

## 7. Persisted state summary

| Key | Shape change | Migration |
| --- | --- | --- |
| `tfTools.activeConfig` | adds optional `presetId` | Legacy records read as `presetId === undefined` → treated as `"default"`; written on the first restore that also changes something, or on the first explicit preset selection. |
| `tfTools.buildOptions` | no shape change | Stored multistate values equal to a null-valued state id are treated as "no explicit selection" at resolve time (research Decision 8, rule 3). No rewrite of stored data is performed. |

---

## 8. Entity relationships

```text
PresetService ──publishes──> PresetState
                               │
   ManifestStateLoaded ────────┤
   ActiveConfig ───────────────┼──> PresetContext ──> AvailablePreset[]        (Presets selector)
                               │                 └──> PresetEffectiveValue[]  (per manifest option)
                                                          │
   tfTools.buildOptions ──────────────────────────────────┼──> ResolvedOption[]
                                                                   │
                                          ┌────────────────────────┴───────────────┐
                                          │                                        │
                                 Build Options rows                     deriveWorkflowArguments
                                 (emphasis, mismatch)                   (-p + override flags)
```
