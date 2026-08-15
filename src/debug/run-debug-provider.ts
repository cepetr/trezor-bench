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
import { ManifestStateLoaded, findManifestEntries } from "../manifest/manifest-types";
import {
  resolveMatchingDebugProfiles,
  materializeDebugConfiguration,
  MatchingDebugProfileSet,
  TBENCH_DEBUG_TYPE,
  labelForDefaultEntry,
  labelForProfileEntry,
} from "../commands/debug-launch";

export { TBENCH_DEBUG_TYPE, labelForDefaultEntry, labelForProfileEntry };
import { makeContextKey, resolveExecutableArtifact } from "../intellisense/artifact-resolution";
import { BuildContext } from "../manifest/manifest-types";
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
  buildContext: BuildContext,
  artifactsRoot: string
): vscode.DebugConfiguration[] {
  if (manifest.hasDebugBlockingIssues) {
    return [];
  }

  const entries = findManifestEntries(manifest, buildContext);
  if (!entries) {
    return [];
  }


  const matchingSet: MatchingDebugProfileSet = resolveMatchingDebugProfiles(
    entries.component.debug ?? [],
    buildContext
  );

  if (!matchingSet.defaultProfile) {
    return [];
  }

  // Check executable artifact existence before generating entries
  const executableArtifact = resolveExecutableArtifact(manifest, buildContext, artifactsRoot);
  if (executableArtifact.status !== "valid") {
    return [];
  }

  const contextKey = makeContextKey(buildContext);
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
  private readonly _getBuildContext: () => BuildContext | undefined;
  private readonly _getArtifactsRoot: () => string;
  private readonly _getTemplatesRoot: () => string;
  private readonly _workspaceFolder: vscode.WorkspaceFolder;

  constructor(
    getManifest: () => ManifestStateLoaded | undefined,
    getBuildContext: () => BuildContext | undefined,
    getArtifactsRoot: () => string,
    getTemplatesRoot: () => string,
    workspaceFolder: vscode.WorkspaceFolder
  ) {
    this._getManifest = getManifest;
    this._getBuildContext = getBuildContext;
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
    const buildContext = this._getBuildContext();

    if (!manifest || !buildContext) {
      return [];
    }

    return generateDebugConfigurations(manifest, buildContext, this._getArtifactsRoot());
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
    const buildContext = this._getBuildContext();

    if (!manifest || !buildContext) {
      const msg = "Cannot start debugging: manifest not loaded or no active configuration.";
      logProviderDebugLaunchFailure("manifest-unavailable", { detail: msg });
      revealLogs();
      notifyError(msg);
      return undefined;
    }

    // Stale-context check for generated dynamic entries.
    const expectedContextKey = debugConfiguration["tbenchContextKey"] as string | undefined;
    const currentContextKey = makeContextKey(buildContext);
    if (expectedContextKey !== currentContextKey) {
      const msg =
        "Cannot start debugging: the active build context has changed since this Run and Debug entry was generated. " +
        "Refresh Run and Debug to get updated entries.";
      logProviderDebugLaunchFailure("stale-context", {
        modelId: buildContext.modelId,
        targetId: buildContext.targetId,
        componentId: buildContext.componentId,
        detail: `expected ${expectedContextKey}, got ${currentContextKey}`,
      });
      revealLogs();
      notifyError(msg);
      return undefined;
    }

    const profileId = debugConfiguration["tbenchProfileId"] as string | undefined;
    const component = manifest.components.find((c) => c.id === buildContext.componentId);
    const profile = component?.debug?.find((p) => p.id === profileId);

    if (!profile) {
      const msg = `Cannot start debugging: selected debug profile '${profileId ?? ""}' is no longer available.`;
      logProviderDebugLaunchFailure("profile-not-found", {
        modelId: buildContext.modelId,
        targetId: buildContext.targetId,
        componentId: buildContext.componentId,
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
      buildContext,
      this._getArtifactsRoot(),
      this._getTemplatesRoot(),
      profile
    );

    if (!result.ok) {
      logProviderDebugLaunchFailure(result.reason, {
        modelId: buildContext.modelId,
        targetId: buildContext.targetId,
        componentId: buildContext.componentId,
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

    // Return the real debug configuration; VS Code applies its variable substitution next.
    return resolvedConfiguration;
  }
}
