# Feature Specification: Split Configuration Panes

**Feature Branch**: `010-split-configuration-panes`
**Created**: 2026-08-01
**Status**: Draft
**Input**: User description: "Split the single Trezor Configuration tree view into three sibling views inside the existing `tf-tools` activity-bar container, so that Build Selection, Build Options and Build Artifacts are visually separated by real pane headers and dividers."

**File Reference Rule**: Use workspace-relative paths for any repository file references written into this specification.

## Product Documentation Alignment *(mandatory)*

- **Source Documents**: `specs/product-spec.md`, `specs/glossary.md`
- **Affected Product Areas**: `Core Capabilities` (the Configuration view tree outline, `Build Context Management`, `Build Option Management`, `Workflow Actions`, `Build Artifacts`, `Artifact Row Actions`), `Configuration View Iconography`, `Status Bar` (`Interaction`), and `Command Surface` visibility rules in `specs/product-spec.md`; the `Configuration view`, `Build Selection`, `Build Options`, `Build Artifacts`, `command surface`, and `status bar configuration item` terms in `specs/glossary.md`
- **Scope Guard**: This feature changes only how the three existing Configuration sections are presented as separate panes in the `Trezor` activity-bar container, where the workflow toolbar is attached, and what the status bar item reveals. The toolbar keeps its current membership, order, and enablement, and moves from the container title to the `Build Selection` pane header. It does not change build-option resolution, preset discovery or selection semantics, artifact resolution, IntelliSense behavior, excluded-file decorations, manifest parsing, task execution, persistence of the active configuration, command names, or task labels.
- **Terminology Guard**: `Build Selection`, `Build Options`, and `Build Artifacts` MUST retain their exact capitalization and their existing meaning; they are promoted from tree sections to top-level panes without changing what they contain. The glossary definition of `Configuration view` MUST be updated: it is no longer a single tree view but the set of three sibling panes contributed inside the `Trezor` activity-bar container. `active build context`, `build option`, `option group`, `preset`, `artifact status`, `available action`, `disabled action`, and `hidden action` MUST keep their glossary meanings.
- **Critical Product Details**:
  - The three panes appear in the fixed order `Build Selection`, `Build Artifacts`, `Build Options`.
  - `Build Options` starts collapsed; `Build Selection` and `Build Artifacts` start expanded — the behavior the single tree provides today.
  - Each pane's collapse state is remembered across window reloads, which the single tree does not do today.
  - Every row keeps its current label, icon, description, tooltip, checkbox, and inline row actions.
  - Only one build-context selector is expanded at a time, and that rule is unchanged by the split.
  - Multistate option expansion, option-group collapse, and checkbox toggling continue to drive the same persisted build-option state.
  - Inline artifact row actions (`Flash to Device`, `Upload to Device`, `Open Map File`, `Start Debugging`) stay attached to their artifact rows with unchanged visibility and enablement rules.
  - Every workflow action stays together in one toolbar, and that toolbar sits on the `Build Selection` pane — the topmost pane, directly below the container title. Membership, order, grouping, icons, and enablement are unchanged: `Build` and `Start Debugging` as directly visible icons, and `Build`, `Clippy`, `Check`, `Clean`, `Flash to Device`, `Upload to Device`, `Start Debugging`, and `Refresh IntelliSense` in the overflow menu.
  - The actions are never split across panes. `Build Options` and `Build Artifacts` expose no workflow actions on their headers.
  - The toolbar belongs to `Build Selection` regardless of which pane the user is working in; it does not follow focus and its contents do not change with the focused pane.
  - The host reveals a pane's header actions on hover or focus of that pane and hides them while the pane is collapsed. This is a deliberate, accepted trade against today's always-visible container toolbar, and it is the reason the actions sit on the first pane rather than a lower one.
  - The status bar configuration item still reveals the extension's configuration surface when selected.
  - Loading, missing-manifest, invalid-manifest, workflow-blocked, no-options, unavailable-preset, and not-yet-evaluated placeholder rows keep their current wording and stay inside their own pane.
  - `specs/product-spec.md` and `specs/glossary.md` MUST be updated during implementation so the consolidated documentation no longer describes a single `Configuration` tree containing three section rows.

## Clarifications

### Session 2026-08-01

