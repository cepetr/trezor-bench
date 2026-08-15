/**
 * Run and Debug configuration provider.
 *
 * Generates dynamic tbench-owned proxy debug configurations for the active
 * build context and resolves them into real debug configurations at launch time.
 *
 * Proxy configuration shape:
 *   { type: "tbench", request: "launch", name: string,
 *     tbenchMode: "default" | "profile",
 *     tbenchProfileId: string, tbenchContextKey: string }
 *
 * Resolution replaces the proxy with the template-derived real configuration.
 */

import * as vscode from "vscode";
import { ManifestStateLoaded, activeManifestEntries } from "../manifest/manifest-types";
import { ActiveBuildContext } from "../configuration/active-build-context";
import {
  resolveMatchingDebugProfiles,
  materializeDebugConfiguration,
  MatchingDebugProfileSet,
  TBENCH_DEBUG_TYPE,
  labelForDefaultEntry,
  labelForProfileEntry,
} from "../commands/debug-launch";

export { TBENCH_DEBUG_TYPE, labelForDefaultEntry, labelForProfileEntry };
import { makeContextKey, resolveActiveExecutableArtifact } from "../intellisense/artifact-resolution";
import { EvalContext } from "../manifest/when-expressions";
import { logProviderDebugLaunchFailure, notifyError, revealLogs } from "../observability/log-channel";

function dedupeDebugConfigurations(
  configs: ReadonlyArray<vscode.DebugConfiguration>
): vscode.DebugConfiguration[] {
  const unique = new Map<string, vscode.DebugConfiguration>();

  for (const config of configs) {
    const key = [
      config.type,
      config.request,
      config.name,
      String(config["tbenchMode"] ?? ""),
      String(config["tbenchProfileId"] ?? ""),
      String(config["tbenchContextKey"] ?? ""),
    ].join("::");
    if (!unique.has(key)) {
      unique.set(key, config);
    }
  }

  return [...unique.values()];
}

// ---------------------------------------------------------------------------
// Entry set generation
// ---------------------------------------------------------------------------

/**
 * Generates the tbench Run and Debug configuration entries for the active
 * build context.
 *
 * Returns a default entry when at least one profile matches and the executable
 * artifact exists. Additionally returns one profile-specific entry per matching
 * profile when more than one profile matches.
 */
