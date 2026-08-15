/**
 * Registration for the tbench.startDebugging command — the handler wiring
 * the Debug Launch flow in debug-launch.ts to the VS Code command surface
 * via CommandDeps.
 */
import * as vscode from "vscode";
import { loadedManifest } from "../manifest/manifest-types";
import { logDebugLaunchFailure, notifyError, revealLogs } from "../observability/log-channel";
import { executeDebugLaunch } from "./debug-launch";
import { CommandDeps } from "./command-deps";
/**
 * Registers the tbench.startDebugging command (Debug Launch slice).
 */
export function registerDebugLaunchCommand(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.startDebugging", async () => {
      const state = deps.getManifestState();
      const config = deps.getBuildSelection();
      const manifest = loadedManifest(state);
      if (!manifest || !config) {
        logDebugLaunchFailure("unsupported-workspace", {
          detail: "manifest not loaded or no active configuration",
        });
        revealLogs();
        notifyError("Cannot start debugging: manifest not loaded.");
        return;
      }
      await executeDebugLaunch(deps.workspaceFolder, manifest, config);
    })
  );
}
