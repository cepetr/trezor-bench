/**
 * The Start Debugging command handler: resolves the debug profile for the
 * active build context (with a QuickPick when several match), builds the
 * tbench proxy debug configuration, and starts it via the VS Code debug API.
 * The template machinery lives in debug/debug-template.ts.
 */

import * as vscode from "vscode";
import { ManifestComponentDebugProfile, ManifestStateLoaded, findManifestEntries } from "../manifest/manifest-types";
import { BuildContext } from "../manifest/manifest-types";
import {
  MatchingDebugProfileSet,
  resolveMatchingDebugProfiles,
} from "../manifest/debug-profiles";
import { logDebugLaunchFailure, notifyError, revealLogs } from "../observability/log-channel";
import { makeContextKey } from "../build/artifact-resolution";

// ---------------------------------------------------------------------------
// Proxy debug configuration identity
// ---------------------------------------------------------------------------

export const TBENCH_DEBUG_TYPE = "tbench";

/**
 * Builds a display label for the default tbench Run and Debug entry.
 * Format: "Trezor Bench"
 */
export function labelForDefaultEntry(): string {
  return "Trezor Bench";
}

/**
 * Builds a display label for a profile-specific Run and Debug entry.
 * Format: "Trezor Bench: {profile-name}"
 */
export function labelForProfileEntry(profileName: string): string {
  return `Trezor Bench: ${profileName}`;
}

// ---------------------------------------------------------------------------
// Proxy debug configuration and QuickPick types
// ---------------------------------------------------------------------------

interface DebugProfileQuickPickItem extends vscode.QuickPickItem {
  readonly profile: ManifestComponentDebugProfile;
}

export interface TbenchProxyDebugConfiguration extends vscode.DebugConfiguration {
  readonly tbenchMode: "default" | "profile";
  readonly tbenchProfileId: string;
  readonly tbenchContextKey: string;
}


async function pickDebugProfile(
  matchingSet: MatchingDebugProfileSet
): Promise<ManifestComponentDebugProfile | undefined> {
  const items: DebugProfileQuickPickItem[] = matchingSet.profiles.map((profile) => ({
    label: profile.name,
    profile,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    title: "Select Debug Profile",
    placeHolder: "Choose a debug profile for the active build context",
    ignoreFocusOut: true,
  });

  return selected?.profile;
}

/**
 * Builds the tbench proxy debug configuration for one profile — the shape
 * shared by the Start Debugging command and the Run and Debug entries the
 * provider generates.
 */
export function buildTbenchProxyDebugConfiguration(
  buildContext: BuildContext,
  profile: ManifestComponentDebugProfile,
  mode: "default" | "profile"
): TbenchProxyDebugConfiguration {
  return {
    type: TBENCH_DEBUG_TYPE,
    request: "launch",
    name: mode === "default" ? labelForDefaultEntry() : labelForProfileEntry(profile.name),
    tbenchMode: mode,
    tbenchProfileId: profile.id,
    tbenchContextKey: makeContextKey(buildContext),
  };
}

function reportDebugLaunchFailure(
  reason: Parameters<typeof logDebugLaunchFailure>[0],
  buildContext: BuildContext,
  message: string,
  detail?: string
): void {
  logDebugLaunchFailure(reason, {
    modelId: buildContext.modelId,
    targetId: buildContext.targetId,
    componentId: buildContext.componentId,
    ...(detail === undefined ? {} : { detail }),
  });
  revealLogs();
  notifyError(message);
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * Executes the Start Debugging flow for the active build context.
 *
 * On each invocation:
 *  1. Validates manifest debug state and resolves the selected debug profile.
 *  2. Builds a tbench proxy debug configuration for the selected profile.
 *  3. Starts it via `vscode.debug.startDebugging`. The registered tbench debug
 *     provider materializes the real debugger configuration — resolving the
 *     executable artifact and debug template — so VS Code can keep the selected
 *     Run and Debug entry in sync.
 *
 * All blocked states (no-match, missing executable, template
 * errors, variable errors) surface an error message and return early.
 * Persistent output-channel logging records blocked and failed debug launches.
 */
export async function executeDebugLaunch(
  workspaceFolder: vscode.WorkspaceFolder,
  manifest: ManifestStateLoaded,
  buildContext: BuildContext
): Promise<void> {
  // 1. Validate manifest debug state
  if (manifest.hasDebugBlockingIssues) {
    reportDebugLaunchFailure(
      "manifest-invalid",
      buildContext,
      "Cannot start debugging: the manifest has debug profile validation errors.",
      "manifest has debug profile validation errors"
    );
    return;
  }

  // 2. Find selected component and target
  const entries = findManifestEntries(manifest, buildContext);
  if (!entries) {
    reportDebugLaunchFailure(
      "unknown-build-selection",
      buildContext,
      "Cannot start debugging: active configuration references an unknown component, target, or model.",
      "active configuration references an unknown component, target, or model"
    );
    return;
  }
  const { component } = entries;

  // 3. Resolve component debug profile (first-match declaration order = default profile)
  const profiles = component.debug ?? [];
  const matchingSet = resolveMatchingDebugProfiles(profiles, buildContext);

  if (!matchingSet.defaultProfile) {
    reportDebugLaunchFailure(
      "no-match",
      buildContext,
      "Cannot start debugging: no debug profile matches the active build context."
    );
    return;
  }

  let profile: ManifestComponentDebugProfile | undefined = matchingSet.defaultProfile;

  if (matchingSet.profiles.length > 1) {
    profile = await pickDebugProfile(matchingSet);
    if (!profile) {
      return;
    }
  }

  const selectedProfile = profile as ManifestComponentDebugProfile;

  const launchMode: "default" | "profile" =
    matchingSet.defaultProfile.id === selectedProfile.id ? "default" : "profile";
  const proxyConfiguration = buildTbenchProxyDebugConfiguration(
    buildContext,
    selectedProfile,
    launchMode
  );

  // 4. Launch via VS Code debug API using the tbench proxy configuration.
  const launched = await vscode.debug.startDebugging(
    workspaceFolder,
    proxyConfiguration
  );

  if (!launched) {
    reportDebugLaunchFailure(
      "start-failed",
      buildContext,
      "Debugging failed to start."
    );
    return;
  }

  await vscode.commands.executeCommand("workbench.view.debug");
}
