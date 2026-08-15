/**
 * Build selection: the persisted model/target/component/preset
 * selection. Reads, writes, and restores it from workspace state and applies
 * the selector commands' changes.
 */
import * as vscode from "vscode";
import { BuildContext, ManifestStateLoaded } from "../manifest/manifest-types";
import { normalizeBuildSelection, normalizePresetId } from "./normalize-selection";
import { DEFAULT_PRESET_ID } from "../presets/preset-types";

// Storage key in workspace state — frozen legacy name; saved selections depend on it.
export const ACTIVE_CONFIG_KEY = "tbench.activeConfig";

export { DEFAULT_PRESET_ID };

export interface BuildSelection extends BuildContext {
  /**
   * Active preset id, `"default"` for the synthetic choice. Optional so
   * records persisted before this feature deserialize without loss; absent
   * is read as `DEFAULT_PRESET_ID` via `activePresetId`.
   */
  readonly presetId?: string;
  readonly persistedAt: string; // ISO timestamp
}

/** Reads the active preset id, defaulting to `DEFAULT_PRESET_ID` when absent. */
export function activePresetId(buildSelection: BuildSelection | undefined): string {
  return buildSelection?.presetId ?? DEFAULT_PRESET_ID;
}

/**
 * Reads the saved build selection from workspace state.
 * Returns undefined when no selection has been saved yet.
 */
export function readBuildSelection(
  context: vscode.ExtensionContext
): BuildSelection | undefined {
  return context.workspaceState.get<BuildSelection>(ACTIVE_CONFIG_KEY);
}

/**
 * Persists the build selection to workspace state.
 */
export async function writeBuildSelection(
  context: vscode.ExtensionContext,
  selection: Omit<BuildSelection, "persistedAt">
): Promise<BuildSelection> {
  const saved: BuildSelection = { ...selection, persistedAt: new Date().toISOString() };
  await context.workspaceState.update(ACTIVE_CONFIG_KEY, saved);
  return saved;
}

// ---------------------------------------------------------------------------
// Selector mutation helpers
// ---------------------------------------------------------------------------

/**
 * Selects a new model, preserving existing target and component when valid.
 * Normalizes the complete selection before writing.
 */
export async function selectModel(
  context: vscode.ExtensionContext,
  modelId: string,
  manifest: ManifestStateLoaded
): Promise<BuildSelection> {
  const saved = readBuildSelection(context);
  const base = normalizeBuildSelection(manifest, saved);
  return writeBuildSelection(context, { ...base, modelId, presetId: saved?.presetId });
}

/**
 * Selects a new target, preserving existing model and component when valid.
 * Normalizes the complete selection before writing.
 */
export async function selectTarget(
  context: vscode.ExtensionContext,
  targetId: string,
  manifest: ManifestStateLoaded
): Promise<BuildSelection> {
  const saved = readBuildSelection(context);
  const base = normalizeBuildSelection(manifest, saved);
  return writeBuildSelection(context, { ...base, targetId, presetId: saved?.presetId });
}

/**
 * Selects a new component, preserving existing model and target when valid.
 * Normalizes the complete selection before writing.
 */
export async function selectComponent(
  context: vscode.ExtensionContext,
  componentId: string,
  manifest: ManifestStateLoaded
): Promise<BuildSelection> {
  const saved = readBuildSelection(context);
  const base = normalizeBuildSelection(manifest, saved);
  return writeBuildSelection(context, { ...base, componentId, presetId: saved?.presetId });
}

/**
 * Selects a new active preset, preserving existing model/target/component
 * when valid. Normalizes the manifest axes before writing, mirroring
 * `selectModel`/`selectTarget`/`selectComponent`.
 */
export async function selectPreset(
  context: vscode.ExtensionContext,
  presetId: string,
  manifest: ManifestStateLoaded
): Promise<BuildSelection> {
  const base = normalizeBuildSelection(manifest, readBuildSelection(context));
  return writeBuildSelection(context, { ...base, presetId });
}

// ---------------------------------------------------------------------------
// Restore helper
// ---------------------------------------------------------------------------

/**
 * Reads the persisted build selection, normalizes it against `manifest`
 * and, when known, `knownPresetIds` — the ids the preset files declare —
 * writes back if anything was stale, and returns the resulting valid config.
 *
 * `knownPresetIds` is `undefined` while preset state is invalid; in that
 * case the saved preset id is preserved unresolved and never
 * triggers a write on its own.
 *
 * Use this at activation time and on every manifest or preset state change
 * to keep the workspace-state selection in sync.
 */
export async function restoreBuildSelection(
  context: vscode.ExtensionContext,
  manifest: ManifestStateLoaded,
  knownPresetIds?: ReadonlySet<string>
): Promise<BuildSelection> {
  const saved = readBuildSelection(context);
  const normalized = normalizeBuildSelection(manifest, saved);
  const savedPresetId = activePresetId(saved);
  const normalizedPresetId = normalizePresetId(savedPresetId, knownPresetIds);

  const changed =
    !saved ||
    saved.modelId !== normalized.modelId ||
    saved.targetId !== normalized.targetId ||
    saved.componentId !== normalized.componentId ||
    savedPresetId !== normalizedPresetId;

  if (changed) {
    return writeBuildSelection(context, { ...normalized, presetId: normalizedPresetId });
  }
  return saved;
}
