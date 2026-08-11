import * as vscode from "vscode";
import { ManifestStateLoaded } from "../manifest/manifest-types";
import { normalizeActiveConfig, normalizePresetId } from "./normalize-config";
import { DEFAULT_PRESET_ID } from "../presets/preset-types";

// Active configuration storage key in workspace state
export const ACTIVE_CONFIG_KEY = "tbench.activeConfig";

export { DEFAULT_PRESET_ID };

export interface ActiveConfig {
  readonly modelId: string;
  readonly targetId: string;
  readonly componentId: string;
  /**
   * Active preset id, `"default"` for the synthetic choice. Optional so
   * records persisted before this feature deserialize without loss; absent
   * is read as `DEFAULT_PRESET_ID` via `activePresetId`.
   */
  readonly presetId?: string;
  readonly persistedAt: string; // ISO timestamp
}

/** Reads the active preset id, defaulting to `DEFAULT_PRESET_ID` when absent. */
export function activePresetId(config: ActiveConfig | undefined): string {
  return config?.presetId ?? DEFAULT_PRESET_ID;
}

/**
 * Reads the saved active configuration from workspace state.
 * Returns undefined when no configuration has been saved yet.
 */
export function readActiveConfig(
  context: vscode.ExtensionContext
): ActiveConfig | undefined {
  return context.workspaceState.get<ActiveConfig>(ACTIVE_CONFIG_KEY);
}

/**
 * Persists the active configuration to workspace state.
 */
export async function writeActiveConfig(
  context: vscode.ExtensionContext,
  config: Omit<ActiveConfig, "persistedAt">
): Promise<ActiveConfig> {
  const saved: ActiveConfig = { ...config, persistedAt: new Date().toISOString() };
  await context.workspaceState.update(ACTIVE_CONFIG_KEY, saved);
  return saved;
}

/**
 * Validates that all ids in `candidate` resolve to entries in `manifest`.
 * Returns false when any id is absent from its collection.
 */
export function isConfigValid(
  candidate: ActiveConfig,
  manifest: ManifestStateLoaded
): boolean {
  return (
    manifest.models.some((m) => m.id === candidate.modelId) &&
    manifest.targets.some((t) => t.id === candidate.targetId) &&
    manifest.components.some((c) => c.id === candidate.componentId)
  );
}

// ---------------------------------------------------------------------------
// Selector mutation helpers
// ---------------------------------------------------------------------------

/**
 * Selects a new model, preserving existing target and component when valid.
 * Normalizes the complete configuration before writing.
 */
export async function selectModel(
  context: vscode.ExtensionContext,
  modelId: string,
  manifest: ManifestStateLoaded
): Promise<ActiveConfig> {
  const saved = readActiveConfig(context);
  const base = normalizeActiveConfig(manifest, saved);
  return writeActiveConfig(context, { ...base, modelId, presetId: saved?.presetId });
}

/**
 * Selects a new target, preserving existing model and component when valid.
 * Normalizes the complete configuration before writing.
 */
export async function selectTarget(
  context: vscode.ExtensionContext,
  targetId: string,
  manifest: ManifestStateLoaded
): Promise<ActiveConfig> {
  const saved = readActiveConfig(context);
  const base = normalizeActiveConfig(manifest, saved);
  return writeActiveConfig(context, { ...base, targetId, presetId: saved?.presetId });
}

/**
 * Selects a new component, preserving existing model and target when valid.
 * Normalizes the complete configuration before writing.
 */
export async function selectComponent(
  context: vscode.ExtensionContext,
  componentId: string,
  manifest: ManifestStateLoaded
): Promise<ActiveConfig> {
  const saved = readActiveConfig(context);
  const base = normalizeActiveConfig(manifest, saved);
  return writeActiveConfig(context, { ...base, componentId, presetId: saved?.presetId });
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
): Promise<ActiveConfig> {
  const base = normalizeActiveConfig(manifest, readActiveConfig(context));
  return writeActiveConfig(context, { ...base, presetId });
}

// ---------------------------------------------------------------------------
// Restore helper
// ---------------------------------------------------------------------------

/**
 * Reads the persisted active configuration, normalizes it against `manifest`
 * and, when known, `knownPresetIds` — the ids the preset files declare —
 * writes back if anything was stale, and returns the resulting valid config.
 *
 * `knownPresetIds` is `undefined` while preset state is invalid; in that
 * case the saved preset id is preserved unresolved (FR-031) and never
 * triggers a write on its own.
 *
 * Use this at activation time and on every manifest or preset state change
 * to keep the workspace-state selection in sync.
 */
export async function restoreActiveConfig(
  context: vscode.ExtensionContext,
  manifest: ManifestStateLoaded,
  knownPresetIds?: ReadonlySet<string>
): Promise<ActiveConfig> {
  const saved = readActiveConfig(context);
  const normalized = normalizeActiveConfig(manifest, saved);
  const savedPresetId = activePresetId(saved);
  const normalizedPresetId = normalizePresetId(savedPresetId, knownPresetIds);

  const changed =
    !saved ||
    saved.modelId !== normalized.modelId ||
    saved.targetId !== normalized.targetId ||
    saved.componentId !== normalized.componentId ||
    savedPresetId !== normalizedPresetId;

  if (changed) {
    return writeActiveConfig(context, { ...normalized, presetId: normalizedPresetId });
  }
  return saved;
}
