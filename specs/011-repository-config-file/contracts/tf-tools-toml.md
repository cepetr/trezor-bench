# Contract: `tf-tools.toml`

## Location

The file is optional and is read only as `tf-tools.toml` at the root of a supported single-root VS Code workspace. Multi-root and folderless workspaces remain unsupported.

## Schema

```toml
[paths]
cargo-workspace = "core/embed"
debug-templates = "core/embed/xtask/tf-tools/debug"
build-artifacts = "core/build-xtask/artifacts"
manifest = "core/embed/xtask/tf-tools/manifest.yaml"
presets = "core/embed/xtask"
```

All supported entries are optional strings. Omitted entries use their defaults in [data-model.md](../data-model.md). Unknown keys in `[paths]` are ignored.

## Resolution

- Non-empty relative strings resolve from the workspace root.
- Absolute strings are used unchanged.
- `${workspaceFolder}`, `${env:NAME}`, and all other VS Code variable references are literal file-name text; they are never expanded.
- `cargo-workspace = ""` resolves to the workspace root.
- `build-artifacts = ""` disables artifact-based IntelliSense resolution.
- Empty `manifest`, `debug-templates`, and `presets` values select their respective built-in defaults.
- `presets` is the directory directly containing `presets.toml` and `user-presets.toml`; it is never derived from `cargo-workspace`.

## Validity And Recovery

- A missing file is valid and selects all defaults.
- A malformed or unreadable present file is invalid and blocking.
- `[paths]` must be a TOML table when present.
- Every supported entry present in `[paths]` must be a string.
- An invalid file produces an error diagnostic on `tf-tools.toml`, a user-visible error, and detailed log output. The extension does not use defaults or prior paths while it is invalid.
- The extension watches create, change, and delete events. A valid update applies all paths together; correction or deletion leaves the blocking state without a window reload.

## Compatibility

The legacy VS Code settings `tfTools.cargoWorkspacePath`, `tfTools.debug.templatesPath`, `tfTools.artifactsPath`, and `tfTools.manifestPath` are removed. No migration behavior is provided for their values.