- Q: Where do the header and overflow workflow actions attach once the single view becomes three panes? → A: All of them stay together in one toolbar on the `Build Selection` pane, the topmost pane. `Build Options` and `Build Artifacts` carry none. Two earlier drafts were superseded: one distributed the actions across pane headers by relevance, the other kept them in a container-level toolbar. The container-level toolbar was ruled out on host grounds, not preference — see `Host Constraint` under `Assumptions`.
- Q: Should the `Build Selection` pane inherit the existing view's identity, or should all three panes be new views? → A: `Build Selection` inherits the existing view's identity and is retitled; `Build Options` and `Build Artifacts` are introduced as new views. The status-bar link, action-visibility rules, and any saved placement of today's view carry over unchanged.
- Q: When the status-bar item is clicked while `Build Selection` is collapsed, should the pane expand? → A: Yes. The click opens the container, expands `Build Selection`, and focuses it, so the selectors and the workflow toolbar are immediately usable whatever state the pane was left in.
- Q: Should any pane offer a Collapse All button in its header? → A: No. No pane offers one, unchanged from today, so the extension remains the single owner of group and multistate expansion state.
- Q: Is losing the always-visible toolbar acceptable? → A: Yes. The host shows a pane's actions on hover or focus and hides them while that pane is collapsed. Placing the toolbar on the topmost pane keeps it as close as possible to its current position.
- Q: In what order should the three panes be declared? → A: `Build Selection` first, then `Build Artifacts`, then `Build Options`. This supersedes the earlier `Build Selection`, `Build Options`, `Build Artifacts` order. The two panes read on every build cycle sit above the one that starts collapsed, and `Build Selection` stays first so it keeps the inherited view id, the whole workflow toolbar, and the status-bar `.focus` target.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read the three configuration areas as separate panes (Priority: P1)

As a firmware developer, I open the `Trezor` activity-bar container and see `Build Selection`, `Build Options`, and `Build Artifacts` as three separate panes with their own headers and dividers, so I can tell at a glance where one area ends and the next begins.

**Why this priority**: Visual separation of the three areas is the entire point of the feature; delivered alone it already gives the user the clearer configuration surface, with every row still rendering exactly as before.

**Independent Test**: Open a supported workspace with a valid manifest, open the `Trezor` container, and verify three headed panes appear in order, each containing exactly the rows its section renders today, with no `Build Selection`, `Build Options`, or `Build Artifacts` row inside any pane's content.

**Acceptance Scenarios**:

1. **Given** a supported workspace with a loaded manifest, **When** the user opens the `Trezor` activity-bar container, **Then** three panes titled `Build Selection`, `Build Artifacts`, and `Build Options` are shown in that order.
2. **Given** the three panes are shown, **When** the user inspects the contents of each pane, **Then** the pane contains the same rows the corresponding section renders today, with identical labels, icons, descriptions, tooltips, and checkboxes.
3. **Given** the three panes are shown, **When** the user looks for the former section rows, **Then** no row labelled `Build Selection`, `Build Options`, or `Build Artifacts` appears inside any pane's content; the pane titles carry those names instead.
4. **Given** the manifest is still loading, is missing, or is invalid, **When** the user views the panes, **Then** each pane shows its current placeholder or warning rows with unchanged wording, and no pane is hidden or emptied because of that state.

---

### User Story 2 - Keep each pane's collapse state (Priority: P2)

As a firmware developer, I collapse the panes I am not using, and my choice survives a window reload, so the configuration surface stays arranged the way I left it.

**Why this priority**: Correct initial collapse state preserves today's behavior and is required for the split to feel like an improvement rather than a reset; persistence across reloads is the added value the pane model brings.

**Independent Test**: Open the container on a fresh profile and verify `Build Options` is collapsed while the other two panes are expanded; then change each pane's collapse state, reload the window, and verify the changed states are restored.

**Acceptance Scenarios**:

1. **Given** the extension is used for the first time in a workspace, **When** the container is opened, **Then** `Build Selection` and `Build Artifacts` are expanded and `Build Options` is collapsed.
2. **Given** the user expands `Build Options` and collapses `Build Artifacts`, **When** the window is reloaded, **Then** `Build Options` is still expanded and `Build Artifacts` is still collapsed.
3. **Given** a pane is collapsed, **When** the underlying state changes (manifest reload, build-context change, preset change, artifact change), **Then** the pane stays collapsed and shows the refreshed content once expanded.
4. **Given** all three panes are collapsed, **When** the user views the container, **Then** the three pane headers remain visible and each can be expanded again.

---

### User Story 3 - Keep every interaction and action working (Priority: P3)

As a firmware developer, I keep using the same selectors, option controls, row actions, workflow toolbar, and status bar shortcut after the split, so nothing I rely on has to be relearned or rediscovered — the action buttons in particular stay together, in their current order, at the top of the panel.

