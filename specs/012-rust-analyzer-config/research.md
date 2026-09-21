# Research: Automatic Rust Analyzer Configuration

## Runtime Registration

- **Decision**: Activate `rust-lang.rust-analyzer`, validate its exported API at runtime, and call `addConfiguration("cepetr.tbench", completeConfiguration)`.
- **Rationale**: Rust Analyzer's exported `RustAnalyzerExtensionApi` documents `addConfiguration(extensionId, Record<string, unknown>)`. Its implementation stores one object per extension id, replaces that contributor's previous object, recomputes active configuration immediately, and ignores contributor values where explicit global, workspace, or workspace-folder values exist.
- **Alternatives considered**: Writing `rust-analyzer.*` settings was rejected because it modifies authored configuration and cannot preserve the required runtime precedence behavior. Sending editor restart commands was rejected because `addConfiguration` already propagates changes to the active client.

## Generated TOML Parsing

- **Decision**: Parse stdout with the existing `smol-toml` dependency and then perform an explicit allow-list validation before flattening.
- **Rationale**: A structured parser correctly handles TOML syntax while a separate validator can reject empty documents, unknown tables/keys, nested objects, mixed arrays, and wrong scalar types atomically. The repository already depends on `smol-toml` for preset parsing.
- **Alternatives considered**: Ad hoc line parsing was rejected as fragile. Generic recursive flattening was rejected because it could accidentally admit future or nested settings outside the four-key contract.

## Generator Execution

- **Decision**: Add an injected direct-process runner based on Node.js `child_process.spawn`, reusing `resolveCargoWorkspacePath`, `readTaskExtraEnv`, `derivePresetContext`, and `deriveOptionFlags` for inputs.
- **Rationale**: The existing `ProcessExecution` helper establishes direct-process, cwd, and environment conventions, but VS Code tasks do not provide the captured stdout/stderr and prompt cancellation needed here. A small runner can merge `process.env` with task overrides, capture diagnostics, and terminate obsolete generation.
- **Alternatives considered**: Running a VS Code task was rejected because output capture and request-scoped cancellation are poor fits. `exec` through a shell was rejected because shell startup and quoting would violate existing workflow conventions.

## Generator Argument Contract

- **Decision**: Invoke `cargo xtask ra-config -m <model-id>`, append the active target's manifest-defined emulator flag only for emulator targets, append `-p <preset-id>` only for a non-default preset, then append all ordered effective flags from `deriveOptionFlags`.
- **Rationale**: This matches existing xtask model, target, preset, and option conventions while intentionally using effective flags rather than override-only build flags. Emulator identity remains derived from the target flag, never inferred from the target id.
- **Alternatives considered**: Passing component was rejected because generation covers all embedded projects. Passing only persisted overrides was rejected because the generator requires the effective configuration after preset resolution.

## Mode Persistence And Command State

- **Decision**: Store a two-value mode in workspace state and expose two independent context keys used by `toggled` menu contributions.
- **Rationale**: Workspace state matches existing selection persistence. Updating context keys immediately after a successful mode write keeps exactly one checkmark independent of refresh success and C/C++ readiness.
- **Alternatives considered**: A user setting was rejected because the mode is workspace-specific product state. Deriving checkmarks from the last applied configuration was rejected because failures must not change selection.

## Refresh Concurrency

- **Decision**: Use immutable input snapshots, a monotonically increasing sequence, best-effort child termination, and a final current-input comparison immediately before registration.
- **Rationale**: Cancellation alone is racy. Sequence and snapshot checks guarantee latest-wins behavior even when a process exits after cancellation or external API activation overlaps another refresh.
- **Alternatives considered**: Serializing every request was rejected because slow obsolete work would delay current configuration. Debouncing alone was rejected because already-running work can still finish out of order.

## Conflict Detection

- **Decision**: Inspect each complete managed key with `workspace.getConfiguration("rust-analyzer", workspaceFolder.uri).inspect(key)` and record explicit `globalValue`, `workspaceValue`, and `workspaceFolderValue` entries before registration.
- **Rationale**: These fields correspond to the supported authored scopes and exclude defaults. The same complete object is still submitted, allowing Rust Analyzer's own precedence logic to reveal it automatically if the explicit setting is removed.
- **Alternatives considered**: Reading only the effective value loses scope information. Filtering conflicting keys would prevent immediate fallback after the authored value is removed.

## Failure And Cleanup Policy

- **Decision**: Commit last-applied state only after `addConfiguration` resolves. Keep the previous object on generation, validation, missing-tool, or registration failure; use an empty registration only for explicit lifecycle cleanup.
- **Rationale**: Rust Analyzer replaces the contributor object on every call, so pre-emptive clearing or partial registration would destroy a working configuration. Empty replacement is the documented way to remove all contributor overrides.
- **Alternatives considered**: Clearing at refresh start was rejected because transient failures would leave the editor unconfigured. Retrying on a timer was rejected because the specification limits retry to the next relevant trigger or mode toggle.