export function generateDebugConfigurations(
  manifest: ManifestStateLoaded,
  config: ActiveBuildContext,
  artifactsRoot: string
): vscode.DebugConfiguration[] {
  if (manifest.hasDebugBlockingIssues) {
    return [];
  }

  const entries = activeManifestEntries(manifest, config);
  if (!entries) {
    return [];
  }

  const evalCtx: EvalContext = {
    modelId: config.modelId,
    targetId: config.targetId,
    componentId: config.componentId,
  };

  const matchingSet: MatchingDebugProfileSet = resolveMatchingDebugProfiles(
    entries.component.debug ?? [],
    evalCtx
  );

  if (!matchingSet.defaultProfile) {
    return [];
  }

  // Check executable artifact existence before generating entries
  const executableArtifact = resolveActiveExecutableArtifact(manifest, config, artifactsRoot);
  if (executableArtifact.status !== "valid") {
    return [];
  }

  const contextKey = makeContextKey(config);
  const configs: vscode.DebugConfiguration[] = [];

  // Default entry (always when any matching profiles and valid executable)
  const defaultConfig: vscode.DebugConfiguration = {
    type: TBENCH_DEBUG_TYPE,
    request: "launch",
    name: labelForDefaultEntry(),
    tbenchMode: "default",
    tbenchProfileId: matchingSet.defaultProfile.id,
    tbenchContextKey: contextKey,
  };
  configs.push(defaultConfig);

  // Profile-specific entries (only when more than one profile matches)
  if (matchingSet.profiles.length > 1) {
    for (const profile of matchingSet.profiles) {
      const profileConfig: vscode.DebugConfiguration = {
        type: TBENCH_DEBUG_TYPE,
        request: "launch",
        name: labelForProfileEntry(profile.name),
        tbenchMode: "profile",
        tbenchProfileId: profile.id,
        tbenchContextKey: contextKey,
      };
      configs.push(profileConfig);
    }
  }

  return dedupeDebugConfigurations(configs);
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

/**
 * VS Code Debug Configuration Provider for tbench proxy configurations.
 *
 * Registered with TriggerKind.Dynamic so Run and Debug shows generated
 * entries for the active build context.
 */
export class RunDebugConfigProvider implements vscode.DebugConfigurationProvider {
  private readonly _getManifest: () => ManifestStateLoaded | undefined;
  private readonly _getActiveBuildContext: () => ActiveBuildContext | undefined;
  private readonly _getArtifactsRoot: () => string;
  private readonly _getTemplatesRoot: () => string;
  private readonly _workspaceFolder: vscode.WorkspaceFolder;

  constructor(
    getManifest: () => ManifestStateLoaded | undefined,
    getActiveBuildContext: () => ActiveBuildContext | undefined,
    getArtifactsRoot: () => string,
    getTemplatesRoot: () => string,
    workspaceFolder: vscode.WorkspaceFolder
  ) {
    this._getManifest = getManifest;
    this._getActiveBuildContext = getActiveBuildContext;
    this._getArtifactsRoot = getArtifactsRoot;
    this._getTemplatesRoot = getTemplatesRoot;
    this._workspaceFolder = workspaceFolder;
  }

  /**
   * Provides tbench-generated debug configurations for Run and Debug.
   * Called when VS Code populates the Run and Debug picker.
   */
  provideDebugConfigurations(
    _folder: vscode.WorkspaceFolder | undefined,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration[]> {
    const manifest = this._getManifest();
    const config = this._getActiveBuildContext();

    if (!manifest || !config) {
      return [];
    }

    return generateDebugConfigurations(manifest, config, this._getArtifactsRoot());
  }

  /**
   * Resolves a tbench proxy configuration by materializing the selected
   * debug profile into a real VS Code debug configuration.
   *
   * Called before VS Code variable substitution so tbench variables are
   * resolved first; non-tbench variables (e.g. ${workspaceFolder}) are
   * left intact for VS Code to process.
   */
  resolveDebugConfiguration(
    _folder: vscode.WorkspaceFolder | undefined,
    debugConfiguration: vscode.DebugConfiguration,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DebugConfiguration> {
    if (debugConfiguration.type !== TBENCH_DEBUG_TYPE) {
      return debugConfiguration;
    }

    const manifest = this._getManifest();
    const config = this._getActiveBuildContext();

    if (!manifest || !config) {
      const msg = "Cannot start debugging: manifest not loaded or no active configuration.";
      logProviderDebugLaunchFailure("manifest-unavailable", { detail: msg });
      revealLogs();
      notifyError(msg);
      return undefined;
    }

    // Stale-context check for generated dynamic entries.
    const expectedContextKey = debugConfiguration["tbenchContextKey"] as string | undefined;
    const currentContextKey = makeContextKey(config);
    if (expectedContextKey !== currentContextKey) {
      const msg =
        "Cannot start debugging: the active build context has changed since this Run and Debug entry was generated. " +
        "Refresh Run and Debug to get updated entries.";
      logProviderDebugLaunchFailure("stale-context", {
        modelId: config.modelId,
        targetId: config.targetId,
        componentId: config.componentId,
        detail: `expected ${expectedContextKey}, got ${currentContextKey}`,
      });
      revealLogs();
      notifyError(msg);
      return undefined;
    }

    const profileId = debugConfiguration["tbenchProfileId"] as string | undefined;
    const component = manifest.components.find((c) => c.id === config.componentId);
    const profile = component?.debug?.find((p) => p.id === profileId);

    if (!profile) {
      const msg = `Cannot start debugging: selected debug profile '${profileId ?? ""}' is no longer available.`;
      logProviderDebugLaunchFailure("profile-not-found", {
        modelId: config.modelId,
        targetId: config.targetId,
        componentId: config.componentId,
        detail: `profileId '${profileId ?? ""}' not found`,
      });
      revealLogs();
      notifyError(msg);
      return undefined;
    }

    // Materialize the real debug configuration
    const result = materializeDebugConfiguration(
      this._workspaceFolder,
      manifest,
      config,
      this._getArtifactsRoot(),
      this._getTemplatesRoot(),
      profile
    );

    if (!result.ok) {
      logProviderDebugLaunchFailure(result.reason, {
        modelId: config.modelId,
        targetId: config.targetId,
        componentId: config.componentId,
        detail: result.detail,
      });
      revealLogs();
      notifyError(result.message);
      return undefined;
    }

    const canonicalName =
      debugConfiguration["tbenchMode"] === "profile"
        ? labelForProfileEntry(profile.name)
        : labelForDefaultEntry();

    const resolvedConfiguration: vscode.DebugConfiguration = {
      ...(result.configuration as vscode.DebugConfiguration),
      name: canonicalName,
    };

    // Return real config; VS Code applies its variable substitution next.
    return resolvedConfiguration;
  }
}
