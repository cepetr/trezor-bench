# Phase 0 Research: Split Configuration Panes

**Feature**: `specs/010-split-configuration-panes/` | **Date**: 2026-08-01

All questions this design depends on are resolved. Host behavior was verified on 2026-08-01 against the installed VS Code 1.130.0 bundle and against `microsoft/vscode` at tag `1.131.0` and on `main`; no unknown remains for `/speckit-tasks`.

## R1. Where can the workflow toolbar live once the container holds three panes?

**Decision**: On the `Build Selection` pane header, holding the entire action set in its current order.

**Rationale**: A view's toolbar is raised into the container title bar only while `ViewPaneContainer.isViewMergedWithContainer()` holds, which requires `mergeViewWithContainerWhenSingleView && paneItems.length === 1`. With three panes the host renders actions on each pane header instead. The container-level menu exists as `MenuId.ViewContainerTitle`, but the extension-facing key `viewContainer/title` is gated by `proposed: 'contribViewContainerTitle'`, enforced by `if (menu.proposed && !isProposedApiEnabled(...))`. The proposal has had a single commit since 2024-07-31, no extension in the local install set uses it, and none of the 64 extensions allowlisted in `product.json` is granted it. Placing the whole toolbar on the topmost pane is the closest reachable arrangement.

**Alternatives considered**:
- *Container-level toolbar via the proposal* — rejected: cannot be published, and silently degrades without a launch flag.
- *Actions distributed across pane headers by relevance* — rejected by the product decision recorded in the spec's Clarifications.
- *Ship a default for the host's global always-show-header-actions setting* — rejected: it would change every other view in the user's editor.
- *Keep one view and simulate dividers with blank rows* — rejected: it does not deliver real headers, host-owned collapse persistence, or removal of the section rows.

## R2. Can the pane holding the toolbar be made non-collapsible?

**Decision**: No. The spec accepts that collapsing `Build Selection` hides its toolbar.

**Rationale**: `updateViewHeaders()` sets `collapsible = false` only when `paneItems.length === 1`, and forces `collapsible = true` on every pane otherwise, re-applying on pane add, remove, and activity-bar relocation. The `contributes.views` schema exposes no collapsibility control.

**Alternatives considered**: *Duplicate the two icons onto a second pane* — rejected: it splits the action set for a case the default expanded state already makes rare.

## R3. How should the three panes be backed by providers?

**Decision**: Keep `ConfigurationTreeProvider` as the single state owner and add one small `PaneTreeProvider` facade class, instantiated three times with a `PaneId`. Each instance implements `TreeDataProvider<TreeItem>`, delegates `getChildren(undefined)` to the owner's per-pane root builder, delegates every non-root `getChildren(element)` to the owner's existing element dispatch, and relays the owner's change event.

**Rationale**: The three panes read one shared state set — manifest, active configuration, resolved options, preset state, four artifact states. Splitting that state across three providers would duplicate every `update*()` entry point and risk the panes disagreeing. One owner plus a thin facade satisfies constitution principle V and deletes more code than it adds, since `SectionItem` and `getSectionCollapsibleState()` go away.

**Alternatives considered**:
- *Three independent providers each owning a state slice* — rejected: duplicates ~10 update entry points and multiplies the chance of stale panes.
- *One provider registered against three views* — rejected: `getChildren(undefined)` could not tell which pane is asking.

## R4. How does a state change reach three views?

**Decision**: The owner exposes a per-pane refresh signal; each facade relays it to its own `onDidChangeTreeData`. Existing `update*()` methods keep their current signatures and fan out to the panes whose rows they affect: `update()` and `updatePresets()` reach `Build Selection` and `Build Options`; the four artifact updaters reach `Build Artifacts`.

**Rationale**: Preserves FR-014 (no reopen needed) while avoiding the pointless full refresh of unrelated panes. A collapsed or hidden pane still receives the event and renders current data when reopened.

**Alternatives considered**: *Broadcast every change to all three panes* — acceptable and simpler, but it re-renders panes that provably cannot have changed; the per-pane signal costs one map lookup.

## R5. Should `Build Selection` reuse the existing view id?

**Decision**: Yes — `Build Selection` inherits it and is retitled; `Build Options` and `Build Artifacts` are new ids.

**Rationale**: Recorded as a product decision in the spec's Clarifications and captured as FR-017. Concretely it preserves three things at zero cost: the status-bar command `tfTools.configuration.focus`, the ten `view/title` `when` clauses, and any saved placement for users who moved the view out of the sidebar.

**Consequence to handle**: the two new view ids produce new auto-generated `*.focus` and `*.resetViewLocation` commands. The scope-guard integration test filters only `tfTools.configuration.*` today and must be widened, or it will report the new commands as unauthorized.

**Alternatives considered**: *Three fresh ids* — rejected: repoints every `when` clause and the status-bar command, and discards saved placement for no user benefit.

## R6. How is the initial collapse state declared?

**Decision**: `Build Options` declares `visibility: collapsed`; the other two omit `visibility` and take the `visible` default.

**Rationale**: The contribution schema accepts `visible`, `hidden`, and `collapsed`, and this reproduces today's `getSectionCollapsibleState()` behavior exactly. The schema documents that the value is an *initial* state, honored until the user first collapses, moves, or hides the view — which is precisely FR-004 ("on first use") plus FR-005 (the host then remembers the user's choice).

**Alternatives considered**: *Force the state on every activation* — rejected: it would fight the user and violate FR-005.

## R7. What breaks in the existing test suite?

**Decision**: Treat these as known, enumerated edits rather than discoveries during implementation.

| Location | Why it changes |
|---|---|
| `src/test/unit/ui/configuration-tree.test.ts` | Constructs `SectionItem` in ~10 places, including the icon and default-collapsible-state suites, and calls `getChildren(new SectionItem(...))` to reach section content. Must move to per-pane root builders. |
| `src/test/integration/debug-launch-artifacts.integration.test.ts` | Same `getChildren(new SectionItem(...))` pattern for artifact rows. |
| `src/test/integration/build-context-selection.integration.test.ts` | Imports `SectionItem`. |
| `src/test/integration/configuration-scope.integration.test.ts` | View-command prefix filter, per R5. |
| `src/test/integration/flash-upload-actions.integration.test.ts`, `debug-launch.integration.test.ts` | Assert `view == tfTools.configuration` for `view/title` entries — these stay valid because the id is inherited. Their `view/item/context` assertions match on `contextValue`, not view id, so retargeting the artifact rows does not break them. |

**Note for the task list**: the four `view/item/context` entries must be retargeted even though no test currently pins their view id — the new `configuration-panes` integration test should pin it.

## R8. Can the changed behavior be verified in this environment?

**Decision**: Author both layers; run unit, lint, and compile here; require the integration suite to be run on a normal workstation before the feature is called done.

**Rationale**: `npm test` and `npm run smoke:package` cannot run in the current sandbox for environment reasons, so `npm run test:unit`, `npm run lint`, and `npm run compile` are the gates available locally. Constitution principle III still requires the integration-level coverage to exist and pass, so the task list must carry an explicit run-on-workstation verification task rather than treating a green unit run as sufficient.
