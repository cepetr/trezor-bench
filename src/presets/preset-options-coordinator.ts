/**
 * Owns the preset/build-option recomputation state: the preset-effective
 * values, the preset context of the last refresh, the preset-blocked flags,
 * and the resolved build options. Everything here is derived state — the
 * persisted inputs live in workspaceState and the preset files, and the
 * surrounding manifest/preset/selection state is reached through the
 * `PresetOptionsDeps` surface handed in by the composition root.
 */
import * as vscode from "vscode";
import {
  derivePresetContext,
  samePresetContext,
  shiftedPresetOptionKeys,
  listPresetChoices,
  computePresetEffectiveValues,
  PresetChoice,
  PresetContext,
  PresetEffectiveValue,
} from "./preset-resolution";
import { PresetState } from "./preset-types";
import {
  restoreBuildSelection,
  readBuildSelection,
  activePresetId,
  BuildSelection,
} from "../build/build-selection";
import { normalizeBuildSelection } from "../build/normalize-selection";
import {
  readBuildOptions,
  dropBuildOptionOverrides,
  normalizeBuildOptions,
  ResolvedOption,
} from "../build/build-options";
import {
  ManifestState,
  BuildContext,
  loadedManifest,
} from "../manifest/manifest-types";
import {
  logPresetNormalization,
  logOverridesPrunedForPreset,
  logOverridesPrunedForContext,
} from "../observability/log-channel";

/**
 * The dependency surface the coordinator receives from the composition root
 * (extension.ts): read access to the surrounding state via getters, the
 * setter through which the coordinator publishes the restored/normalized
 * build selection, and the pane-refresh callbacks.
 */
export interface PresetOptionsDeps {
  getManifestState(): ManifestState | undefined;
  getPresetState(): PresetState | undefined;
  getBuildSelection(): BuildSelection | undefined;
  /** Publishes the selection `refresh()` restored and normalized. */
  setBuildSelection(selection: BuildSelection): void;
  /** Refreshes the Build Selection and Build Options panes. */
  updateTree(
    state: ManifestState,
    buildContext: BuildContext | undefined,
    resolvedOptions: ReadonlyArray<ResolvedOption>
  ): void;
  /** Refreshes the `Preset` selector. */
  updatePresets(
    state: PresetState | undefined,
    activePresetId: string | undefined,
    choices: ReadonlyArray<PresetChoice>
  ): void;
}

/**
 * Computes the resolved build options for the given manifest state, active
 * configuration, current persisted selections, and preset-effective values.
 * Returns an empty array when the manifest is not loaded or no active
 * configuration is available.
 */
function computeResolvedOptions(
  state: ManifestState,
  buildContext: BuildContext | undefined,
  context: vscode.ExtensionContext,
  presetEffectiveValues: ReadonlyMap<string, PresetEffectiveValue> = new Map()
): ResolvedOption[] {
  const manifest = loadedManifest(state);
  if (!manifest || !buildContext) {
    return [];
  }
  const saved = readBuildOptions(context);
  return normalizeBuildOptions(manifest.buildOptions, saved, buildContext, presetEffectiveValues);
}

export class PresetOptionsCoordinator {
  private _effectiveValues: ReadonlyMap<string, PresetEffectiveValue> = new Map();
  /**
   * The preset context the last refresh resolved against. Held beside the
   * build selection — the two are always written together — so a refresh can tell
   * whether the calculated values every stored override was authored against
   * still hold. `undefined` until the first refresh with a loaded
   * manifest, which is what keeps activation from wiping a restored session.
   */
  private _presetContext: PresetContext | undefined;
  /**
   * Backs the `tbench.presetBlocked` context key (an absent shared
   * `presets.toml`, file-level invalidity, or any available-option mismatch).
   */
  private _blocked = false;
  /**
   * True only for the absent shared `presets.toml`. Tracked separately
   * from `_blocked` so the launch path can report the more specific
   * `presets-unavailable` reason; it always implies `_blocked`.
   */
  private _unavailable = false;
  private _resolvedOptions: ReadonlyArray<ResolvedOption> = [];

  constructor(private readonly _deps: PresetOptionsDeps) {}

  get presetBlocked(): boolean {
    return this._blocked;
  }

  get presetsUnavailable(): boolean {
    return this._unavailable;
  }

  get resolvedOptions(): ReadonlyArray<ResolvedOption> {
    return this._resolvedOptions;
  }

  /** Recomputes the resolved options against the current effective values. */
  recomputeResolvedOptions(
    state: ManifestState,
    buildContext: BuildContext | undefined,
    context: vscode.ExtensionContext
  ): void {
    this._resolvedOptions = computeResolvedOptions(state, buildContext, context, this._effectiveValues);
  }

  /** Clears the state derived from a loaded manifest (manifest unloaded). */
  resetForUnloadedManifest(): void {
    this._presetContext = undefined;
    this._resolvedOptions = [];
  }

