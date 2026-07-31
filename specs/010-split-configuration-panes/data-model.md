# Phase 1 Data Model: Split Configuration Panes

**Feature**: `specs/010-split-configuration-panes/` | **Date**: 2026-08-01

This feature adds no persisted data and no manifest structure. The model below describes the presentation entities the implementation introduces or reshapes, and where each piece of state lives.

## Entities

### Configuration pane

One of the three top-level surfaces in the `tf-tools` container.

| Attribute | Value | Owner |
|---|---|---|
| Pane id | `build-selection`, `build-options`, `build-artifacts` | Extension (`PaneId`) |
| View id | inherited id for `Build Selection`; new ids for the other two | `package.json` |
| Title | `Build Selection`, `Build Options`, `Build Artifacts` | `package.json` |
| Position | fixed declaration order 1, 2, 3 | `package.json` |
| Initial collapse state | expanded, collapsed, expanded | `package.json` (`visibility`) |
| Current collapse state | user's choice, restored across reloads | Editor host |
| Visibility (shown/hidden) | user's choice via container context menu | Editor host |
| Header actions | `Build Selection` only | `package.json` (`view/title`) |
| Content rows | see *Pane content set* | Extension |

**Validation rules**

- Exactly three panes exist, always contributed, never conditionally removed (FR-001, FR-012).
- No pane declares a Collapse All action (FR-009d).
- `Build Options` is the only pane declaring `visibility: collapsed` (FR-004).
- Only `Build Selection` carries `view/title` entries (FR-009, FR-009a).

**State transitions**: collapsed ⇄ expanded and shown ⇄ hidden are host-driven; the extension neither initiates nor observes them. There is no extension-side state machine.

### Workflow toolbar

The single action surface on the `Build Selection` pane header. Not a runtime object — it is the set of `view/title` contributions bound to the inherited view id.

| Member | Group | Enablement |
|---|---|---|
| `Build` | navigation, then overflow | `!workflowBlocked && !presetBlocked` |
| `Start Debugging` | navigation, then overflow | `startDebuggingEnabled` |
| `Clippy`, `Check` | overflow | `!workflowBlocked && !presetBlocked` |
| `Clean` | overflow | `!workflowBlocked` |
| `Flash to Device`, `Upload to Device` | overflow, shown when applicable | `binaryExists` |
| `Refresh IntelliSense` | overflow | always |

**Validation rules**: membership, order, grouping, icons, and enablement expressions are unchanged from today (FR-009); contents never vary with the focused pane (FR-009b).

### Pane content set

The rows a pane renders for current state. Composition is unchanged from the corresponding section today (FR-002).

| Pane | Rows |
|---|---|
| `Build Selection` | four selector headers (`Model`, `Target`, `Component`, `Preset`) and, under the expanded one, its choice rows; otherwise the loading, missing-manifest, or invalid-manifest placeholder set |
| `Build Options` | option group headers with their children, ungrouped checkbox and multistate rows in manifest declaration order, multistate state rows under an expanded header; otherwise the loading, unavailable, workflow-blocked, no-options-defined, or no-options-available placeholder set |
| `Build Artifacts` | `Compile Commands`, `Binary`, `Map File`, `Executable` rows as their artifact states exist; otherwise the not-yet-evaluated placeholder |

**Validation rules**: no row labelled `Build Selection`, `Build Options`, or `Build Artifacts` appears in any pane's content (FR-003); placeholder wording is unchanged and stays in its own pane (FR-011).

## Runtime types

### `PaneId`

`"build-selection" | "build-options" | "build-artifacts"` — replaces `SectionId`. Renamed because the section concept is removed with `SectionItem` (FR-003).

### `ConfigurationTreeProvider` (existing, retained)

Sole owner of displayed state. Unchanged fields: manifest state, active configuration, resolved options, preset state and choices, active preset id, the four artifact states, expanded selector, expanded multistate key, collapsed option groups.

Changes:

- `getChildren(undefined)` no longer returns section rows; per-pane root building is exposed for the facade.
- `SectionItem` and `getSectionCollapsibleState()` are removed.
- Change notification becomes addressable per pane so each facade can relay only what concerns it.

### `PaneTreeProvider` (new)

`implements vscode.TreeDataProvider<vscode.TreeItem>`. Constructed with the owner and a `PaneId`. Holds no state of its own.

- `getChildren(undefined)` → the owner's root rows for this `PaneId`.
- `getChildren(element)` → the owner's existing element dispatch (group children, multistate states, selector choices).
- `getTreeItem(element)` → the element itself, as today.
- `onDidChangeTreeData` → relays the owner's signal for this `PaneId`.

## State ownership summary

| State | Owner | Persisted | Changed by this feature |
|---|---|---|---|
| Active configuration, build-option values | Extension, workspace state | Yes | No |
| Manifest, preset, resolved-option, artifact state | Extension, in memory | No | No |
| Expanded selector, expanded multistate option, collapsed option groups | Extension, in memory | No | No — routing of the host events that drive them changes |
| Pane collapse state, pane visibility, pane placement | Editor host | Yes | New — the host takes this over from the deleted `SectionItem` collapsible state |
