import { RustAnalyzerConfigService } from "./config-service";
import { RustAnalyzerInputs } from "./config-service";
import { BuildSelection, activePresetId } from "../build/build-selection";
import { deriveOptionFlags, ResolvedOption } from "../build/build-options";
import { ManifestStateLoaded } from "../manifest/manifest-types";

export function startRustAnalyzerConfiguration(service: RustAnalyzerConfigService): void {
  service.restoreMode();
  void service.refresh();
}

export async function stopRustAnalyzerConfiguration(service: RustAnalyzerConfigService): Promise<void> {
  await service.dispose();
}

export function deriveRustAnalyzerInputs(
  manifest: ManifestStateLoaded | undefined,
  selection: BuildSelection | undefined,
  resolvedOptions: ReadonlyArray<ResolvedOption>
): RustAnalyzerInputs | undefined {
  if (!manifest || !selection) {
    return undefined;
  }
  const target = manifest.targets.find((entry) => entry.id === selection.targetId);
  if (!target) {
    return undefined;
  }
  const emulator = target.flag === "--emulator" || target.flag === "-e";
  return {
    modelId: selection.modelId,
    targetId: selection.targetId,
    emulator,
    targetFlag: emulator ? target.flag ?? undefined : undefined,
    presetId: activePresetId(selection),
    effectiveFlags: deriveOptionFlags(resolvedOptions),
  };
}

export function refreshRustAnalyzerConfiguration(
  service: RustAnalyzerConfigService,
  manifest: ManifestStateLoaded | undefined,
  selection: BuildSelection | undefined,
  resolvedOptions: ReadonlyArray<ResolvedOption>
): void {
  if (service.setInputs(deriveRustAnalyzerInputs(manifest, selection, resolvedOptions))) {
    void service.refresh();
  }
}