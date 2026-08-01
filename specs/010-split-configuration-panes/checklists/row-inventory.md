# Pre-Change Row Inventory: Split Configuration Panes

**Purpose**: The FR-002 / SC-002 reference. Every row below is what the corresponding
section renders **today**, derived from `src/ui/configuration-tree.ts` and
`src/test/unit/ui/configuration-tree.test.ts` as they stood before this feature touched
any row-rendering code. After the split, each pane must render exactly the rows listed
under its section, unchanged in label, icon, description, tooltip, checkbox state, and
`contextValue`/`id`.

**Created**: 2026-08-01

---

## Section: `build-context` → pane `build-selection` ("Build Selection")

### State: loading (`ManifestState` is `undefined`)

| Row | Type | id | contextValue | icon | description | tooltip |
|---|---|---|---|---|---|---|
| `Loading…` | `PlaceholderItem` | — | `placeholder` | `info` | — | — |

### State: missing (`status === "missing"`)

| Row | Type | id | contextValue | icon | description | tooltip |
|---|---|---|---|---|---|---|
| `Manifest file not found` | `WarningItem` | — | `warning` | `warning` | — | — |
| `` Expected: `<manifestUri.fsPath>` `` | `PlaceholderItem` | — | `placeholder` | `info` | — | — |

### State: invalid (`status === "invalid"`)

| Row | Type | id | contextValue | icon | description | tooltip |
|---|---|---|---|---|---|---|
| `Manifest has 1 validation error` (singular) or `Manifest has N validation error(s)` | `WarningItem` | — | `warning` | `warning` | — | — |
| `Check the Problems view for details` | `PlaceholderItem` | — | `placeholder` | `info` | — | — |

### State: loaded — four selector headers, in order

| Row | Type | id | contextValue | icon | description | tooltip | checkboxState |
|---|---|---|---|---|---|---|---|
| `Model` | `SelectorHeaderItem` | `selector:model:<expanded\|collapsed>` | `selector-model` | `circuit-board` | active model name or `—` | `""` | — |
| `Target` | `SelectorHeaderItem` | `selector:target:<expanded\|collapsed>` | `selector-target` | `target` | active target `shortName` (falls back to `name`) or `—` | `""` | — |
| `Component` | `SelectorHeaderItem` | `selector:component:<expanded\|collapsed>` | `selector-component` | `extensions` | active component name or `—` | `""` | — |
| `Preset` | `SelectorHeaderItem` | `selector:preset:<expanded\|collapsed>` | `selector-preset` | `layers` | see Preset selector substates below | `""` | — |

Collapsible state: `Expanded` if this selector is the currently-expanded one, else `Collapsed`. Only one selector is expanded at a time.

**Choice rows** (children of an expanded selector, non-preset kinds — `model` / `target` / `component`):

| Row | Type | contextValue | icon | description | command |
|---|---|---|---|---|---|
| entry name | `SelectorChoiceItem` | `choice-<kind>` | `check` (active) or blank-spacer image | `"active"` (active) or `undefined` | `tfTools.select<Kind>` with `[entryId]` |

