# Quickstart: Validate Automatic Rust Analyzer Configuration

## Prerequisites

- VS Code 1.105 or newer with `rust-lang.rust-analyzer` installed.
- A single-folder firmware workspace with valid `tbench.toml`, manifest, and preset inputs.
- The firmware workspace provides `cargo xtask generate-rust-analyzer-config` as defined in [contracts/rust-analyzer-configuration.md](contracts/rust-analyzer-configuration.md).
- Install extension dependencies with `npm ci`.

## Automated Validation

```bash
npm test
npm run lint
```

Expected: parser, runner, service, command, persistence, conflict, latest-wins, integration, and existing regression suites pass with no lint errors.

## Default And Persistence

1. Open a supported workspace with no saved Rust Analyzer mode.
2. Open the Configuration view overflow menu.
3. Confirm `Rust Analyzer: All Features` is checked and Model Specific is unchecked.
4. Confirm the active Rust Analyzer configuration contains only `cargo.features = "all"` from Trezor Bench.
5. Select Model Specific, reload the window, and reopen the menu.

Expected: Model Specific remains checked after reload and refresh starts only after build context, preset, and effective options are restored.

## Hardware And Emulator Replacement

1. Select Model Specific with a valid hardware target and wait for refresh.
2. Confirm the registered object includes the generated `cargo.target` and `check.extraArgs`.
3. Select an emulator target and wait for refresh.

Expected: the newly registered complete object omits both hardware-only keys, proving that whole-object replacement clears stale managed values. Changing only component starts no generation unless it changes effective option flags; all-features mode starts no generator for any build-context change.

## Latest-Wins Behavior

1. In Model Specific mode, make at least ten rapid relevant model, target, preset, or option changes while generator calls are delayed.
2. Allow calls to complete out of order.

Expected: only the object for the final current snapshot is registered. Cancelled and stale completions produce no replacement and no stale warning.

## Explicit Setting Conflicts

1. Author conflicting `rust-analyzer.cargo.target`, `rust-analyzer.cargo.features`, or another managed key at user, workspace, and workspace-folder scopes.
2. Trigger refresh.
3. Inspect the warning and `Trezor Bench` output channel, then remove the explicit value without changing mode or build selection.

Expected: the warning names conflicting keys, logs list each authored scope/value, the complete managed object was still registered, and removal immediately reveals its managed value.

## Failure Retention And Recovery

1. Start from a successfully applied configuration.
2. Separately test a missing Rust Analyzer extension, nonzero generator exit, malformed or schema-invalid TOML, and rejected `addConfiguration` call.
3. Correct the condition and make the next relevant selection change or toggle the mode.

Expected: each current failure emits one concise warning and contextual log record, keeps selected mode/checkmarks and the previous managed object, and retries on the next relevant trigger. During startup, unresolved context waits without warning until restoration ends.

## Cleanup

Close the supported folder, enter a multi-root state, disable the capability through extension disposal, or deactivate Trezor Bench.

Expected: pending generation becomes ineligible and Trezor Bench submits `{}` to clear its managed Rust Analyzer overrides. Cleanup does not modify authored settings.