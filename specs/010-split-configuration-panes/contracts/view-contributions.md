# Contract: View And Menu Contributions

**Feature**: `specs/010-split-configuration-panes/` | **Date**: 2026-08-01

The extension's user-facing contract for this feature is its contribution surface in `package.json`, plus the tree-item contract each pane renders. This document is the reference the implementation and its integration tests are checked against.

## 1. View container

Unchanged.

| Field | Value |
|---|---|
| id | `tf-tools` |
| title | `Trezor` |
| icon | `images/tf-tools.svg` |
| location | activity bar |

## 2. Views

Three entries under `contributes.views["tf-tools"]`, in this exact array order — the array order is the pane order (FR-001).

| # | View id | `name` | `type` | `icon` | `visibility` |
|---|---|---|---|---|---|
| 1 | `tfTools.configuration` (inherited) | `Build Selection` | `tree` | `images/tf-tools.svg` | omitted (defaults to `visible`) |
| 2 | new id, `tfTools.` prefixed | `Build Options` | `tree` | `images/tf-tools.svg` | `collapsed` |
| 3 | new id, `tfTools.` prefixed | `Build Artifacts` | `tree` | `images/tf-tools.svg` | omitted (defaults to `visible`) |

**Rules**

- Entry 1 MUST reuse today's view id. Renaming it is a breaking change to the status-bar command and to saved view placement (FR-017).
- No entry declares a `when` clause; all three panes are always contributed (FR-012).
- No entry declares Collapse All; the `TreeView` options keep `showCollapseAll: false` for all three (FR-009d).
- `visibility` is an initial state only. The host stops applying it once the user has collapsed, moved, or hidden a view (FR-004, FR-005).

## 3. `view/title` — the workflow toolbar

Every existing entry keeps its command, `group`, `enablement`, and order, and stays bound to the inherited view id, which is now the `Build Selection` pane (FR-009, FR-009b).

| Command | Group | Enablement |
|---|---|---|
| `tfTools.build` | `navigation@1` | `!tfTools.workflowBlocked && !tfTools.presetBlocked` |
| `tfTools.startDebugging` | `navigation@2` | `tfTools.startDebuggingEnabled` |
| `tfTools.build` | `overflow@1` | `!tfTools.workflowBlocked && !tfTools.presetBlocked` |
| `tfTools.clippy` | `overflow@2` | `!tfTools.workflowBlocked && !tfTools.presetBlocked` |
| `tfTools.check` | `overflow@3` | `!tfTools.workflowBlocked && !tfTools.presetBlocked` |
| `tfTools.clean` | `overflow@4` | `!tfTools.workflowBlocked` |
| `tfTools.flash` | `overflow@5`, `when` includes `tfTools.flashApplicable` | `tfTools.binaryExists` |
| `tfTools.upload` | `overflow@6`, `when` includes `tfTools.uploadApplicable` | `tfTools.binaryExists` |
| `tfTools.startDebugging` | `overflow@7` | `tfTools.startDebuggingEnabled` |
| `tfTools.refreshIntelliSense` | `overflow@8` | — |

**Rules**

- No `view/title` entry may reference the `Build Options` or `Build Artifacts` view ids (FR-009a).
- The `viewContainer/title` menu MUST NOT be used; it is proposed API (FR-009c).

## 4. `view/item/context` — artifact row actions

All four entries MUST be retargeted from the inherited view id to the `Build Artifacts` view id, because the rows they attach to now live there. Command, `group`, `enablement`, and `viewItem` matching are unchanged (FR-008).

| Command | `viewItem` | Group | Enablement | Additional `when` |
|---|---|---|---|---|
| `tfTools.flash` | `artifact-binary` | `inline@1` | `tfTools.binaryExists` | `tfTools.flashApplicable` |
| `tfTools.upload` | `artifact-binary` | `inline@2` | `tfTools.binaryExists` | `tfTools.uploadApplicable` |
| `tfTools.openMapFile` | `artifact-map` | `inline@1` | `tfTools.mapExists` | — |
| `tfTools.startDebugging` | `artifact-executable` | `inline@1` | `tfTools.startDebuggingEnabled` | — |

## 5. `commandPalette`

Unchanged. `tfTools.openMapFile` stays hidden (`when: false`); `tfTools.flash`, `tfTools.upload`, and `tfTools.startDebugging` keep their applicability clauses.

## 6. Commands

No command is added, removed, or renamed. `contributes.commands` is untouched, so the activation-time scope guard in `src/extension.ts` needs no change.

**Side effect to account for**: the editor auto-generates per-view commands (`<viewId>.focus`, `<viewId>.resetViewLocation`, and similar) for each contributed view. Two new view ids therefore add auto-generated commands that were not present before. They are host-generated, not contributed, but the scope-guard integration test enumerates registered `tfTools.*` commands and filters only the inherited id's prefix today; its filter must cover all three view ids.

## 7. Tree item contract

Unchanged for every row type. Ids, `contextValue`s, icons, descriptions, tooltips, and checkbox states keep their current values (FR-002), which is what keeps the `view/item/context` matching and the existing row-level tests valid:

`selector:<kind>:<expanded|collapsed>`, `choice-<kind>`, `build-option:<key>`, `build-option-group:<label>:<state>`, `build-option-multistate:<key>:<state>`, `build-option-state:<key>:<stateId>`, `artifact:compile-commands`, `artifact:binary`, `artifact:map`, `artifact:executable`, `warning`, `placeholder`.

**Removed**: the `section:<id>` item id and the `build-context` / `build-options` / `build-artifacts` `contextValue`s that belonged to `SectionItem` (FR-003). No menu entry references them today, so removing them contributes no menu change.

## 8. Status bar

| Field | Value |
|---|---|
| command | `<inherited view id>.focus` — unchanged string |
| effect | opens the container, expands `Build Selection` when collapsed, focuses it (FR-010) |

The command string stays valid only because entry 1 inherits the view id. Any renaming of that id must update `src/ui/status-bar.ts` in the same change.
