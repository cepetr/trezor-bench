---

description: "Task list for Split Configuration Panes"
---

# Tasks: Split Configuration Panes

**Input**: Design documents from `specs/010-split-configuration-panes/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/view-contributions.md](contracts/view-contributions.md), [quickstart.md](quickstart.md)

**Tests**: Test tasks are **mandatory** here. Constitution principle III requires automated tests for every functional change, integration-level coverage for VS Code integration, persisted state, and command visibility, and the Delivery Workflow requires tests to be scheduled before implementation for every user story. FR-016 states the same requirement in the spec.

**Organization**: Tasks are grouped by user story so each story is an independently verifiable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task belongs to (US1, US2, US3)
- Every task names the exact file it touches

## Path Conventions

Single-package VS Code extension: sources in `src/`, tests in `src/test/unit/` and `src/test/integration/`, contribution manifest in `package.json`, consolidated docs in `specs/`.

## Execution Rules (from the constitution)

- Complete exactly one task at a time; verify it, tick it here, then commit.
- One task per commit. Commit subjects start with the task id and a colon, e.g. `T003: add per-pane root builders`. Contiguous approved exceptions use `T003-T005:`.
- Test-only tasks are expected to fail the suite when committed — that is the point of scheduling them first.
- Before ticking a task, self-review the change against [spec.md](spec.md), `specs/product-spec.md`, and `specs/glossary.md`.
- `npm test` and `npm run smoke:package` cannot run in the restricted sandbox. `npm run lint`, `npm run compile`, and `npm run test:unit` are the local gates; T025 is the mandatory workstation run.

---

## Phase 1: Setup

**Purpose**: Establish the reference the "identical rows" requirements are checked against

- [X] T001 Record the pre-change row inventory for all three sections — labels, icons, descriptions, tooltips, checkbox states, and `contextValue`s, for loaded / loading / missing / invalid / workflow-blocked / no-options / not-yet-evaluated states — in `specs/010-split-configuration-panes/checklists/row-inventory.md`, derived from `src/ui/configuration-tree.ts` and the current `src/test/unit/ui/configuration-tree.test.ts` expectations

**Checkpoint**: The FR-002 and SC-002 reference exists before any row-rendering code is touched

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Provider-side model that all three stories build on — per-pane root children, the facade, and per-pane refresh

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Add unit tests for per-pane root children and per-pane refresh signals — `paneRootChildren("build-selection" | "build-options" | "build-artifacts")` returns today's section content for each manifest, preset, and artifact state, and each `update*()` entry point signals the panes whose rows it affects — in `src/test/unit/ui/configuration-tree.test.ts`
- [X] T003 Rename `SectionId` to `PaneId` and add the per-pane root builders plus a per-pane change signal to `ConfigurationTreeProvider` in `src/ui/configuration-tree.ts`, keeping `SectionItem` in place for now so existing callers still compile
- [X] T004 Add unit tests for the `PaneTreeProvider` facade — root delegation per `PaneId`, non-root delegation to the owner's element dispatch, `getTreeItem` identity, and change-event relay — in `src/test/unit/ui/configuration-tree.test.ts`
- [X] T005 Implement the `PaneTreeProvider` facade in `src/ui/configuration-tree.ts` per [data-model.md](data-model.md) (holds no state; constructed with the owner and a `PaneId`)

**Checkpoint**: Three pane providers can be constructed and render correct content; nothing is wired to the editor yet

---

## Phase 3: User Story 1 - Read the three configuration areas as separate panes (Priority: P1) 🎯 MVP

**Goal**: The `Trezor` container shows `Build Selection`, `Build Options`, `Build Artifacts` as three headed panes containing exactly today's rows, with the section rows gone

**Independent Test**: Open a supported workspace with a valid manifest, open the `Trezor` container, and verify three headed panes appear in order, each containing exactly the rows its section renders today, with no section row inside any pane's content

### Tests for User Story 1

- [X] T006 [P] [US1] Add integration tests asserting exactly three views are contributed for the `tf-tools` container, in the declared order, with the titles, `type`, and `icon` from [contracts/view-contributions.md](contracts/view-contributions.md), and that entry 1 reuses the inherited view id, in new `src/test/integration/configuration-panes.integration.test.ts`. Do **not** assert `visibility` here — that belongs to T012, so this test stays green between US1 and US2
- [X] T006a [P] [US1] Add integration assertions that `package.json` declares no `enabledApiProposals`, contributes no `viewContainer/title` menu, and contributes no `configurationDefaults` entry, in `src/test/integration/configuration-panes.integration.test.ts` (FR-009c — the guardrail behind the whole host-constraint decision)
- [X] T007 [P] [US1] Add unit tests asserting no pane's rows contain a `Build Selection`, `Build Options`, or `Build Artifacts` row and that each pane's rows match the T001 inventory in every manifest state, in `src/test/unit/ui/configuration-tree.test.ts`

### Implementation for User Story 1

- [X] T008 [US1] Add the three view entries to `contributes.views["tf-tools"]` in `package.json` — inherited id retitled `Build Selection`, plus new `Build Options` and `Build Artifacts` ids — per [contracts/view-contributions.md](contracts/view-contributions.md) §2
- [X] T009 [US1] Delete `SectionItem` and `getSectionCollapsibleState()` and make `getChildren(undefined)` unreachable for pane roots in `src/ui/configuration-tree.ts`
- [X] T010 [US1] Create the three `TreeView`s with their pane providers, register them in `context.subscriptions`, and dispose all three in `deactivate()`, in `src/extension.ts`
- [X] T011 [US1] Migrate the remaining `SectionItem` call sites to the per-pane root builders in `src/test/unit/ui/configuration-tree.test.ts`, `src/test/integration/debug-launch-artifacts.integration.test.ts`, and `src/test/integration/build-context-selection.integration.test.ts`

**Checkpoint**: Three panes render today's content; US1 is independently demonstrable

---

## Phase 4: User Story 2 - Keep each pane's collapse state (Priority: P2)

**Goal**: `Build Options` starts collapsed and the other two expanded, and the editor remembers each pane's state across reloads

**Independent Test**: On a fresh profile, `Build Options` is collapsed and the other two expanded; after changing each pane's state and reloading the window, the changed states are restored

### Tests for User Story 2

- [X] T012 [US2] Add integration tests asserting `Build Options` declares `visibility: collapsed`, the other two omit `visibility`, and no view enables Collapse All, in `src/test/integration/configuration-panes.integration.test.ts` — this task owns every `visibility` assertion; T006 deliberately leaves it alone

### Implementation for User Story 2

- [X] T013 [US2] Set `"visibility": "collapsed"` on the `Build Options` view entry in `package.json`, leaving the other two at the `visible` default
- [X] T014 [US2] Keep `showCollapseAll: false` on all three `TreeView` creations in `src/extension.ts`, so the extension stays the only owner of option-group and multistate expansion state (FR-009d)

**Checkpoint**: Initial states match today's behavior and the host persists user changes

---

## Phase 5: User Story 3 - Keep every interaction and action working (Priority: P3)

**Goal**: Selectors, option controls, artifact row actions, the workflow toolbar, and the status-bar shortcut all behave as they do today, with the whole toolbar on `Build Selection`

**Independent Test**: With the three panes shown, exercise selector expansion, multistate expansion, group collapse, checkbox toggling, every artifact row action, every toolbar and overflow action, and the status-bar item, and verify each behaves as it does today

### Tests for User Story 3

- [X] T015 [P] [US3] Add integration tests asserting all ten `view/title` entries target the inherited view id with unchanged command, group, and enablement, that no `view/title` entry targets the other two views, and that the status-bar command still equals `<inherited view id>.focus`, in `src/test/integration/configuration-panes.integration.test.ts`
- [X] T016 [P] [US3] Add integration tests asserting all four `view/item/context` entries target the `Build Artifacts` view id and keep their `viewItem`, group, and enablement, in `src/test/integration/configuration-panes.integration.test.ts`
- [X] T017 [P] [US3] Add unit tests asserting selector expansion collapses the previously expanded selector, and that multistate expansion, option-group collapse, and checkbox toggling produce unchanged rows and stored values when driven through the pane providers, in `src/test/unit/ui/configuration-tree.test.ts`

### Implementation for User Story 3

- [X] T018 [US3] Retarget the four `view/item/context` entries from the inherited view id to the `Build Artifacts` view id in `package.json`, leaving `viewItem`, group, enablement, and additional `when` clauses unchanged
- [X] T019 [US3] Split the `onDidExpandElement`, `onDidCollapseElement`, and `onDidChangeCheckboxState` handlers across the `Build Selection` view (selector rows) and the `Build Options` view (multistate, option-group, checkbox rows) in `src/extension.ts`, replacing the single-view registration at lines 533-568
- [X] T020 [US3] Widen the auto-generated view-command filter to cover all three view ids in `src/test/integration/configuration-scope.integration.test.ts`, so the new `*.focus` and `*.resetViewLocation` commands are not reported as unauthorized

**Checkpoint**: All three stories are independently functional; no interaction or action has regressed

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T021 [P] Update `specs/product-spec.md` so the `Core Capabilities` tree outline shows three sibling panes rather than one `Configuration` tree with section rows, the `Configuration View Iconography` top-level-section entry describes pane titles, and `Status Bar` → `Interaction` states that selecting the item opens the container, expands `Build Selection`, and focuses it (FR-015)
- [X] T022 [P] Update the `Configuration view` definition in `specs/glossary.md` to the set of three sibling panes in the `Trezor` container, keeping `Build Selection`, `Build Options`, and `Build Artifacts` as the pane names (FR-015)
- [X] T023 Run `npm run lint`, `npm run compile`, and `npm run test:unit` and fix any failure
- [X] T024 Verify no residual references to `SectionItem`, `SectionId`, `getSectionCollapsibleState`, or `section:` item ids remain in `src/`
- [ ] T025 Run `npm test` on a workstation outside the restricted sandbox and record the result; the feature is not done while this is unverified (constitution principle III)
- [ ] T026 Execute the manual validation pass in [quickstart.md](quickstart.md), including the upgrade-path check that a relocated view reappears as `Build Selection` in its saved location
- [X] T027 Self-review the full diff against [spec.md](spec.md), `specs/product-spec.md`, and `specs/glossary.md`, confirming FR-001 through FR-017 are implemented as specified rather than approximated

---

## Phase 7: Pane Reorder (change request, 2026-08-01)

**Purpose**: The declared pane order becomes `Build Selection`, `Build Artifacts`, `Build Options` — the two panes a user reads on every build cycle sit above the pane that starts collapsed. `Build Selection` stays first, so the inherited view id, the whole `view/title` toolbar, and the status-bar `.focus` target are all untouched (FR-009, FR-010, FR-017).

**Independent Test**: Open the `Trezor` container on a fresh profile and verify the panes appear top-to-bottom as `Build Selection`, `Build Artifacts`, `Build Options`, with `Build Options` still collapsed and the other two expanded.

- [X] T028 Record the reorder decision and update every order statement in [spec.md](spec.md) — the `Clarifications` session, the `Behavior Contract` fixed-order bullet, FR-001, and SC-001 — to `Build Selection`, `Build Artifacts`, `Build Options`
- [ ] T029 Swap rows 2 and 3 of the §2 view table in [contracts/view-contributions.md](contracts/view-contributions.md) so the contract's array order matches FR-001, leaving `visibility: collapsed` attached to `Build Options`
- [ ] T030 Update the pane-order assertion in `src/test/integration/configuration-panes.integration.test.ts` to the new order, and retarget the "entry 2 / entry 3" id assertions accordingly — test before implementation, so this fails against the current manifest
- [ ] T031 Move the `tfTools.buildArtifacts` entry ahead of `tfTools.buildOptions` in `contributes.views["tf-tools"]` in `package.json`, changing nothing else about either entry
- [ ] T032 [P] Align the three `createTreeView` calls and their `context.subscriptions` order in `src/extension.ts` with the declared pane order, so the source reads in pane order (no behavior change — `package.json` array order is what the host renders)
- [ ] T033 [P] Update the pane-order statements in [plan.md](plan.md) §Pane order and initial state, [data-model.md](data-model.md) (`Title` and `Position` rows, pane-content table order), and [quickstart.md](quickstart.md) step 1
- [ ] T034 [P] Update `specs/product-spec.md` — the `Core Capabilities` tree outline and the pane enumerations in the intro and `Configuration View Iconography` — and the `Configuration view` definition in `specs/glossary.md`, to the new pane order (FR-015)
- [ ] T035 Run `npm run lint`, `npm run compile`, and `npm run test:unit` and fix any failure

**Checkpoint**: The container renders `Build Selection`, `Build Artifacts`, `Build Options`; the toolbar, artifact row actions, status-bar target, and initial collapse states are unchanged

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on T001 — blocks all user stories
- **US1 (Phase 3)**: depends on Phase 2
- **US2 (Phase 4)**: depends on US1 — the view entries must exist before their initial state can be declared
- **US3 (Phase 5)**: depends on US1 — the views must exist before menus can be retargeted and events routed. Independent of US2
- **Polish (Phase 6)**: depends on all three stories

### Within Each Story

- Tests are written first and must fail before the matching implementation task
- `package.json` contribution changes before the `src/extension.ts` wiring that depends on them
- Provider changes before the tests that exercise them through the editor

### Parallel Opportunities

- T006, T006a, and T007 can be written in parallel; T006 and T006a share `configuration-panes.integration.test.ts`, so sequence them if one person writes both
- T015, T016, and T017 can be written in parallel; T015 and T016 both land in `configuration-panes.integration.test.ts`, so if one person writes both, sequence them
- T021 and T022 are different documents and can run in parallel
- US2 and US3 can proceed in parallel once US1 is complete

### Sequential Constraints Worth Naming

- T009 breaks every `SectionItem` call site, so T011 must land with or immediately after it — do not leave the suite uncompilable across more than one commit
- T019 must land with T010; three views without split event handlers means expansion tracking silently stops working

---

## Parallel Example: User Story 1

```bash
# Two test tasks, different files, no shared state:
Task: "T006 Integration tests for the three view contributions in src/test/integration/configuration-panes.integration.test.ts"
Task: "T007 Unit tests for per-pane rows and absent section rows in src/test/unit/ui/configuration-tree.test.ts"
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 → Phase 2 → Phase 3
2. **Stop and validate**: three headed panes, today's rows, no section rows
3. At this point the feature is demonstrable; the toolbar still works because the inherited view id keeps every `view/title` entry bound to `Build Selection`

