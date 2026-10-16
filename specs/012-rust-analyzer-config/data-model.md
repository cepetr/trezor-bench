# Data Model: Automatic Rust Analyzer Configuration

## Rust Analyzer Mode

Workspace-persisted selection controlling command state and refresh behavior.

| Field | Type | Rules |
| --- | --- | --- |
| `mode` | `"model-specific" | "all-features"` | Defaults to `all-features`; invalid stored values normalize to the default. |

State transitions:

- Restore: absent/invalid to `all-features`; valid value remains unchanged.
- Command selection: persist new value, update both checkmarks, then schedule refresh.
- Refresh failure: no transition.

## Configuration Input Snapshot

Immutable identity for one refresh request.

| Field | Type | Rules |
| --- | --- | --- |
| `mode` | Rust Analyzer mode | Must still match current persisted mode before registration. |
| `modelId` | string | Required only in model-specific mode; resolves from the active model. |
| `targetId` | string | Required only in model-specific mode; detects target changes even between targets of the same kind. |
| `emulator` | boolean | Derived from the target's manifest flag. |
| `targetFlag` | string or absent | Included in generator arguments only for emulator mode. |
| `presetId` | string | Uses the active preset id; default does not emit `-p`. |
| `effectiveFlags` | ordered string list | Derived from all available effective build-option values. |
| `sequence` | integer | Increases for every requested refresh. |

`componentId` is not part of the snapshot identity. A component change can alter preset-effective flags; refresh occurs only if the resulting `effectiveFlags` differ.

## Managed Rust Configuration

Complete object registered under contributor id `cepetr.tbench`.

| Dotted key | Value type | Presence |
| --- | --- | --- |
| `cargo.features` | `string[]` or literal `"all"` | Required in all-features mode; optional in generated output. |
| `cargo.target` | string | Hardware generated output; omitted for emulator. |
| `cargo.allTargets` | boolean | Optional generated value. |
| `check.extraArgs` | string[] | Optional generated value for hardware and emulator. |

Validation is atomic. Empty generated output, unknown tables or keys, nested values, non-string array entries, or mismatched scalar types invalidate the entire generated object. Registration replaces the previous complete contributor object; `{}` clears it.

## Explicit Setting Conflict

One managed key with at least one authored Rust Analyzer setting.

| Field | Type | Rules |
| --- | --- | --- |
| `key` | supported dotted key | Must also exist in the configuration being submitted. |
| `scopes` | non-empty list | Values are `user`, `workspace`, or `workspace-folder`. |
| `values` | scope/value records | Preserve values for detailed logs; normal editor precedence chooses the effective value. |

Conflicts are informational state for warning/log output. They do not remove submitted keys, mutate the selected mode, or alter the last-applied object.

## Refresh Result

Outcome associated with exactly one input snapshot.

| Variant | Fields | Application rule |
| --- | --- | --- |
| `success` | snapshot, complete configuration, conflicts | Apply only when sequence and current snapshot still match. |
| `cancelled` | snapshot | Never warn or apply. |
| `failed` | snapshot, stage, message, stderr | Warn/log only if still current; preserve last applied configuration. |

Failure stages are `context`, `tool`, `generation`, `validation`, and `registration`. Startup-incomplete context is a waiting state rather than a failure.