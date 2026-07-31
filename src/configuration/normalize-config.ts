import { ManifestStateLoaded } from "../manifest/manifest-types";
import { ActiveConfig } from "./active-config";
import { DEFAULT_PRESET_ID } from "../presets/preset-types";

/**
 * Returns a valid active configuration for `manifest`.
 *
 * When `saved` is provided, each id is preserved if it still resolves to an
 * entry in the manifest; otherwise it is replaced with the first entry of that
 * kind.  When `saved` is absent every slot defaults to the first manifest
 * entry for that kind.
 *
 * The returned object contains only the id fields — callers are responsible
 * for writing the result to workspace state via `writeActiveConfig`.
 */
export function normalizeActiveConfig(
  manifest: ManifestStateLoaded,
  saved?: ActiveConfig
): Pick<ActiveConfig, "modelId" | "targetId" | "componentId"> {
  const modelId =
    saved && manifest.models.some((m) => m.id === saved.modelId)
      ? saved.modelId
      : manifest.models[0].id;

  const targetId =
    saved && manifest.targets.some((t) => t.id === saved.targetId)
      ? saved.targetId
      : manifest.targets[0].id;

  const componentId =
    saved && manifest.components.some((c) => c.id === saved.componentId)
      ? saved.componentId
      : manifest.components[0].id;

  return { modelId, targetId, componentId };
}

/**
 * Normalizes a saved preset id against the currently available preset ids.
 *
 * - `availableIds === undefined` (preset state invalid) → the saved id is
 *   returned unchanged; FR-031 forbids resolving it while data is invalid.
 * - a saved id present in `availableIds` → kept (FR-008, Scenario 1.6).
 * - any other saved id → normalized to `DEFAULT_PRESET_ID` (FR-008, Scenario 1.4).
 */
export function normalizePresetId(
  savedId: string,
  availableIds: ReadonlySet<string> | undefined
): string {
  if (availableIds === undefined) {
    return savedId;
  }
  if (availableIds.has(savedId)) {
    return savedId;
  }
  return DEFAULT_PRESET_ID;
}
