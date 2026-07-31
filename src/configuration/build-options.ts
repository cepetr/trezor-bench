/**
 * Workspace-scoped persistence and normalization for build-option selections.
 *
 * Build-option selections live separately from the core model/target/component
 * active config (Decision 3 from research.md) so that the Configuration
 * Experience slice remains untouched.
 *
 * Keys in the stored map are `BuildOption.key` values (deterministic, derived
 * from the option flag). Values are:
 *   - `boolean` for checkbox options
 *   - `string` (state id) for multistate options
 *   - `null` when the user has not made an explicit selection
 */

import * as vscode from "vscode";
import { BuildOption } from "../manifest/manifest-types";
import { evaluateWhenExpression } from "../manifest/when-expressions";
import { PresetEffectiveValue } from "../presets/preset-resolution";

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Workspace-state key for persisted build-option selections. */
export const BUILD_OPTIONS_KEY = "tfTools.buildOptions";

export interface BuildOptionsState {
  /** Map of option key → persisted value. */
  readonly values: Readonly<Record<string, boolean | string | null>>;
  /** ISO timestamp of the latest write. */
  readonly persistedAt: string;
}

/**
 * Reads the saved build-option selections from workspace state.
 * Returns undefined when no selections have been saved yet.
 */
export function readBuildOptions(
  context: vscode.ExtensionContext
): BuildOptionsState | undefined {
  return context.workspaceState.get<BuildOptionsState>(BUILD_OPTIONS_KEY);
}

/**
 * Persists the given values map to workspace state, merging with the
 * existing state so that unrelated option values are preserved.
 */
export async function writeBuildOption(
  context: vscode.ExtensionContext,
  key: string,
  value: boolean | string | null
): Promise<BuildOptionsState> {
  const existing = readBuildOptions(context);
  const merged: Record<string, boolean | string | null> = {
    ...(existing?.values ?? {}),
    [key]: value,
  };
  const state: BuildOptionsState = {
    values: merged,
    persistedAt: new Date().toISOString(),
  };
  await context.workspaceState.update(BUILD_OPTIONS_KEY, state);
  return state;
}

// ---------------------------------------------------------------------------
// Context evaluation
// ---------------------------------------------------------------------------

export interface BuildContext {
  readonly modelId: string;
  readonly targetId: string;
  readonly componentId: string;
}

// ---------------------------------------------------------------------------
// Resolved option (option + its current effective value)
// ---------------------------------------------------------------------------

