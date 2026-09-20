# Rust Analyzer Configuration Contracts

## Command Surface

The Configuration view title overflow contributes a dedicated group after existing workflow controls:

| Command id | Label | Selected context |
| --- | --- | --- |
| `tbench.rustAnalyzer.modelSpecific` | `Rust Analyzer: Model Specific` | `tbench.rustAnalyzerModelSpecific` |
| `tbench.rustAnalyzer.allFeatures` | `Rust Analyzer: All Features` | `tbench.rustAnalyzerAllFeatures` |

Both commands remain visible independently of C/C++ IntelliSense. Their menu contributions use `toggled` context expressions, and the extension maintains exactly one true selected context after mode initialization. Invoking a command persists its mode and updates checkmarks before starting asynchronous refresh.

## Firmware Generator

### Invocation

```text
cargo xtask generate-rust-analyzer-config -m <model-id> [<emulator-target-flag>] [-p <preset-id>] [<effective-option-flag> ...]
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

Unknown tables/keys, nested objects, unsupported values, empty output, parse errors, or wrong types reject the whole document. Hardware output must contain `cargo.target` and `check.extraArgs`; emulator output must omit both.

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