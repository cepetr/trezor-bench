# Contract: Preset File Inputs

**Feature**: `009-build-preset-support` | **Date**: 2026-07-31

**File Reference Rule**: Use workspace-relative paths for any repository file references written into this document.

This contract defines the external file format the extension consumes. It is owned upstream by `xtask` (`core/embed/xtask/src/presets.rs`, `core/embed/xtask/src/options.rs`, documented in `docs/core/build/xtask.md` on branch `cepetr/xtask-build-presets`). The extension is a **reader only** — it never creates, edits, or deletes these files.

## Locations

| Input | Path | Required |
| --- | --- | --- |
| Shared presets | `<cargo-workspace>/xtask/tf-tools/presets.toml` | No — an absent file is treated exactly as an empty file (FR-027) |
| User presets | `<cargo-workspace>/xtask/tf-tools/user-presets.toml` | No — optional personal overrides, git-ignored upstream |

`<cargo-workspace>` is the resolved `tfTools.cargoWorkspacePath` setting (default `core/embed`), so the default locations are `core/embed/xtask/tf-tools/presets.toml` and `core/embed/xtask/tf-tools/user-presets.toml`. The shared file is always processed before the user file.

## Document shape

A preset file is a TOML document whose top level contains only arrays of tables:

```toml
[[<group-name>]]
when = { model = ["<model-id>", …], project = ["<component-id>", …], emulator = <bool> }
<option-key> = <value>
…
```

- Each `[[<group-name>]]` table is one **preset fragment**. A group name may repeat; every repetition is an additional fragment for that name, retained in file order.
- `defaults` is the reserved base-layer group name. Its matching fragments are applied to every build before any named preset and it is never offered as a selectable choice.
- `default` is reserved by the extension for the synthetic `Default` choice. A group with that name is excluded from the choice list and reported as a warning.
- Every other group name is a selectable named preset. It is offered whatever the active build context, including when none of its fragments' `when` filters match: filters decide which values the preset contributes, not whether it is listed.

## The `when` filter

`when` is optional. When present it must be a table containing only these fields:

| Field | Type | Matches when |
| --- | --- | --- |
| `model` | array of strings | the active model id is in the array |
| `project` | array of strings | the active component id is in the array |
| `emulator` | boolean | the value equals the active target's emulator flag |

Rules:

- Fields present are combined with **AND**; values inside one field are combined with **OR**.
- An omitted field matches every active build context. A fragment with no `when` always applies.
- Values are compared by exact string equality against manifest ids. Values that name no manifest model or component simply never match; that is **not** an error, because `xtask` recognizes projects (`kernel`, `secmon`) the tf-tools manifest does not expose.
- The active target's emulator flag is `true` when that target's manifest `flag` is `--emulator` or `-e`.

## Option keys and values

- Keys are kebab-case `xtask` build-option names (`btc-only`, `dbg-console`, `source-lines`, `pyopt`, …).
- A key is consumed by the extension only when it equals a manifest `options[].id` (or, for a manifest entry without `id`, the entry's `flag` with leading dashes stripped). Keys the manifest does not define are ignored and produce no message beyond a log entry.
- Boolean-valued keys map to manifest `checkbox` options and to `multistate` options whose state values are `"true"` / `"false"`.
- String-valued keys map to `multistate` options by exact match against a state `value`.
- A value the corresponding manifest option cannot represent is an option-level mismatch: the option row reports it, Build/Clippy/Check are blocked, and the value is never guessed at.

## Precedence

For one build, option values are layered lowest to highest:

1. matching `shared` `[[defaults]]` fragments, in file order
2. matching `user` `[[defaults]]` fragments, in file order
3. matching `shared` `[[<active-preset>]]` fragments, in file order
4. matching `user` `[[<active-preset>]]` fragments, in file order
5. explicit build-option overrides from the Configuration view

Within any layer a later matching fragment replaces an earlier value for the same key; keys a fragment omits keep the value established by earlier layers. Layers 3 and 4 are skipped when the active preset is the synthetic `Default` choice.

## Validation outcomes

| Condition | Severity | Effect |
| --- | --- | --- |
| File absent | none | Treated as empty. No warning. |
| File unreadable | error | File-level invalid. |
| TOML syntax error | error | File-level invalid. Diagnostic at the reported line/column. |
| Top-level value that is not an array of tables | error | File-level invalid. |
| `when` is not a table | error | File-level invalid. |
| `when` contains a field other than `model`, `project`, `emulator` | error | File-level invalid. |
| `when.model` / `when.project` not an array of strings | error | File-level invalid. |
| `when.emulator` not a boolean | error | File-level invalid. |
| Group named `default` | warning | Group excluded from choices. Not blocking. |
| Option key unknown to the manifest | none | Key ignored. Log entry only. |
| Value unrepresentable by the matching manifest option | error | Option-level mismatch. Choices remain listed; Build/Clippy/Check blocked. |

File-level invalid means: the `Preset` selector header stays visible with its preset choices replaced by an error row, details go to the `Trezor Firmware Tools` log channel and to diagnostics on the offending file, Build/Clippy/Check are blocked, and the saved preset id is preserved without being resolved until valid data returns.

## Worked example

`core/embed/xtask/tf-tools/presets.toml`:

```toml
[[defaults]]
when = { emulator = true }
dbg-console = "swo"
source-lines = true

[[defaults]]
when = { emulator = false }
frozen = true
pyopt = true

[[test]]
debug = true
pyopt = true

[[dev]]
when = { emulator = false, project = ["firmware", "prodtest"] }
dbg-console = "swo"
debug = true
pyopt = false
```

For active context `model = t3w1`, `component = firmware`, `target = hardware` (`emulator = false`):

| Preset choice | Listed | Preset-effective values consumed by the manifest |
| --- | --- | --- |
| `Default` | always | `frozen = true`, `pyopt = true` |
| `test` | yes (no `when`, so it matches) | `frozen = true`, `pyopt = true`, `debug = "true"` |
| `dev` | yes (`emulator = false` and `project` contains `firmware`) | `frozen = true`, `pyopt = "false"`, `dbg-console = "swo"`, `debug = "true"` |

For the same context with `component = bootloader`, `dev` is **not** listed: its only fragment restricts `project` to `firmware`/`prodtest`, so no fragment matches.
