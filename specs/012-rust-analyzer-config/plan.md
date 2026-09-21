# Implementation Plan: Automatic Rust Analyzer Configuration

**Branch**: `012-rust-analyzer-config` | **Date**: 2026-09-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/012-rust-analyzer-config/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

Add a workspace-persisted Rust Analyzer mode whose checkable Configuration view commands select either a fixed all-features configuration or a configuration generated from the active model, target emulator state, preset, and effective build-option flags. A dedicated asynchronous service will invoke the firmware generator with the repository's existing Cargo workspace and task-environment conventions, strictly parse its TOML output, detect explicit-setting conflicts, and replace the complete runtime configuration through Rust Analyzer's `addConfiguration` API. Generation and registration failures preserve both the selected mode and the last successfully registered object, while sequence and input-snapshot guards prevent stale work from applying.

Affected product-spec areas: `Configuration View`, `Rust Analyzer Configuration`, `Startup And Refresh Behavior`, and `Persistence And Defaults`. Required glossary terms: `active build context`, `active preset`, `preset-effective value`, `build-option override`, `xtask`, `workflow task environment`, `Configuration view`, `Rust Analyzer configuration`, `Rust Analyzer mode`, `model-specific mode`, `all-features mode`, `managed Rust configuration`, and `Rust Analyzer conflict`.

## Technical Context

**Language/Version**: TypeScript 5.8 targeting VS Code 1.105+ and Node.js in the desktop extension host

**Primary Dependencies**: VS Code Extension API, Node.js `child_process`/process APIs, existing `smol-toml` parser, existing repository configuration and preset/build-option services, and the exported `rust-lang.rust-analyzer` extension API

**Storage**: VS Code workspace state for the selected Rust Analyzer mode; Rust Analyzer owns persistence of the latest contributor object registered through its API; no authored settings files are changed

**Testing**: Mocha unit tests plus `@vscode/test-electron` integration tests; repository checks via `npm test && npm run lint`

**Target Platform**: VS Code 1.105+ desktop extension host on supported desktop operating systems

**Project Type**: Single-package VS Code extension

**Performance Goals**: Mode commands return control within one second; rapid sequences of at least ten relevant changes apply only the final configuration; no generator work runs in all-features mode

**Constraints**: Exactly one supported workspace folder; asynchronous and cancellable generation; atomic whole-object replacement; strict four-key TOML schema; explicit settings retain VS Code precedence; no `.vscode/settings.json` writes; last-good configuration survives failures; cleanup registers an empty object

**Scale/Scope**: Two commands, one persisted mode, four supported managed keys, one current generation request eligible to apply, and integration with the existing model/target/preset/effective-option refresh lifecycle; obsolete processes are cancelled when practical but may overlap briefly until termination

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Design Gate

- **I. TypeScript Extension First — PASS**: All implementation remains TypeScript and uses stable VS Code 1.105 APIs plus a documented exported extension API.
- **II. Manifest-Driven Behavior — PASS**: Model and target identity, emulator state, preset, effective options, and repository paths come from existing manifest/repository services; no firmware matrix is duplicated.
- **III. Tests Are Mandatory — PASS**: Parser, argument derivation, persistence, conflicts, latest-wins behavior, failures, commands, activation ordering, and cleanup receive unit or extension-host coverage.
- **IV. Failures Must Be Visible — PASS**: Missing tooling, process failures, invalid TOML, conflicts, and registration failures use concise warnings and contextual `Trezor Bench` output logs.
- **V. Keep It Small And Clear — PASS**: One Rust Analyzer service owns refresh state; small adapters isolate process and external-extension APIs; existing state and path helpers are reused.
- **VI. Code Must Stand Alone — PASS**: Source and tests will describe behavior directly and will not cite feature artifacts or requirement identifiers.
- **Delivery workflow — PASS**: `specs/product-spec.md` and `specs/glossary.md` were read. The feature spec already includes their command grouping, startup ordering, persistence, replacement, conflict, failure, and unsupported-workspace details.