### Incremental Delivery

1. Setup + Foundational → providers ready
2. US1 → three panes render (MVP)
3. US2 → correct initial states, host-persisted collapse
4. US3 → row actions retargeted, event routing split, scope guard widened
5. Polish → consolidated docs, gates, workstation integration run, manual pass

---

## Notes

- Total: 28 tasks — Setup 1, Foundational 4, US1 7, US2 3, US3 6, Polish 7
- The riskiest task is T019: each `TreeView` emits events only for its own rows, so an incomplete split leaves selector or option expansion silently dead. Exercise both panes manually after it
- No task introduces a new dependency, service, or persisted state
- **T011 scope correction**: research.md's R7 inventory and this task's file list both undercounted the `SectionItem`/`SectionId` call sites T009 breaks. Three more real files needed migration beyond the three named here: `src/test/integration/configuration-health.integration.test.ts`, `src/test/integration/preset-selection.integration.test.ts`, and `src/test/integration/preset-build-options.integration.test.ts`. All six were migrated together when T011 landed.
- **T025/T026 status**: this implementation ran in a sandboxed environment with no network access and an incompatible bundled VS Code binary (`bad option: --disable-extensions` etc. from `.vscode-test`), consistent with the environment's standing constraint that `npm test` and `npm run smoke:package` cannot run here (confirmed research.md R8). `npm run lint`, `npm run compile`, and `npm run test:unit` all pass (0 errors, 867/867 unit tests).
- **T025 workstation run (round 1)**: 449 passing, 1 failing — `configuration-panes.integration.test.ts`'s "matches the contract's command/group/enablement table exactly, in order" test (view/title). Root cause: `assert.deepStrictEqual` treats an object key present with value `undefined` as different from the key being absent; the test's `actual` mapper always set `enablement` (even to `undefined` for `tfTools.refreshIntelliSense`, which has none), while `expected`'s last entry omitted the key. This was a test-authoring bug, not an implementation defect — the underlying `package.json` contribution was already correct. Fixed by only including `enablement` in `actual` when the real entry has one. Verified by simulating the corrected comparison against the real `package.json` with `node -e`. T025 and T026 remain **unchecked** pending a clean re-run on a workstation — per constitution principle III, the feature is not done until both pass there.
