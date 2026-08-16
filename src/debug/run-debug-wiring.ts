/**
 * Wires the Run and Debug integration: registers the dynamic tbench debug
 * configuration provider, which reaches the extension-owned build state
 * through explicit getters.
 */
import * as vscode from "vscode";
import { ManifestStateLoaded, BuildContext } from "../manifest/manifest-types";
import { RunDebugConfigProvider, TBENCH_DEBUG_TYPE } from "./run-debug-provider";

/** Getters through which the provider reads extension-owned build state. */
export interface RunDebugWiringDeps {
  /** Returns the loaded manifest, or undefined while unloaded. */
  getManifest: () => ManifestStateLoaded | undefined;
  /** Returns the active build context, or undefined when none is selected. */
  getBuildContext: () => BuildContext | undefined;
  /** Resolves the artifacts root from the repository configuration. */
  getArtifactsRoot: () => string;
  /** Resolves the debug-templates root from the repository configuration. */
  getTemplatesRoot: () => string;
}

/**
 * Registers the dynamic Run and Debug configuration provider on the
 * extension context.
 */
export function registerRunDebugProvider(
  context: vscode.ExtensionContext,
  deps: RunDebugWiringDeps
): void {
  const provider = new RunDebugConfigProvider(
    deps.getManifest,
    deps.getBuildContext,
    deps.getArtifactsRoot,
    deps.getTemplatesRoot
  );
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      TBENCH_DEBUG_TYPE,
      provider,
      vscode.DebugConfigurationProviderTriggerKind.Dynamic
    )
  );
}