**Why this priority**: The interactions already exist and must not regress, but they are only verifiable once the panes and their contents are in place.

**Independent Test**: With the three panes shown, exercise selector expansion, multistate expansion, group collapse, checkbox toggling, each artifact row action, each toolbar and overflow action, and the status bar item, and verify each behaves as it does today and that the toolbar stays whole on the `Build Selection` header rather than being split across panes.

**Acceptance Scenarios**:

1. **Given** the `Build Selection` pane is expanded, **When** the user expands one selector, **Then** its choices are listed in manifest order, the active choice is marked, and any previously expanded selector collapses.
2. **Given** a choice is listed under an expanded selector, **When** the user selects it, **Then** the active build context or active preset updates and every dependent surface refreshes exactly as it does today.
3. **Given** the `Build Options` pane is expanded, **When** the user toggles a checkbox option, expands a multistate option and selects a state, or collapses and expands an option group, **Then** the resulting stored value, emphasis, and refresh behavior are unchanged from today.
4. **Given** the `Build Artifacts` pane is expanded, **When** the user hovers the `Binary`, `Map File`, and `Executable` rows, **Then** the applicable inline actions appear with the same visibility and enablement rules as today.
5. **Given** the status bar configuration item is visible and `Build Selection` is collapsed, **When** the user selects the item, **Then** the `Trezor` container opens, `Build Selection` expands and takes focus, and its workflow toolbar is available.
6. **Given** the panes are shown, **When** the user looks for the workflow actions currently exposed in the Configuration view header and overflow menu, **Then** every one of those actions is still in the `Build Selection` toolbar with unchanged enablement rules.
7. **Given** the `Build Selection` pane is expanded, **When** the user hovers or focuses it, **Then** `Build` and `Start Debugging` appear as directly visible icons on its header and `Build`, `Clippy`, `Check`, `Clean`, `Flash to Device`, `Upload to Device`, `Start Debugging`, and `Refresh IntelliSense` appear in its overflow menu, in their current order, with `Flash to Device` and `Upload to Device` shown only when applicable to the active build context.
8. **Given** the container is open, **When** the user inspects the `Build Options` and `Build Artifacts` pane headers, **Then** neither exposes any workflow action, and no pane header offers a Collapse All action.
9. **Given** the user works in the `Build Options` or `Build Artifacts` pane, **When** the user hovers the `Build Selection` header, **Then** the toolbar shows the same actions with the same enablement as when `Build Selection` itself has focus.
10. **Given** a workflow action is blocked or inapplicable for the current state, **When** the user opens the toolbar and its overflow menu, **Then** that action is hidden or disabled exactly as it is today.

---

### Edge Cases

