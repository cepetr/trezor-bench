# Quickstart: Validating Split Configuration Panes

**Feature**: `specs/010-split-configuration-panes/` | **Date**: 2026-08-01

How to prove the feature works. Automated gates first, then the manual checks that cover what only a running editor can show.

## Prerequisites

- The repository checked out on `010-split-configuration-panes`
- `npm install` completed
- A `trezor-firmware` workspace with a valid `tf-tools.yaml`, a `presets.toml`, and at least one build option group and one multistate option, for the manual pass
- For the integration suite: a normal workstation session. `npm test` and `npm run smoke:package` cannot run in the restricted sandbox, so a green unit run alone does not close out this feature

## Automated gates

```bash
npm run lint
npm run compile
npm run test:unit
npm test            # integration; workstation only
```

Expected: all four pass. Run the first three after every task; run `npm test` before calling the feature done.

## Automated coverage this feature must add

Per FR-016, and expected to fail before implementation:

| Layer | Assertion |
|---|---|
| Unit | Each pane's root rows match today's section content, for loaded, loading, missing, invalid, workflow-blocked, no-options, and not-yet-evaluated states |
| Unit | No pane's rows include a `Build Selection`, `Build Options`, or `Build Artifacts` row, and `SectionItem` no longer exists |
| Unit | Selector expansion, multistate expansion, group collapse, and checkbox state produce the same rows as before the split |
| Integration | Exactly three views are contributed for `tf-tools`, in order, with the titles and `visibility` values in [contracts/view-contributions.md](contracts/view-contributions.md) |
| Integration | Entry 1 reuses the inherited view id; the status-bar command still matches `<that id>.focus` |
| Integration | All ten `view/title` entries target the inherited id; none targets the other two views |
| Integration | All four `view/item/context` entries target the `Build Artifacts` view id and keep their `viewItem`, group, and enablement |
| Integration | No view declares Collapse All |
| Integration | The registered-command scope guard passes with the two new view ids present |

## Manual validation

Launch the Extension Development Host (F5) against a real firmware workspace.

### Pane layout — US1

1. Open the `Trezor` container. **Expect**: three headed panes, `Build Selection` / `Build Options` / `Build Artifacts`, in that order, separated by real dividers.
2. Inspect each pane. **Expect**: the same rows as before the split, with identical labels, icons, descriptions, tooltips, and checkboxes; no section row anywhere inside a pane.
3. Point the manifest path at a missing file, then at an invalid one. **Expect**: each pane shows its own placeholder or warning rows with unchanged wording; no pane disappears or empties.

### Collapse state — US2

4. On a fresh profile: **expect** `Build Options` collapsed, the other two expanded.
5. Expand `Build Options`, collapse `Build Artifacts`, reload the window. **Expect**: both states restored.
6. Collapse a pane, change the active build context, expand it again. **Expect**: current content, no stale rows.

### Interactions and toolbar — US3

7. Expand each selector in turn. **Expect**: manifest-ordered choices, the active one marked, and the previously expanded selector collapsing.
8. Toggle a checkbox option, expand a multistate option and pick a state, collapse and expand an option group. **Expect**: stored values, emphasis, and refreshes unchanged from today.
9. Hover `Binary`, `Map File`, `Executable`. **Expect**: the applicable inline actions with today's visibility and enablement.
10. Hover the `Build Selection` header. **Expect**: `Build` and `Start Debugging` as icons, and the full eight-action overflow menu in today's order.
11. Hover the `Build Options` and `Build Artifacts` headers. **Expect**: no workflow actions and no Collapse All.
12. Work inside `Build Options`, then hover the `Build Selection` header. **Expect**: the same actions with the same enablement.

### Status bar and edge cases

13. Collapse `Build Selection`, then click the status-bar item. **Expect**: the container opens, the pane expands and takes focus, and its toolbar is available.
14. Hide `Build Artifacts` from the container context menu. **Expect**: the other panes keep working; the toolbar keeps all eight actions.
15. Open a workspace with no `presets.toml`. **Expect**: the `Preset` selector shows the unavailable rows, and `Build`, `Clippy`, `Check` stay blocked with unchanged enablement.
16. Open VS Code with no workspace folder. **Expect**: all three panes present, no "no data provider registered" error.

### Upgrade path

17. Install the previous build, move the Configuration view to the secondary sidebar, then install this build. **Expect**: `Build Selection` appears in that same location, and the two new panes appear at their declared defaults.

## Documentation check

18. `specs/product-spec.md` and `specs/glossary.md` no longer describe a single `Configuration` tree containing three section rows (FR-015). Confirm the `Core Capabilities` tree outline, the `Configuration View Iconography` top-level-section entry, the `Status Bar` → `Interaction` paragraph, and the glossary's `Configuration view` definition.
