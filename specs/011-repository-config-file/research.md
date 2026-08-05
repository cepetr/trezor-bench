# Research: Repository Configuration File

## Decision: Reuse `smol-toml` for `tf-tools.toml`

**Rationale**: The extension already depends on `smol-toml` and uses it for `presets.toml`. Reusing it keeps parsing, error reporting, package footprint, and test conventions consistent while avoiding a new dependency.

**Alternatives considered**:

- Add a TOML parser dependency: rejected because the installed parser fully covers the required file format.
- Parse TOML manually: rejected because it would be less reliable and would duplicate parser behavior.

## Decision: Introduce one repository-configuration service and immutable resolved snapshot

**Rationale**: Five path consumers must change atomically on startup and on create/change/delete events. A service that publishes `absent`, `loaded`, or `invalid` state provides one authoritative result for the extension and prevents individual consumers from independently falling back while a present file is invalid.

**Alternatives considered**:

- Read the file separately in each existing settings helper: rejected because reads can disagree during edits and cannot enforce the blocking state consistently.
- Treat the file as a VS Code configuration value: rejected because it would continue to bind repository layout to editor settings rather than to repository state.

## Decision: Resolve repository paths without configuration-variable expansion

**Rationale**: `tf-tools.toml` is committed to the repository and must be independent of a contributor's VS Code session and environment. Each non-empty relative string is resolved from the single workspace root; absolute strings are used unchanged.

**Alternatives considered**:

- Reuse configuration-variable resolution from `settings.ts`: rejected because it violates FR-005.
- Reject strings containing `${...}`: rejected because the requirement calls for literal interpretation, not validation failure.

## Decision: Apply built-in defaults per absent or empty entry as specified

**Rationale**: A missing file and a partial file support older repository revisions. Empty `cargo-workspace` deliberately resolves to the workspace root; empty `build-artifacts` deliberately disables artifact IntelliSense; empty `manifest`, `debug-templates`, and `presets` select their built-in defaults. Unsupported `[paths]` keys are ignored, while each supported non-string value blocks the configuration.

**Alternatives considered**:

- Treat every empty value as invalid: rejected because it changes established special empty-value behavior.
- Resolve every empty value to the workspace root: rejected because it would make manifest, debug template, and preset lookup misleading and inconsistent with their defaults.
- Reject unknown `[paths]` keys: rejected because forward-compatible repository metadata should not block the extension.

## Decision: Reuse the manifest service's watcher and failure presentation pattern

**Rationale**: `ManifestService` already debounces create/change/delete events and publishes explicit states. The repository configuration service can mirror that pattern, attach diagnostics to the concrete `tf-tools.toml` file, and use the dedicated output channel plus an error notification for a blocking state.

**Alternatives considered**:

- Poll only: rejected because file watchers are the existing responsive mechanism and polling is unnecessary for a root-level workspace file.
- Retain the last successful snapshot when parsing fails: rejected because FR-010 prohibits stale paths during a present invalid configuration.

## Decision: Reconfigure all dependent services only after a valid or absent snapshot

**Rationale**: On a valid configuration change or file deletion, the extension must restart manifest and preset services at the newly resolved paths, update the IntelliSense artifacts root and watcher, refresh artifact/debug context, and refresh the tree/status state. On invalid state, it must clear path-dependent state and block commands rather than operating with old paths.

**Alternatives considered**:

- Update each consumer opportunistically: rejected because partial updates can combine a new manifest with old artifacts or presets.
- Reload the VS Code window: rejected because FR-011 requires live recovery.

## Decision: Cover parser/path behavior with unit tests and lifecycle behavior with extension-host integration tests

**Rationale**: Parsing/defaulting and literal variable handling are deterministic pure behavior. File watching, diagnostics, notifications, and dependent-service restarts need VS Code extension-host coverage, matching the project's manifest and preset test approach.

**Alternatives considered**:

- Unit tests only: rejected because the feature changes VS Code watchers, diagnostics, and command availability.
- Integration tests only: rejected because parsing and resolution cases are easier to exhaust and diagnose as unit tests.