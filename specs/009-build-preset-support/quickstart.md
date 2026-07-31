# Quickstart Validation: Build Preset Support

**Branch**: `009-build-preset-support` | **Date**: 2026-07-31 | **Spec**: `specs/009-build-preset-support/spec.md`

**File Reference Rule**: Use workspace-relative paths for any repository file references written into this document.

This guide lists the runnable checks that prove the feature works end to end. Contract details live in `specs/009-build-preset-support/contracts/`; entity shapes live in `specs/009-build-preset-support/data-model.md`. It is a validation guide — it contains no implementation code.

## Prerequisites

- Node.js 22+ and the repository dependencies installed (`npm install`). `smol-toml` must be present as a `dependencies` entry.
- VS Code 1.105 or newer for the manual checks; the integration harness downloads its own build.
- A single-root workspace. Multi-root workspaces and empty windows are out of scope.

## Commands

```sh
npm run lint                 # eslint over src
npm run compile              # tsc -p ./ into out/
npm run test:unit            # mocha over out/test/unit/**/*.test.js
npm test                     # VS Code integration harness (runs npm run compile first)
npm run test:coverage        # unit coverage report into coverage/
npm run smoke:package        # vsce package + packaged-artifact smoke check
```

`npm run lint`, `npm run test:unit`, and `npm test` must all pass before the feature is considered complete.

## Fixtures to add

Under `test-fixtures/workspaces/`, mirroring the existing fixture-workspace convention (each carries `tf-tools-manifest.yaml` plus `.vscode/settings.json`). Preset files sit at `xtask/tf-tools/` relative to the resolved cargo workspace path; leaving `tfTools.cargoWorkspacePath` unset resolves that to the fixture root.

| Fixture | Contents | Exercises |
| --- | --- | --- |
| `preset-valid/` | manifest with checkbox + multistate options, `xtask/tf-tools/presets.toml` with `[[defaults]]`, `[[test]]`, and a context-restricted `[[dev]]`, plus `xtask/tf-tools/user-presets.toml` adding a local preset and re-declaring `test` | US1, US2, US3 |
| `preset-no-defaults/` | `presets.toml` with named presets but no `[[defaults]]` fragment | Acceptance Scenario 1.2 |
| `preset-missing-shared/` | `user-presets.toml` only, no `presets.toml` | FR-027 |
| `preset-malformed-shared/` | `presets.toml` with a TOML syntax error | FR-028 |
| `preset-invalid-user/` | valid `presets.toml`, `user-presets.toml` with an unknown `when` field | FR-030 |
| `preset-value-mismatch/` | `presets.toml` setting a multistate option to a value no manifest state declares | option-level mismatch failure mode |

## Scenario checks

### US1 — Select an available preset

1. Open `test-fixtures/workspaces/preset-valid/` and reveal the `Trezor` → `Configuration` view.
2. Confirm `Build Selection` shows four selectors in order: `Model`, `Target`, `Component`, `Presets`.
3. Expand `Presets`. **Expected**: `Default` first, then each named preset from `presets.toml` followed by user-only presets, each listed once, filtered to those with a fragment matching the active model/component/target.
4. Select a named preset. **Expected**: the `Presets` description and the `check` marker update immediately.
5. Reload the window. **Expected**: the same preset is still active — it was saved into the same workspace-state record as model, target, and component.
6. Change `Component` to one no fragment of the active preset matches. **Expected**: the active preset normalizes to `Default`.
7. Confirm the status bar item, `Build`/`Clippy`/`Check` task labels, and command names contain no preset name.
8. Open `test-fixtures/workspaces/preset-no-defaults/` and expand `Presets`. **Expected**: `Default` is still offered.

### US2 — Adjust preset-relative options

1. In `preset-valid/`, expand `Build Options` with `Default` active. **Expected**: each option shows the value calculated from the matching `[[defaults]]` fragments; nothing is emphasized.
2. Switch to a named preset that changes an option. **Expected**: that option's displayed value changes without any stored selection being written.
3. Toggle a checkbox away from its preset-effective value. **Expected**: the row is emphasized and its group header is emphasized when collapsed.
4. Toggle it back to match the preset-effective value. **Expected**: emphasis clears.
5. With that override still in place, switch to any other preset. **Expected**: the override is discarded — every option shows the new preset's calculated value and no row is emphasized. Switching back does not resurrect the override.
6. On a multistate option with no manifest-authored default, with no stored selection. **Expected**: the active state is the one inferred from the preset-effective value.
7. Select that multistate option's `Default` (null-valued) state. **Expected**: the override is cleared and the row follows the preset again.
8. Open `preset-value-mismatch/`. **Expected**: the affected option row reports the unrepresentable value, a diagnostic appears in the Problems view against `presets.toml`, and `Build`, `Clippy`, and `Check` are disabled while `Clean` stays enabled.
9. Regression for the reported defect: in a workspace whose `tfTools.buildOptions` was written before this feature (a checkbox stored `false` that a `[[defaults]]` fragment sets to `true`), confirm the row is unchecked and emphasized on load, then switch preset once. **Expected**: the stale selection is discarded, the row follows the `[[defaults]]` value, and the `Trezor Firmware Tools` channel records which overrides were dropped.

