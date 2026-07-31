/**
 * Pure preset resolution: PresetContext derivation, preset availability, and
 * preset-effective build-option values.
 *
 * specs/009-build-preset-support/data-model.md §2
 */
import * as vscode from "vscode";
import { BuildOption } from "../manifest/manifest-types";
import { ManifestStateLoaded } from "../manifest/manifest-types";
import { PresetFile, PresetFilter, PresetFragment, PresetRawValue, DEFAULT_PRESET_ID } from "./preset-types";

/** The subset of the active build context PresetContext derivation needs. */
export interface ActiveBuildContext {
  readonly modelId: string;
  readonly targetId: string;
  readonly componentId: string;
}

/** The active build context expressed in upstream filter terms. */
export interface PresetContext {
  readonly modelId: string;
  readonly projectId: string;
  readonly emulator: boolean;
}

/** One choice offered under the `Presets` selector. */
export interface AvailablePreset {
  readonly id: string;
  readonly label: string;
  readonly isDefault: boolean;
}

/**
 * Derives the `PresetContext` from the active build context. `emulator` is
 * an identity with what the launched command line will set — it comes from
 * the active target's manifest `flag`, never from `targetId` (research
 * Decision 3).
 */
export function derivePresetContext(
  manifest: ManifestStateLoaded,
  activeConfig: ActiveBuildContext
): PresetContext {
  const target = manifest.targets.find((t) => t.id === activeConfig.targetId);
  const emulator = target?.flag === "--emulator" || target?.flag === "-e";
  return {
    modelId: activeConfig.modelId,
    projectId: activeConfig.componentId,
    emulator,
  };
}

/**
 * True when two preset contexts select the same preset fragments. Compares
 * exactly the three fields a `when` filter can restrict on, so a target switch
 * between two hardware targets — which changes `targetId` but not `emulator` —
 * is correctly not a preset-context change. Used by the refresh seam to decide
 * whether the calculated values every override was authored against still hold
 * (FR-017).
 */
export function samePresetContext(a: PresetContext, b: PresetContext): boolean {
  return a.modelId === b.modelId && a.projectId === b.projectId && a.emulator === b.emulator;
}

/**
 * Matching rule (FR-012): fields present are combined with AND, values
 * inside one field are combined with OR, an absent field matches all.
 */
export function matchesPresetFilter(filter: PresetFilter, context: PresetContext): boolean {
  if (filter.models && !filter.models.includes(context.modelId)) {
    return false;
  }
  if (filter.projects && !filter.projects.includes(context.projectId)) {
    return false;
  }
  if (filter.emulator !== undefined && filter.emulator !== context.emulator) {
    return false;
  }
  return true;
}

/**
 * Lists preset choices for the `Presets` selector: the synthetic `Default`
 * choice always first, then each named preset exactly once, at the position
 * of its first declaration scanning `shared.names` then `user.names`, and
 * only when at least one of its fragments — from either file — matches
 * `context` (FR-003, FR-004, FR-005, FR-006).
 */
