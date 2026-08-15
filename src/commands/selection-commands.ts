/**
 * Registration for the build-context selector commands
 * (model/target/component/preset) and the build-option
 * toggle/select-state commands — everything the Configuration panes'
 * rows invoke to change the active selection.
 */
import * as vscode from "vscode";
import { ManifestStateLoaded } from "../manifest/manifest-types";
import {
  selectModel,
  selectTarget,
  selectComponent,
  selectPreset,
} from "../build/build-selection";
import { writeBuildOption } from "../build/build-options";
import { CommandDeps } from "./command-deps";

/**
 * Registers the four selector commands and the two build-option commands.
 * Each selection also re-normalizes the active preset against the new
 * build context via `deps.refreshPresetOptions()`. All selectors share
 * the same guard and post-selection refresh chain.
 */
export function registerSelectionCommands(
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

  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.toggleBuildOption", async (key: string) => {
      const resolved = deps.getResolvedOptions().find((r) => r.option.key === key);
      if (!resolved || !resolved.available || resolved.option.kind !== "checkbox") {
        return;
      }
      const newValue = resolved.value !== true;
      await writeBuildOption(context, key, newValue);
      deps.refreshResolvedOptionsView();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tbench.selectBuildOptionState",
      async (key: string, stateId: string) => {
        const resolved = deps.getResolvedOptions().find((r) => r.option.key === key);
        if (!resolved || !resolved.available || resolved.option.kind !== "multistate") {
          return;
        }
        if (!resolved.option.states?.some((s) => s.id === stateId)) {
          return;
        }
        await writeBuildOption(context, key, stateId);
        deps.refreshResolvedOptionsView();
      }
    )
  );
}