**Preset selector description substates** (the `Preset` row's `description`):

| Preset state | description |
|---|---|
| `presetState.status === "unavailable"` | `"Unavailable"` |
| `activePresetId === undefined` | `undefined` (renders as `—`) |
| otherwise | the active preset's `label` |

**Preset selector expanded-children substates**:

| Preset state | Rows |
|---|---|
| `presetState === undefined` (loading) | `PlaceholderItem("Loading…")` |
| `unavailable` | `WarningItem("<sharedFileBaseName> is unavailable")`, `PlaceholderItem("This repository's xtask does not support build presets")` |
| `invalid` | `WarningItem("<offendingFileBaseName> is invalid")`, `PlaceholderItem("Check the Problems view for details")` |
| `loaded` | one `SelectorChoiceItem` per declared preset (`contextValue: choice-preset`), `Default` first, active one marked `description: "active"` |

---

## Section: `build-options` → pane `build-options` ("Build Options")

### State: loading (`ManifestState` is `undefined`)

| Row | Type | contextValue | icon |
|---|---|---|---|
| `Loading…` | `PlaceholderItem` | `placeholder` | `info` |

### State: missing

| Row | Type | contextValue | icon |
|---|---|---|---|
| `No manifest — Build Options unavailable` | `PlaceholderItem` | `placeholder` | `info` |

### State: invalid

| Row | Type | contextValue | icon |
|---|---|---|---|
| `Manifest is invalid — Build Options unavailable` | `PlaceholderItem` | `placeholder` | `info` |

### State: workflow-blocked (`loaded.hasWorkflowBlockingIssues === true`)

| Row | Type | contextValue | icon |
|---|---|---|---|
| `Build workflow blocked: invalid availability rules` | `WarningItem` | `warning` | `warning` |
| `Check the Problems view for details` | `PlaceholderItem` | `placeholder` | `info` |

### State: no-options-defined (`resolvedOptions.length === 0`)

| Row | Type | contextValue | icon |
|---|---|---|---|
| `No build options defined` | `PlaceholderItem` | `placeholder` | `info` |

### State: no-options-available (`resolvedOptions.length > 0` but none `available`)

| Row | Type | contextValue | icon |
|---|---|---|---|
| `No options available for the active build context` | `PlaceholderItem` | `placeholder` | `info` |

### State: loaded with available options — declaration order, grouped rows first-seen

| Row | Type | id | contextValue | icon | description / label emphasis | checkboxState |
|---|---|---|---|---|---|---|
| group label | `BuildOptionGroupItem` | `build-option-group:<label>:<collapsed\|expanded>` | `build-option-group` | — | label bolded when collapsed and any member `isOverride` | — |
| checkbox option | `BuildOptionCheckboxItem` | `build-option:<key>` | `build-option-checkbox` | `warning` if mismatch, else none | label bolded iff `isOverride`; description names unrepresentable value if mismatch | `Checked`/`Unchecked` per `value` |
| multistate option | `BuildOptionMultistateHeaderItem` | `build-option-multistate:<key>:<expanded\|collapsed>` | `build-option-multistate` | `warning` if mismatch else `list-selection` | label bolded iff `isOverride`; description = active state label, or mismatch text | — |
| multistate state child | `BuildOptionStateItem` | `build-option-state:<key>:<stateId>` | `build-option-state` (selectable) or `build-option-state-disabled` (unresolved) | `check` (active) or blank-spacer | — | — |

Tooltips: checkbox and multistate rows show their `option.description` when present, else `undefined`; state children show their state's `description` when present.

---

## Section: `build-artifacts` → pane `build-artifacts` ("Build Artifacts")

### State: not-yet-evaluated (`_artifact === null`)

| Row | Type | contextValue | icon |
|---|---|---|---|
| `IntelliSense not yet evaluated` | `PlaceholderItem` | `placeholder` | `info` |

### State: evaluated — up to four rows, in this order

| Row | Type | id | contextValue | icon | description | tooltip |
|---|---|---|---|---|---|---|
| `Compile Commands` (always present once evaluated) | `CompileCommandsArtifactItem` | `artifact:compile-commands` | `artifact-compile-commands` | `pass` (valid) / `error` (missing) | `valid` / `missing` | artifact path (valid) or `Missing: <path>` plus non-redundant `missingReason` (missing) |
| `Binary` (present iff a binary artifact has been set) | `BinaryArtifactItem` | `artifact:binary` | `artifact-binary` | `pass` / `error` | `valid` / `missing` | same shape as Compile Commands |
| `Map File` (present iff a map artifact has been set) | `MapArtifactItem` | `artifact:map` | `artifact-map` | `pass` / `error` | `valid` / `missing` | same shape |
| `Executable` (present iff an executable artifact has been set; stays visible even when missing) | `ExecutableArtifactItem` | `artifact:executable` | `artifact-executable` | `pass` / `error` | `valid` / `missing` | `artifact.tooltip` verbatim |

All four rows have `collapsibleState: None`.

---

## Cross-cutting invariants this inventory protects

1. No row in any section is itself labelled `Build Selection`, `Build Options`, or `Build Artifacts` — those are today's `SectionItem` root wrappers, which the split removes (FR-003).
2. `Preset` is always the fourth `build-context` child, directly below `Component`.
3. Only one selector expands at a time; expanding a second collapses the first.
4. The `Executable` row renders even when its status is `"missing"` — it is never omitted for the missing case, unlike `Binary`/`Map` which are omitted until first set.
5. Compile Commands is always first among artifact rows when present; Executable directly follows Compile Commands when Binary/Map are absent, and follows Map when both are present.
