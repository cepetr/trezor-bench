# Implementation Plan: Split Configuration Panes

**Branch**: `010-split-configuration-panes` | **Date**: 2026-08-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/010-split-configuration-panes/spec.md`

## Summary

Replace the single `Configuration` tree view with three sibling panes — `Build Selection`, `Build Options`, `Build Artifacts` — inside the existing `tf-tools` activity-bar container, so the three areas are separated by real pane headers and dividers and the editor owns each pane's collapse state.

Technical approach: keep `ConfigurationTreeProvider` as the single owner of manifest, active-configuration, preset, resolved-option, and artifact state, and expose each pane through a thin `PaneTreeProvider` facade that renders one pane's root children and relays the owner's change event. The `SectionItem` row type and `getSectionCollapsibleState()` are deleted; pane titles and the `visibility` contribution replace them. `Build Selection` inherits the existing view id so the status-bar link, the workflow toolbar's `view/title` entries, and any saved view placement carry over untouched; the two new panes get new ids, and the artifact row actions move to the `Build Artifacts` view.

## Technical Context

**Language/Version**: TypeScript, compiled with the repository's existing `tsc` configuration and bundled with esbuild

**Primary Dependencies**: VS Code stable extension API only (`vscode` module plus `contributes.views` and `contributes.menus`); no new runtime dependency

**Storage**: Unchanged. Extension state stays in workspace state (active configuration, build options); pane collapse state is stored by the editor host, not by the extension

**Testing**: `npm run test:unit` (mocha plus the unit-test `vscode` mock) for pane composition and row identity; `npm test` (`@vscode/test-electron`) for contribution-surface and host-behavior assertions; `npm run lint` and `npm run compile` as gates

**Target Platform**: VS Code 1.105+ desktop, single-root workspace (constitution baseline). Host behavior verified against installed 1.130.0 and upstream `1.131.0` / `main`

**Project Type**: Single-package VS Code extension

**Performance Goals**: No new performance target. Refresh cost stays proportional to today's: one state change fans out to at most three view-refresh events instead of one, each rendering a strict subset of today's tree

**Constraints**: Stable, published contribution points only — no API proposal, no `enabledApiProposals`, and no extension-shipped default for any global editor setting. Identifiers stay under 25 characters per constitution principle V

**Scale/Scope**: 3 views, 8 workflow actions, 4 artifact rows, 4 build-context selectors, and a manifest-defined number of build options and option groups

**Unknowns**: None. Every host-behavior question this design depends on was resolved during specification and clarification and is recorded in [research.md](research.md)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Verdict |
|---|---|---|
| I. TypeScript Extension First | All code TypeScript against the stable API available in VS Code 1.105+ | **PASS** — `contributes.views` with `visibility`, per-view `TreeView` creation, and `view/title` / `view/item/context` menus all predate the baseline. The design explicitly forbids the `contribViewContainerTitle` proposal (FR-009c) |
| II. Manifest-Driven Behavior | Content still derives from workspace settings and `tf-tools.yaml` | **PASS** — no change to manifest parsing, option resolution, preset handling, or artifact derivation. Panes are a presentation split over the same state |
| III. Tests Are Mandatory | Tests fail before the change; VS Code integration, persisted state, and command visibility get integration-level coverage | **PASS** — unit tests cover per-pane composition and the removal of section rows; integration tests cover the three view contributions, `view/title` placement, retargeted `view/item/context` entries, and the scope-guard command list. Recorded risk: integration tests cannot execute in the current sandbox, so they must be authored here and run on a normal workstation |
| IV. Failures Must Be Visible | No silent fallbacks; failures surface as diagnostics or log output | **PASS** — no new failure mode. Every placeholder and warning row keeps its wording and moves with its pane (FR-011); diagnostics and the output channel are untouched |
| V. Keep It Small And Clear | Smallest implementation; new abstractions justified; identifiers under 25 characters | **PASS** — one new small class (`PaneTreeProvider`, 16 characters) instead of three duplicated providers; `SectionItem` and `getSectionCollapsibleState()` are deleted, so the change is net-simplifying. `PaneId` replaces `SectionId` |

**Delivery Workflow gates**: affected product areas and glossary terms are named in the spec's Product Documentation Alignment block; `specs/product-spec.md` and `specs/glossary.md` are updated in the same change (FR-015); critical product details are recorded below; tests precede implementation in the task list.

**Post-Phase 1 re-check**: PASS — the Phase 1 design introduces no service, no background worker, no persisted state of its own, and no new dependency. See [data-model.md](data-model.md) and [contracts/view-contributions.md](contracts/view-contributions.md).

## Critical Product Details To Preserve

Recorded per the constitution's requirement that plans capture what is most likely to be missed during coding.

1. **Pane order and initial state** — `Build Selection`, `Build Options`, `Build Artifacts`, in that order. Only `Build Options` declares `visibility: collapsed`; the other two default to visible and expanded. The host honors `visibility` only until the user first collapses, moves, or hides a view.
2. **View identity is inherited, not recreated** — `Build Selection` keeps the existing view id. That is what keeps `tfTools.configuration.focus` (the status-bar command in [status-bar.ts:41](src/ui/status-bar.ts#L41)) working and keeps every `view/title` `when` clause valid without edits.
3. **Row actions move, header actions do not** — the four `view/item/context` entries are scoped to artifact rows and must be retargeted to the `Build Artifacts` view id. All ten `view/title` entries stay bound to the inherited id, which is now the `Build Selection` pane.
4. **The scope-guard integration test filters auto-generated view commands by prefix** — [configuration-scope.integration.test.ts:68](src/test/integration/configuration-scope.integration.test.ts#L68) drops only `tfTools.configuration.*`. Two new view ids mean new auto-generated `*.focus` and `*.resetViewLocation` commands that the test would otherwise report as unauthorized. The filter must cover all three view ids.
5. **Expansion-state event routing** — selector expand/collapse belongs to the `Build Selection` view; multistate and option-group expand/collapse and checkbox changes belong to the `Build Options` view. Each `TreeView` emits events only for its own rows, so the handlers registered on one view today at [extension.ts:533-568](src/extension.ts#L533-L568) must be split across the two relevant views or expansion tracking silently stops working.
6. **Single owner of expansion state** — no pane offers Collapse All (FR-009d), so the extension remains the sole owner of `_collapsedGroups` and `_expandedMultistateKey`.
7. **Refresh fan-out** — every existing `update*()` entry point must reach the panes that render the affected rows; a collapsed or hidden pane must still be current when reopened (FR-014).
8. **Placeholder ownership** — loading, missing-manifest, invalid-manifest, workflow-blocked, no-options-defined, no-options-available, unavailable-preset, invalid-preset, and not-yet-evaluated rows keep their exact wording and stay in their own pane (FR-011).
9. **Status-bar reveal expands** — the status-bar item must open the container, expand `Build Selection` when collapsed, and focus it (FR-010). The inherited `<viewId>.focus` command already does exactly this.
10. **Consolidated docs** — `specs/product-spec.md` (the `Core Capabilities` tree outline, the `Configuration View Iconography` top-level-section entry, and `Status Bar` → `Interaction`) and `specs/glossary.md` (`Configuration view`) must stop describing one tree containing three section rows.

## Project Structure

### Documentation (this feature)

```text
specs/010-split-configuration-panes/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── view-contributions.md   # Phase 1 output
├── checklists/
│   └── requirements.md  # From /speckit-specify
├── spec.md
└── tasks.md             # Created by /speckit-tasks, not by this command
```

### Source Code (repository root)

```text
package.json                     # contributes.views: 3 entries; view/item/context retargeted
src/
├── extension.ts                 # create 3 TreeViews; route expand/collapse/checkbox events; dispose all 3
├── ui/
│   ├── configuration-tree.ts    # delete SectionItem and getSectionCollapsibleState;
│   │                            # add PaneTreeProvider; expose per-pane root children
│   └── status-bar.ts            # unchanged — the inherited view id keeps the focus command valid
└── test/
    ├── unit/ui/
    │   └── configuration-tree.test.ts        # per-pane composition; no section rows
    └── integration/
        ├── configuration-panes.integration.test.ts   # new: 3 views, order, visibility, menu placement
        ├── configuration-scope.integration.test.ts   # widen the auto-generated view-command filter
        ├── flash-upload-actions.integration.test.ts  # row actions now on the artifacts view
        └── debug-launch-artifacts.integration.test.ts

specs/product-spec.md            # tree outline, iconography, status-bar interaction
specs/glossary.md                # Configuration view definition
```

**Structure Decision**: Single-package VS Code extension, unchanged. The feature touches the presentation layer (`src/ui/`), the activation wiring (`src/extension.ts`), the contribution manifest (`package.json`), and the consolidated product documentation. No new directory, module, or service is introduced.

## Complexity Tracking

No constitution violations. No entries required.