### Post-Design Gate

Phase 1 preserves every pre-design result. The contracts keep repository data authoritative, explicitly define whole-object runtime registration and stale-result rejection, and add no compatibility layer or unrelated product behavior. No complexity exception is required.

## Project Structure

### Documentation (this feature)

```text
specs/012-rust-analyzer-config/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── commands/
│   ├── command-ids.ts
│   └── rust-analyzer-commands.ts
├── rust-analyzer/
│   ├── config-parser.ts
│   ├── config-runner.ts
│   ├── config-service.ts
│   ├── config-types.ts
│   └── config-wiring.ts
├── observability/log-channel.ts
├── ui/context-keys.ts
├── extension.ts
└── test/
    ├── unit/rust-analyzer/
    └── integration/rust-analyzer-config.integration.test.ts

package.json
```

**Structure Decision**: Keep the existing single extension package. Place parsing, process execution, runtime registration, conflict inspection, and refresh coordination under a new `src/rust-analyzer/` capability boundary; keep command registration in `src/commands/`; limit shared-file edits to activation wiring, context keys, observability, and contributions. Unit tests exercise pure and injected behavior without an extension host, while one integration suite verifies VS Code persistence, command state, setting scopes, and activation wiring.

## Implementation Design

### State And Refresh Flow

1. Restore the mode from workspace state, defaulting invalid or absent values to `all-features`, and set both command context keys before scheduling refresh.
2. Build an immutable refresh snapshot from mode plus model id, target id/emulator state, preset id, and ordered effective option flags. The component id is used only to derive currently effective options and is excluded from snapshot identity once those flags are captured.
3. In all-features mode, skip generation and attempt to register `{ "cargo.features": "all" }`.
4. In model-specific mode, wait silently while startup restoration is active and inputs are unresolved; afterward report persistent invalid context. Run the generator only for a complete snapshot.
5. Increment a refresh sequence and cancel the previous child process when practical. Before registration, compare both sequence and current snapshot; discard stale results silently.
6. Strictly validate the complete generated object, inspect all managed keys for explicit values, warn/log conflicts, then call `addConfiguration("cepetr.tbench", completeObject)`.
7. Update the last-applied snapshot only after registration succeeds. Failure never submits an empty or partial replacement.

### Generator Arguments

Invoke `cargo xtask ra-config` directly in the resolved Cargo workspace. Append `-m <model-id>`, the active target's emulator flag when emulator mode is true, `-p <preset-id>` only for a non-default preset, and the ordered flags from `deriveOptionFlags(resolvedOptions)`. Use `process.env` overlaid by resolved `tbench.taskExtraEnv`, capture stdout/stderr, and terminate obsolete children.

### Startup And Cleanup

Create the service after the existing state coordinators but schedule its first refresh only after repository configuration has started and model, target, preset, and effective options are restored. Selection commands and preset/option recomputation notify the service with newly derived snapshots; equality suppresses component changes that leave effective flags unchanged and all other no-op refreshes. On repository invalidation, unsupported workspace transition, disposal, or deactivation, invalidate pending work and register `{}` as the complete contributor object. Cleanup failure is logged without masking deactivation.

### Verification Strategy

- Pure parser tests cover empty/malformed TOML, unknown tables/keys, wrong and nested values, and exact flattening.
- Pure argument/snapshot tests cover hardware/emulator, default/named preset, effective flags, component changes with both unchanged and changed effective flags, and all-features suppression.
- Injected service tests cover persistence, immediate checked-state updates, missing extension, process and registration failures, conflict reporting, last-good retention, cancellation, and out-of-order completion.
- Extension-host tests cover workspace-state restore, menu context state, setting-scope inspection, activation ordering, unsupported-workspace cleanup, and runtime API activation/registration with a controllable adapter.

## Complexity Tracking

No constitution violations require justification.
