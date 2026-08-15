/**
 * Registration for the build-context selector commands
 * (model/target/component/preset) — the handlers wiring the selection
 * logic in build/build-selection.ts to the VS Code command surface.
 */
import * as vscode from "vscode";
import { ManifestStateLoaded } from "../manifest/manifest-types";
import {
  selectModel,
  selectTarget,
  selectComponent,
  selectPreset,
} from "../build/build-selection";
import { CommandDeps } from "./command-deps";

/**
 * Registers the four selector commands. Each selection also re-normalizes
 * the active preset against the new build context via
 * `deps.refreshPresetOptions()`. All selectors share the same guard and
 * post-selection refresh chain.
 */
export function registerBuildSelectionCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const registerSelector = (
    command: string,
    apply: (id: string, state: ManifestStateLoaded) => Promise<unknown>
  ): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async (id: string) => {
        const state = deps.getManifestState();
        if (!state || state.status !== "loaded") { return; }
        await apply(id, state);
        await deps.refreshPresetOptions();
        deps.refreshStatusBar();
        deps.setIntelliSenseBuildContext();
        deps.refreshArtifactFileWatcher();
        deps.refreshBuildArtifacts("build-selection-change");
      })
    );
  };

  registerSelector("tbench.selectModel", (id, state) => selectModel(context, id, state));
  registerSelector("tbench.selectTarget", (id, state) => selectTarget(context, id, state));
  registerSelector("tbench.selectComponent", (id, state) => selectComponent(context, id, state));
  // Preset selector: not a contributed command — invoked only
  // through the Preset selector's tree-item command binding.
  registerSelector("tbench.selectPreset", (id, state) => selectPreset(context, id, state));
}
