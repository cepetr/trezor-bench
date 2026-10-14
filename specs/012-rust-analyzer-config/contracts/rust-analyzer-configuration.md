# Rust Analyzer Configuration Contracts

## Command Surface

The Configuration view title overflow contributes a dedicated group after existing workflow controls:

| Command id | Label | Menu group |
| --- | --- | --- |
| `tbench.rustAnalyzer.selectConfiguration` | `Rust Analyzer: Select Configuration…` | `rust-analyzer@1` |

The command is also available from the Command Palette and remains visible independently of C/C++ IntelliSense. It opens a Quick Pick with one item per mode, `All Features` and `Model Specific`; the selected mode is listed first with the description `Active`. Picking an item persists its mode and then starts asynchronous refresh without awaiting it. Dismissing the Quick Pick changes nothing.

## Firmware Generator

### Invocation

```text
cargo xtask ra-config -m <model-id> [<emulator-target-flag>] [-p <preset-id>] [<effective-option-flag> ...]
```

- Working directory: repository-configured Cargo workspace.
- Environment: extension host environment overlaid by resolved `tbench.taskExtraEnv` entries.
- Component: never passed.
- Default preset: never emits `-p default`.
- Output: complete TOML on stdout; diagnostics on stderr.
- Success: exit code zero and valid non-empty stdout.
- Cancellation: terminate the child when superseded or disposed; a late completion remains ineligible for application.

### TOML Schema

```toml
[cargo]
features = ["feature-a", "feature-b"]
target = "thumbv7em-none-eabihf"
allTargets = false

[check]
extraArgs = ["--target", "thumbv7em-none-eabihf"]
```

Only `[cargo]` and `[check]` are accepted. Only these entries are accepted:

| TOML entry | Required type | Flattened key |
| --- | --- | --- |
| `cargo.features` | array of strings | `cargo.features` |
| `cargo.target` | string | `cargo.target` |
| `cargo.allTargets` | boolean | `cargo.allTargets` |
| `check.extraArgs` | array of strings | `check.extraArgs` |

Unknown tables/keys, nested objects, unsupported values, empty output, parse errors, or wrong types reject the whole document. Hardware output must contain `cargo.target` and `check.extraArgs`; emulator output must omit both. The firmware generator owns the semantic contents of `check.extraArgs`; the extension validates its presence and string-array type for hardware output but does not interpret individual arguments.

## Rust Analyzer Extension API

Expected exported shape:

```typescript
interface RustAnalyzerApi {
  addConfiguration(
    extensionId: string,
    configuration: Readonly<Record<string, unknown>>
  ): Promise<void>;
}
```

The adapter obtains `vscode.extensions.getExtension("rust-lang.rust-analyzer")`, activates it when necessary, validates `addConfiguration`, and submits contributor id `cepetr.tbench`. Every call contains the complete selected configuration. A later complete object replaces the previous contributor object, and `{}` removes all managed values.

The extension inspects authored settings before each non-empty submission but never removes conflicts from the object. Explicit global, workspace, and workspace-folder settings retain precedence within Rust Analyzer.

## Refresh Applicability

A result may be registered only when all conditions hold immediately before the API call:

1. The service is not disposed and the workspace is supported.
2. Its sequence equals the latest requested sequence.
3. Its mode equals the current selected mode.
4. Its model, target, emulator state, preset, and effective flags equal the current snapshot.

Failure before a successful API call leaves the previous managed object active. Cleanup is the only path that deliberately replaces it with `{}`.