- What happens when the user hides `Build Options` or `Build Artifacts` through the container's context menu? The remaining panes keep working, the hidden pane's content is not relocated, and the toolbar keeps its full action set.
- What happens when the user collapses `Build Selection`? The host hides that pane's header actions while it is collapsed. The actions stay reachable from the Command Palette and, for artifact actions, from their artifact rows; expanding the pane brings the toolbar back. No action is lost, and no action is duplicated onto another pane to compensate.
- What happens when the user hides `Build Selection` entirely? The workflow actions are unavailable from the container until the pane is shown again; the Command Palette entries remain the fallback, unchanged from today.
- What happens when a pane other than `Build Selection` has focus? The toolbar shows the same actions with the same enablement; toolbar contents never depend on which pane is focused.
- What happens when the status bar item is selected while `Build Selection` is collapsed? The container opens, the pane expands, and it takes focus, so the selectors and the workflow toolbar become usable in one click.
- What happens when the status bar item is selected while `Build Selection` has been hidden through the container's context menu? The container is still opened and focused rather than doing nothing; the pane must be re-shown from that context menu before its toolbar returns.
- What happens when the manifest is missing or invalid? Every pane stays present and shows its own placeholder or warning rows; no pane collapses itself or disappears.
- What happens when `presets.toml` is unavailable? The `Preset` selector inside `Build Selection` shows the unavailable rows as today, and the workflow actions that are blocked stay blocked with unchanged enablement.
- What happens when no artifact evaluation has run yet? `Build Artifacts` shows its `IntelliSense not yet evaluated` placeholder rather than an empty pane.
- What happens when the workspace is unsupported because no workspace folder is open? The panes are still contributed and do not report a missing data provider.
- What happens to state recorded before the split? `Build Selection` inherits today's view, so its recorded placement and visibility carry over and it is shown expanded. `Build Options` and `Build Artifacts` are new panes with no recorded state, so they open at their specified defaults — collapsed and expanded respectively. No pane appears broken or empty because of inherited state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `Trezor` activity-bar container MUST present three sibling panes titled `Build Selection`, `Build Artifacts`, and `Build Options`, in that order.
- **FR-002**: Each pane MUST render exactly the rows its corresponding section renders today, with identical labels, icons, descriptions, tooltips, checkbox states, and inline row actions.
- **FR-003**: The `Build Selection`, `Build Options`, and `Build Artifacts` rows MUST no longer exist as content rows; those names MUST be carried by the pane titles.
- **FR-004**: On first use, `Build Options` MUST start collapsed and `Build Selection` and `Build Artifacts` MUST start expanded.
- **FR-005**: Each pane's collapse state MUST be remembered across window reloads. This is provided by the editor host rather than by the extension, and no interface exposes a pane's collapse state back to the extension, so restoration MUST be verified by the manual reload check in [quickstart.md](quickstart.md) rather than by an automated test.
- **FR-006**: Expanding one build-context selector MUST continue to collapse any other expanded selector, and only one selector MUST be expanded at a time.
- **FR-007**: Multistate build-option expansion, option-group collapse, and checkbox toggling MUST produce the same stored values, emphasis, and refresh behavior as today.
- **FR-008**: Inline artifact row actions MUST remain attached to their artifact rows with unchanged visibility, enablement, and behavior.
- **FR-009**: Every workflow action currently exposed in the Configuration view header or overflow menu MUST appear in a single toolbar on the `Build Selection` pane, with unchanged membership, order, grouping, icons, and enablement rules.
- **FR-009a**: The `Build Options` and `Build Artifacts` pane headers MUST expose no workflow actions; their headers MUST carry only their title and the host's collapse affordance.
- **FR-009d**: No pane MUST offer a Collapse All action, preserving today's behavior and keeping the extension the single owner of option-group and multistate expansion state.
- **FR-009b**: The toolbar MUST NOT change contents, order, or enablement based on which pane is focused, hovered, or expanded.
- **FR-009c**: The implementation MUST use stable, published contribution points only. It MUST NOT depend on an unreleased editor API proposal to place the toolbar, and MUST NOT change the user's global editor settings to alter when header actions are revealed.
- **FR-010**: Selecting the status bar configuration item MUST open the `Trezor` container, expand the `Build Selection` pane if it is collapsed, and focus it, so its selectors and workflow toolbar are immediately usable.
- **FR-011**: All loading, missing-manifest, invalid-manifest, workflow-blocked, no-options-defined, no-options-available, unavailable-preset, invalid-preset, and not-yet-evaluated placeholder and warning rows MUST keep their current wording and MUST appear inside the pane that owns them.
- **FR-012**: Every pane MUST remain contributed and functional when the workspace is unsupported or the manifest cannot be loaded, without reporting a missing data provider.
- **FR-013**: The split MUST NOT change build-option resolution, preset handling, artifact resolution, IntelliSense refresh, or file decorations in any user-observable way.
- **FR-014**: State updates that previously refreshed one section MUST refresh the corresponding pane, and MUST NOT require the user to reopen or reload the container to see current values.
- **FR-015**: `specs/product-spec.md` and `specs/glossary.md` MUST be updated in the same change so the Configuration view is documented as three sibling panes rather than a single tree with three section rows.
- **FR-017**: The `Build Selection` pane MUST inherit the identity of today's Configuration view, retitled to `Build Selection`; `Build Options` and `Build Artifacts` MUST be introduced as new panes. A user who has relocated today's view MUST find `Build Selection` in that same location after the update, and the status-bar link together with every action-visibility rule that refers to today's view MUST keep working without being repointed.
- **FR-016**: Automated coverage MUST verify pane composition, the declared initial collapse states, per-pane placeholder content, the toolbar's membership on `Build Selection` and the absence of actions on the other two pane headers, the absence of any dependency on unreleased editor APIs or global-setting defaults, and the status bar reveal target. Restoration of collapse state across a reload is out of scope for automated coverage for the reason given in FR-005 and MUST instead be covered by the manual validation pass.

### Key Entities