  /** Clears the resolved options (invalid repository configuration). */
  clearResolvedOptions(): void {
    this._resolvedOptions = [];
  }

  /**
   * Recomputes the declared preset list and preset-effective build-option values
   * against the current manifest, active build context, and preset state;
   * normalizes and persists the active preset id when it changed; drops, when
   * the active preset or the preset context changed, exactly those explicit
   * build-option overrides whose calculated value moved with it;
   * and refreshes the `Preset` selector and Build Options.
   * The single entry point for every preset-relevant
   * trigger: activation, preset-state change, manifest-state change, and
   * active model/target/component change.
   */
  async refresh(context: vscode.ExtensionContext): Promise<void> {
    const manifest = loadedManifest(this._deps.getManifestState());
    if (!manifest) {
      this._effectiveValues = new Map();
      this._blocked = false;
      this._unavailable = false;
      vscode.commands.executeCommand("setContext", "tbench.presetBlocked", false);
      this._deps.updatePresets(this._deps.getPresetState(), undefined, []);
      return;
    }

    const savedAxes = normalizeBuildSelection(manifest, readBuildSelection(context));
    const presetCtx = derivePresetContext(manifest, savedAxes);

    const currentPresetState = this._deps.getPresetState();
    const presets = currentPresetState?.status === "loaded" ? currentPresetState : undefined;

    // The choice list depends on the two preset files alone: every declared
    // preset is offered whatever the build context, so `knownIds` only
    // ever retires an id the files no longer declare.
    let choices: PresetChoice[] = [];
    let knownIds: Set<string> | undefined;
    if (presets) {
      choices = listPresetChoices(presets.shared, presets.user);
      knownIds = new Set(choices.map((p) => p.id));
    }

    const previousSelection = this._deps.getBuildSelection();
    const previousPresetId = previousSelection ? activePresetId(previousSelection) : undefined;
    const previousPresetContext = this._presetContext;
    const normalizedConfig = await restoreBuildSelection(context, manifest, knownIds);
    const newPresetId = activePresetId(normalizedConfig);

    const presetIdChanged = previousPresetId !== undefined && previousPresetId !== newPresetId;
    const presetContextChanged =
      previousPresetContext !== undefined && !samePresetContext(previousPresetContext, presetCtx);

    if (presetIdChanged) {
      logPresetNormalization(previousPresetId!, newPresetId);
    }

    this._effectiveValues = presets
      ? computePresetEffectiveValues(manifest.buildOptions, presets.shared, presets.user, newPresetId, presetCtx)
      : new Map();

    if (presets && (presetIdChanged || presetContextChanged)) {
      // An override is authored against a calculated value, and that value is a
      // function of the (active preset, preset context) pair: fragments carry
      // `when = { model, project, emulator }` filters, so both the [[defaults]]
      // layer and the named-preset layer can calculate differently in a
      // different context. So a change to either half is where overrides have to
      // be re-examined — but only per option, and against the same preset files:
      // recalculate what the previous pair produced, and drop exactly the
      // overrides whose value moved. Those would otherwise silently shadow the
      // new calculation, with no way to clear it for a checkbox; the rest still
      // say what the user asked for and are kept. Both change guards
      // require a known previous half, which is what keeps activation from
      // pruning the selections it just restored, and an unloaded preset state
      // never prunes because it can calculate neither side.
      const previousEffective = computePresetEffectiveValues(
        manifest.buildOptions,
        presets.shared,
        presets.user,
        previousPresetId ?? newPresetId,
        previousPresetContext ?? presetCtx
      );
      const shifted = shiftedPresetOptionKeys(previousEffective, this._effectiveValues);
      const dropped = await dropBuildOptionOverrides(context, shifted);
      const kept = Object.keys(readBuildOptions(context)?.values ?? {});
      if (presetIdChanged) {
        logOverridesPrunedForPreset(previousPresetId!, newPresetId, dropped, kept);
      } else {
        logOverridesPrunedForContext(previousPresetContext!, presetCtx, dropped, kept);
      }
    }

    this._deps.setBuildSelection(normalizedConfig);
    this._presetContext = presetCtx;
    this._resolvedOptions = computeResolvedOptions(manifest, normalizedConfig, context, this._effectiveValues);

    this._unavailable = currentPresetState?.status === "unavailable";
    this._blocked =
      this._unavailable ||
      currentPresetState?.status === "invalid" ||
      this._resolvedOptions.some((r) => r.available && r.presetState === "mismatch");
    vscode.commands.executeCommand("setContext", "tbench.presetBlocked", this._blocked);

    this._deps.updateTree(manifest, normalizedConfig, this._resolvedOptions);
    this._deps.updatePresets(currentPresetState, newPresetId, choices);
  }
}