### US3 — Run preset-aware workflows

Inspect the launched command through `vscode.tasks.fetchTasks({ type: "tfTools" })` and the task's `ProcessExecution.args`, as the existing `src/test/integration/task-provider.integration.test.ts` does.

1. `Default` active, no differing overrides → args contain neither `-p` nor any option flag.
2. Named preset active → args contain exactly one `-p <name>` pair, positioned after the target flag.
3. Mixed selections → only the differing values produce flags; equal values produce none.
4. A checkbox turned off against a preset-effective `true` → `<flag>=false` appears.
5. User fragments overriding shared fragments for the same preset → comparison uses the user-adjusted value.
6. `Clean`, `Flash to Device`, `Upload to Device`, and `Start Debugging` → argument lists identical to the pre-feature behavior with any preset active.
7. Edit `presets.toml` while the view is open, then invoke `Build` → the launched args reflect the edited file without a window reload.

### Failure and refresh checks

1. `preset-missing-shared/` → user presets remain selectable, no missing-file warning appears.
2. Delete `user-presets.toml` from `preset-valid/` at runtime → shared presets keep working, no warning.
3. `preset-malformed-shared/` → the `Presets` header stays visible, its choices are replaced by an error row, details appear in the `Trezor Firmware Tools` log channel and as a diagnostic on `presets.toml`, `Build`/`Clippy`/`Check` are blocked, `Clean` is not.
4. `preset-invalid-user/` → same outcome, attributed to `user-presets.toml`.
5. While a file is invalid with a named preset saved, fix the file → the saved preset is restored when it is still available, and normalizes to `Default` only when it is not.
6. Invoke `Build` from the Command Palette while a preset file is invalid → execution is rejected with a visible error plus a log entry, and no task starts.
7. Create, edit, and delete `user-presets.toml` with the view open → the `Presets` choices, active preset, option values, emphasis, and workflow enablement all refresh within two seconds and without a window reload (SC-004).
8. Change `tfTools.cargoWorkspacePath` → preset inputs are re-resolved from the new location.

## Regression checks

Run the full suites and confirm no behavior change where the feature must be invisible (SC-005):

- `src/test/unit/ui/status-bar.test.ts`, `src/test/unit/workflow/task-labels.test.ts` — unchanged text.
- `src/test/unit/workflow/build-arguments.test.ts` — pre-feature argument lists still produced for the `Default`/no-override case.
- `src/test/unit/workflow/preconditions.test.ts` — existing block reasons and priority unchanged, with `presets-invalid` added after `manifest-invalid`.
- `src/test/integration/persistence-status-bar.integration.test.ts` — legacy `tfTools.activeConfig` records without `presetId` restore without loss.
- `src/test/integration/build-workflow.integration.test.ts`, `src/test/integration/flash-upload-actions.integration.test.ts`, `src/test/integration/debug-launch.integration.test.ts` — unchanged.

## Documentation completion gate

FR-029 is part of the feature, not a follow-up. Before the work is complete, `specs/product-spec.md` and `specs/glossary.md` must be updated to cover:

- the fourth `Build Selection` selector and its `layers` icon in `Configuration View Iconography`;
- preset-relative option display, emphasis, mismatch, and unresolved states in `Build Option Management`;
- the preset id inside the active-configuration record in `Persistence And Defaults`, and the replacement of the "multistate options default to the manifest-defined default state" rule;
- preset inputs as refresh triggers in `Startup And Refresh Behavior`, including the `tfTools.cargoWorkspacePath` trigger;
- the `-p` and `<flag>=false` argument forms in `Build` and `Clippy And Check`, and the statement that `Clean` is unaffected by preset invalidity;
- glossary entries for `preset`, `active preset`, `default preset`, `preset-effective value`, and `build-option override`, plus the extended `active configuration` definition.