export function listAvailablePresets(
  shared: PresetFile,
  user: PresetFile,
  context: PresetContext
): AvailablePreset[] {
  const result: AvailablePreset[] = [{ id: DEFAULT_PRESET_ID, label: "Default", isDefault: true }];

  const allFragments: ReadonlyArray<PresetFragment> = [...shared.fragments, ...user.fragments];
  const seen = new Set<string>([DEFAULT_PRESET_ID]);

  for (const name of [...shared.names, ...user.names]) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const matches = allFragments.some((f) => f.name === name && matchesPresetFilter(f.filter, context));
    if (matches) {
      result.push({ id: name, label: name, isDefault: false });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Preset-effective values (data-model.md §2 "PresetEffectiveValue")
// ---------------------------------------------------------------------------

/** The preset-effective value for one manifest build option, before explicit overrides. */
export interface PresetEffectiveValue {
  readonly optionKey: string;
  readonly state: "resolved" | "unresolved" | "mismatch";
  /** Present only when `state === "resolved"`. */
  readonly value?: boolean | string;
  /** Present when `state === "mismatch"`, for the diagnostic message. */
  readonly rawValue?: PresetRawValue;
  /** File that supplied the mismatching value. */
  readonly sourceUri?: vscode.Uri;
}

interface OverlayEntry {
  readonly rawValue: PresetRawValue;
  readonly sourceUri: vscode.Uri;
}

/**
 * Matches a preset fragment key to a manifest build option: the key equals
 * `option.id` when declared, otherwise `option.flag` with leading dashes
 * stripped (research Decision 4).
 */
export function presetMatchKey(option: BuildOption): string {
  return option.id ?? option.flag.replace(/^-+/, "");
}

/**
 * Builds the ordered key -> raw-value overlay for one active preset:
 * matching shared `defaults` fragments, matching user `defaults` fragments,
 * matching shared `<activePresetId>` fragments, then matching user
 * `<activePresetId>` fragments — each in file order, layers 3-4 skipped for
 * the synthetic `Default` choice (FR-010, FR-011; contracts/preset-files.md
 * "Precedence").
 */
export function buildPresetOverlay(
  shared: PresetFile,
  user: PresetFile,
  activePresetId: string,
  context: PresetContext
): ReadonlyMap<string, OverlayEntry> {
  const overlay = new Map<string, OverlayEntry>();

  const applyLayer = (file: PresetFile, name: string): void => {
    for (const fragment of file.fragments) {
      if (fragment.name !== name || !matchesPresetFilter(fragment.filter, context)) {
        continue;
      }
      for (const [key, rawValue] of Object.entries(fragment.values)) {
        overlay.set(key, { rawValue, sourceUri: file.uri });
      }
    }
  };

  applyLayer(shared, "defaults");
  applyLayer(user, "defaults");
  if (activePresetId !== DEFAULT_PRESET_ID) {
    applyLayer(shared, activePresetId);
    applyLayer(user, activePresetId);
  }

  return overlay;
}

/**
 * Maps one build option's overlay entry to its `PresetEffectiveValue`, per
 * the raw-value -> option-value table in data-model.md §2.
 */
export function computePresetEffectiveValue(
  option: BuildOption,
  overlay: ReadonlyMap<string, OverlayEntry>
): PresetEffectiveValue {
  const optionKey = option.key;
  const entry = overlay.get(presetMatchKey(option));

  if (option.kind === "checkbox") {
    if (entry === undefined) {
      return { optionKey, state: "resolved", value: false };
    }
    if (typeof entry.rawValue === "boolean") {
      return { optionKey, state: "resolved", value: entry.rawValue };
    }
    return { optionKey, state: "mismatch", rawValue: entry.rawValue, sourceUri: entry.sourceUri };
  }

  // multistate
  if (entry === undefined) {
    const nullState = option.states?.find((s) => s.id === "null");
    if (nullState) {
      return { optionKey, state: "resolved", value: "null" };
    }
    return { optionKey, state: "unresolved" };
  }

  const rawAsStateId = String(entry.rawValue);
  if (option.states?.some((s) => s.id === rawAsStateId)) {
    return { optionKey, state: "resolved", value: rawAsStateId };
  }
  return { optionKey, state: "mismatch", rawValue: entry.rawValue, sourceUri: entry.sourceUri };
}

/**
 * Computes the preset-effective value for every option, keyed by
 * `BuildOption.key`. Options whose preset fragment key matches no manifest
 * option simply never appear in the overlay and contribute nothing
 * (research Decision 5).
 */
export function computePresetEffectiveValues(
  options: ReadonlyArray<BuildOption>,
  shared: PresetFile,
  user: PresetFile,
  activePresetId: string,
  context: PresetContext
): ReadonlyMap<string, PresetEffectiveValue> {
  const overlay = buildPresetOverlay(shared, user, activePresetId, context);
  const result = new Map<string, PresetEffectiveValue>();
  for (const option of options) {
    result.set(option.key, computePresetEffectiveValue(option, overlay));
  }
  return result;
}
