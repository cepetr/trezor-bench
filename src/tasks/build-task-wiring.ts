/**
 * Wires the build-task integration: registers the tbench task provider,
 * which reaches the extension-owned build state through explicit getters,
 * and the end-of-task listener that refreshes build artifacts after a
 * successful workflow task.
 */
import * as vscode from "vscode";
import {
  BuildTaskProvider,
  BuildTaskProviderDependencies,
  isSuccessfulArtifactRefreshTaskProcess,
  TASK_TYPE,
} from "./build-task-provider";

/** Callbacks through which the wiring reaches extension-owned state. */
export interface BuildTaskWiringDeps extends BuildTaskProviderDependencies {
  /** Refreshes build artifacts after a successful workflow task. */
  refreshBuildArtifacts: () => void;
}

/**
 * Registers the tbench task provider and the artifact-refreshing
 * end-of-task listener on the extension context.
 */
export function registerBuildTaskWiring(
  context: vscode.ExtensionContext,
  deps: BuildTaskWiringDeps
): void {
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider(TASK_TYPE, new BuildTaskProvider(deps)),
    vscode.tasks.onDidEndTaskProcess((event) => {
      if (isSuccessfulArtifactRefreshTaskProcess(event)) {
        deps.refreshBuildArtifacts();
      }
    })
  );
}