export interface ResolvedOption {
  /** The option definition from the manifest. */
  readonly option: BuildOption;
  /**
   * Whether this option is currently available for the active context.
   * Unavailable options are hidden from the UI and excluded from effective args.
   */
  readonly available: boolean;
  /**
   * The value the UI shows and commands consider:
   *   - checkbox: `true` / `false`
   *   - multistate: state id string
   * Falls back to the preset-effective value when no explicit override
   * survives normalization.
   */
  readonly value: boolean | string;
  /** The preset-effective value, present only when `presetState === "resolved"`. */
  readonly presetValue?: boolean | string;
  /** Mirrors `PresetEffectiveValue.state`. */
  readonly presetState: "resolved" | "unresolved" | "mismatch";
  /**
   * `true` only when an explicit stored selection differs from `presetValue`.
   * Drives visual emphasis (FR-015) and argument emission (FR-022). Forced
   * `false` when `presetState` is `"unresolved"` or `"mismatch"`.
   */
  readonly isOverride: boolean;
  /** The unrepresentable raw value, present only when `presetState === "mismatch"`. */
  readonly rawValue?: PresetEffectiveValue["rawValue"];
  /** File that supplied the mismatching value, present only when `presetState === "mismatch"`. */
  readonly sourceUri?: PresetEffectiveValue["sourceUri"];
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Resolves each build option in `options` against the active `context`, the
 * persisted `saved` selections, and `presetEffectiveValues` (the calculated
 * preset-relative value for each option, keyed by `BuildOption.key`).
 *
 * Returns a `ResolvedOption` for every option (including unavailable ones,
 * flagged with `available: false`) so that callers can preserve hidden
 * values while hiding them from the UI.
 *
 * Value resolution order (specs/009-build-preset-support/data-model.md §4):
 * 1. Read the stored selection.
 * 2. Discard it when null, matching no current state id, or equal to the
 *    null-valued state's id (research Decision 8, rule 3).
 * 3. A surviving selection becomes `value`; `isOverride = value !== presetValue`.
 * 4. Otherwise `value = presetValue`, `isOverride = false`.
 * 5. When `presetState === "unresolved"`, `value` is the null-valued state id
 *    if one exists, else the first state id; `isOverride` is forced `false`.
 * 6. When `presetState === "mismatch"`, `isOverride` is forced `false`.
 *
 * Invalid/unknown keys in `saved` are quietly ignored (not written back here).
 */
export function normalizeBuildOptions(
  options: ReadonlyArray<BuildOption>,
  saved: BuildOptionsState | undefined,
  context: BuildContext,
  presetEffectiveValues: ReadonlyMap<string, PresetEffectiveValue> = new Map()
): ResolvedOption[] {
  const savedValues = saved?.values ?? {};
  return options.map((option) => {
    const available = option.when
      ? evaluateWhenExpression(option.when, context)
      : true;

    const effective = presetEffectiveValues.get(option.key);
    let presetState: "resolved" | "unresolved" | "mismatch";
    let presetValue: boolean | string | undefined;
    if (effective) {
      presetState = effective.state;
      presetValue = effective.state === "resolved" ? effective.value : undefined;
    } else if (option.kind === "checkbox") {
      // No preset-effective value was computed for this key: mirrors the
      // "absent" row of the raw-value table (upstream implicit disabled).
      presetState = "resolved";
      presetValue = false;
    } else if (option.states?.some((s) => s.id === "null")) {
      presetState = "resolved";
      presetValue = "null";
    } else {
      presetState = "unresolved";
    }

    const storedRaw = savedValues[option.key];
    let stored: boolean | string | undefined;
    if (option.kind === "checkbox") {
      stored = typeof storedRaw === "boolean" ? storedRaw : undefined;
    } else if (
      typeof storedRaw === "string" &&
      storedRaw !== "null" &&
      option.states?.some((s) => s.id === storedRaw)
    ) {
      stored = storedRaw;
    } else {
      stored = undefined;
    }

    let value: boolean | string;
    let isOverride: boolean;

    if (presetState === "unresolved") {
      const nullState = option.states?.find((s) => s.id === "null");
      value = nullState ? "null" : (option.states?.[0]?.id ?? "");
      isOverride = false;
    } else if (presetState === "mismatch") {
      value = stored ?? (option.kind === "checkbox" ? false : (option.states?.[0]?.id ?? ""));
      isOverride = false;
    } else if (stored !== undefined) {
      value = stored;
      isOverride = value !== presetValue;
    } else {
      value = presetValue!;
      isOverride = false;
    }

    return {
      option,
      available,
      value,
      presetValue,
      presetState,
      isOverride,
      rawValue: presetState === "mismatch" ? effective?.rawValue : undefined,
      sourceUri: presetState === "mismatch" ? effective?.sourceUri : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Effective flags derivation
// ---------------------------------------------------------------------------

/**
 * Derives the ordered list of command-line flags from the resolved build options.
 * Only available options with active values contribute flags.
 *
 * For checkbox options: flag included only when value is `true` and flag is non-empty.
 * For multistate options: flag of the selected state included when non-empty.
 */
export function deriveOptionFlags(
  resolved: ReadonlyArray<ResolvedOption>
): string[] {
  const flags: string[] = [];
  for (const r of resolved) {
    if (!r.available) {
      continue;
    }
    if (r.option.kind === "checkbox") {
      if (r.value === true && r.option.flag) {
        flags.push(r.option.flag);
      }
    } else {
      // multistate — find the selected state's flag
      const state = r.option.states?.find((s) => s.id === r.value);
      if (state?.flag) {
        flags.push(state.flag);
      }
    }
  }
  return flags;
}
