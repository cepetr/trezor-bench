/**
 * Pure preset resolution: PresetContext derivation and preset availability.
 *
 * specs/009-build-preset-support/data-model.md §2
 */
import { ManifestStateLoaded } from "../manifest/manifest-types";
import { ActiveConfig } from "../configuration/active-config";
import { PresetFile, PresetFilter, PresetFragment, DEFAULT_PRESET_ID } from "./preset-types";

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
  activeConfig: ActiveConfig
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