- **Configuration pane**: One of the three top-level surfaces in the `Trezor` container. Has a fixed title, a fixed position in the container, a default collapse state, a remembered collapse state, and an owned set of rows. Only `Build Selection` owns header actions.
- **Workflow toolbar**: The single action surface holding every workflow action, owned by the `Build Selection` pane. Its membership and enablement do not vary with pane focus or visibility.
- **Pane content set**: The rows a pane renders for the current manifest, active build context, preset state, and artifact state — unchanged in composition from the corresponding section today.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user opening the container sees three visually separated, individually headed areas in the order `Build Selection`, `Build Artifacts`, `Build Options`, with 0 leftover section rows inside them.
- **SC-002**: 100% of the rows rendered today by the three sections are rendered after the split, with unchanged labels, icons, descriptions, tooltips, and checkbox states.
- **SC-003**: 100% of the actions exposed today from the Configuration view header, overflow menu, and artifact rows remain reachable, with unchanged enablement outcomes in every state tested.
- **SC-003a**: All 8 workflow actions appear in one toolbar on the topmost pane, and 0 of them appear on the `Build Options` or `Build Artifacts` headers, in every pane focus, hover, collapse, and visibility combination tested.
- **SC-003b**: With `Build Selection` expanded, a user reaches any workflow action in the same number of interactions as today — 0 for the two visible icons, 1 for the overflow entries.
- **SC-004**: After changing pane collapse states and reloading the window, 3 of 3 panes are restored to the states the user left them in, confirmed by the manual reload check.
- **SC-005**: Selecting the status bar configuration item reveals the build-selection surface in 100% of attempts where the item is visible.
- **SC-006**: No regression is observed in build-option resolution, preset handling, artifact resolution, IntelliSense refresh, or file decorations across the existing automated suites.
- **SC-007**: A user needs at most 1 interaction to reach any of the three areas from the container, because each area is reachable by expanding its own header.

## Assumptions

- The `Trezor` activity-bar container, its icon, and its title are unchanged; its contents are reorganized into three panes and the workflow toolbar moves from the container title to the `Build Selection` pane header.

**Host Constraint (resolved — do not revisit during planning)**: On the supported editor baseline, a view's action toolbar is raised into the container title bar only while the container holds exactly one visible view; with several panes, the host renders actions on each pane header instead, revealed on hover or focus and hidden while the pane is collapsed. The stable, published contribution surface offers no container-level action menu — the container-title menu exists but is gated behind an unreleased API proposal that a shipped extension may not depend on. Built-in editor containers such as Run and Debug, Source Control, and Testing do show action buttons above several panes; they register into that same internal menu directly from workbench code, a path no extension can take. Their appearance is therefore not evidence that the arrangement is reachable here. Checked on 2026-08-01 against the installed host, the newest released host, and the upstream development branch: the single-view merge rule and the proposal gate are identical in all three, and the proposal has not changed since it was introduced two years earlier, so no newer editor version removes this constraint.

Making the toolbar's pane non-collapsible is not available either: the host marks a pane non-collapsible only when it is the sole pane in its container, and forces every pane collapsible as soon as a container holds more than one — re-applying that whenever panes are added, removed, or relocated. The view contribution schema exposes no collapsibility control, and its initial-state option stops being honored once the user has collapsed, moved, or hidden the view. So a user can always collapse `Build Selection` and temporarily lose the toolbar; the spec accepts this rather than duplicating actions onto a second pane to compensate.

Keeping a container-level toolbar was therefore not available. The chosen resolution is the closest reachable arrangement: all actions stay together, on the topmost pane, so they remain in roughly their current screen position and in their current order. The cost — actions revealed on hover or focus, and hidden while `Build Selection` is collapsed — is accepted and specified above rather than worked around. Two workarounds were considered and rejected: depending on the unreleased proposal, which cannot be published and fails silently without a launch flag; and shipping a default for the host's global always-show-header-actions setting, which would change the appearance of every other view in the user's editor.

- The editor host, not the extension, owns pane reordering by drag, per-pane visibility toggles, and collapse-state persistence, so the extension only declares the initial order and initial collapse states.
- Reordering or hiding panes through the container's context menu is a host-provided capability that this feature neither adds nor suppresses.
- The status bar reveals `Build Selection` because that is the surface the status bar summarizes; revealing it also opens the container, which brings the other two panes into view.
- Row-level state the extension tracks itself today — which selector is expanded, which multistate option is expanded, which option groups are collapsed — keeps its current in-memory, non-persisted lifetime; only pane collapse state is newly persisted.
- No welcome content, empty-state message, or pane badge is introduced; the existing placeholder rows continue to serve that role.
- Pane heights are left to the host's default distribution, and a pane dragged out of the container identifies itself by the container name, as the host does by default. Neither is specified further because neither changes what the user can do.
- Pane titles use the existing section names verbatim, so no new user-facing terminology is introduced.
- Integration-level verification runs against the editor host, and the unit suites cover pane composition and row identity independently.
