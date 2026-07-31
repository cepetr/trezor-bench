# Contract: Preset-Aware Command Arguments

**Feature**: `009-build-preset-support` | **Date**: 2026-07-31

**File Reference Rule**: Use workspace-relative paths for any repository file references written into this document.

This contract defines the command lines the extension launches through the VS Code task system for `Build`, `Clippy`, and `Check`, and states which workflows are unaffected. It extends the shape already documented in `specs/product-spec.md` under `Command Surface`.

## Shape

```text
cargo xtask <subcommand> <component-id> -m <model-id> [target-flag] [-p <preset-id>] [override-flags…]
```

| Segment | Source | Emitted when |
| --- | --- | --- |
| `<subcommand>` | `build` \| `clippy` \| `check` | always |
| `<component-id>` | active component | always |
| `-m <model-id>` | active model | always |
| `[target-flag]` | active target's manifest `flag` | flag is a non-empty string |
| `[-p <preset-id>]` | active preset | active preset is **not** the synthetic `Default` choice |
| `[override-flags…]` | build options where `available && isOverride` | one entry per differing option, in manifest declaration order |

The segments before `-p` are byte-identical to the pre-feature argument list, so a workspace with no preset files and no overrides produces exactly the command it produced before this feature.

## Preset argument rules

- Emitted **exactly once** per command.
- Emitted only for a named active preset (FR-021).
- `-p default` is **never** emitted. When the synthetic `Default` choice is active, no preset argument appears at all, and `xtask` applies its own matching `[[defaults]]` fragments (FR-004, FR-021).
- The preset id is the group name verbatim, with no quoting or case transformation.

## Override argument rules

An argument is emitted for a build option only when all of the following hold:

1. the option is available for the active build context (manifest `when`);
2. an explicit stored selection exists for it;
3. that selection differs from the option's calculated preset-effective value.

Emission forms:

| Option kind | Selected value | Argument |
| --- | --- | --- |
| checkbox | on | `<flag>` |
| checkbox | off | `<flag>=false` |
| multistate | any state with a non-null `value` | `<flag>=<value>` (the state's existing `flag`) |
| multistate | the state whose `value` is `null` | none — selecting it clears the override |

Nothing is emitted when the option's preset-effective value is `unresolved` or `mismatch`.

The bare-`<flag>` and `<flag>=<value>` forms are unchanged from the pre-feature implementation (FR-023). `<flag>=false` is new and appears only in the negative-override case, which was unreachable before presets existed; it is the form `xtask` documents for explicitly disabling a boolean option.

## Recalculation before launch

Before deriving arguments, each of `Build`, `Clippy`, and `Check`:

1. reloads both preset inputs from disk;
2. recomputes available presets for the active build context and normalizes the active preset;
3. recomputes preset-effective values for every available build option;
4. derives the argument list from the fresh result.

The launch is rejected — with a user-visible error and a log entry, and no task started — when the reloaded preset state is file-level invalid or any available option reports a mismatch (FR-020, FR-028, FR-030).

## Blocking and enablement

| Condition | `Build` / `Clippy` / `Check` | `Clean` | `Flash` / `Upload` / `Start Debugging` |
| --- | --- | --- | --- |
| Unsupported workspace | blocked | blocked | blocked |
| Manifest missing or invalid | blocked | blocked | blocked |
| Preset file invalid | **blocked** | **unaffected** | **unaffected** |
| Option-level preset mismatch | **blocked** | **unaffected** | **unaffected** |

Enablement is expressed through VS Code context keys: `Build`, `Clippy`, and `Check` require `!tfTools.workflowBlocked && !tfTools.presetBlocked`; `Clean` keeps `!tfTools.workflowBlocked`. Preset-blocked entries remain visible but disabled, matching the existing blocked-behavior model in `specs/product-spec.md`.

## Unaffected surfaces

The active preset changes none of the following (FR-024, FR-025):

- the shared build-context display `{model-name} | {target-display} | {component-name}`;
- the status bar configuration item;
- task labels (`Build {model-name} | {target-display} | {component-name}`, fixed `Clean`);
- command names and command ids;
- `Clean`, `Flash to Device`, `Upload to Device`, and `Start Debugging` argument lists;
- artifact paths, IntelliSense context, excluded-file evaluation, and debug context.

## Worked examples

Active context: model `t3w1`, target `hardware` (`flag: null`), component `firmware`. Preset-effective values from the `presets.toml` example in `specs/009-build-preset-support/contracts/preset-files.md`.

| Active preset | Explicit selections | Command arguments |
| --- | --- | --- |
| `Default` | none | `build firmware -m t3w1` |
| `Default` | `frozen` on (equals preset-effective `true`) | `build firmware -m t3w1` |
| `Default` | `frozen` off (differs from preset-effective `true`) | `build firmware -m t3w1 --frozen=false` |
| `test` | none | `build firmware -m t3w1 -p test` |
| `test` | `btc-only` on (preset-effective `false`) | `build firmware -m t3w1 -p test --btc-only` |
| `dev` | `pyopt` = Enabled (preset-effective `false`) | `build firmware -m t3w1 -p dev --pyopt=true` |
| `dev` | `dbg-console` = Default/null (preset-effective `swo`) | `build firmware -m t3w1 -p dev` — the override is cleared |

With target `emulator` (`flag: --emulator`) and preset `test`, no overrides:

```text
cargo xtask build firmware -m t3w1 --emulator -p test
```
