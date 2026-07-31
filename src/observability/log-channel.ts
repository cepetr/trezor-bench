import * as vscode from "vscode";
import { ManifestState } from "../manifest/manifest-types";
import { PresetState } from "../presets/preset-types";

const CHANNEL_NAME = "Trezor Firmware Tools";
let _channel: vscode.OutputChannel | undefined;

/**
 * Returns the shared output channel, creating it on first call.
 */
export function getLogChannel(): vscode.OutputChannel {
  if (!_channel) {
    _channel = vscode.window.createOutputChannel(CHANNEL_NAME);
  }
  return _channel;
}

/**
 * Creates the output channel and writes an activation marker.
 * Call once at the start of extension activation.
 */
export function initLogChannel(): void {
  log("Trezor Firmware Tools extension activated.");
}

/**
 * Appends a timestamped log line to the output channel.
 */
export function log(message: string): void {
  const ts = new Date().toISOString();
  getLogChannel().appendLine(`[${ts}] ${message}`);
}

/**
 * Appends a log line and also shows a VS Code warning notification.
 */
export function logWarning(message: string): void {
  log(`[WARN] ${message}`);
  vscode.window.showWarningMessage(message);
}

/**
 * Appends a log line and also shows a VS Code error notification.
 */
export function logError(message: string): void {
  log(`[ERROR] ${message}`);
  vscode.window.showErrorMessage(message);
}

/**
 * Reveals the output channel in the panel.
 */
export function revealLogs(): void {
  getLogChannel().show(true);
}

/**
 * Disposes the output channel. Call on extension deactivation.
 */
export function disposeLogChannel(): void {
  _channel?.dispose();
  _channel = undefined;
}

// ---------------------------------------------------------------------------
// Manifest state logging
// ---------------------------------------------------------------------------

/**
 * Logs a human-readable description of the new manifest state.
 * Does NOT show user notifications — that is done by the caller.
 */
export function logManifestState(state: ManifestState): void {
  const path = state.manifestUri.fsPath;
  switch (state.status) {
    case "loaded":
      log(
        `Manifest loaded: ${path} — ` +
          `${(state as Extract<ManifestState, { status: "loaded" }>).models.length} model(s), ` +
          `${(state as Extract<ManifestState, { status: "loaded" }>).targets.length} target(s), ` +
          `${(state as Extract<ManifestState, { status: "loaded" }>).components.length} component(s)`
      );
      break;
    case "missing":
      log(`[WARN] Manifest missing: ${path}`);
      break;
    case "invalid": {
      const issues = (state as Extract<ManifestState, { status: "invalid" }>)
        .validationIssues;
      log(`[ERROR] Manifest invalid: ${path} — ${issues.length} issue(s)`);
      for (const issue of issues) {
        log(`  [${issue.severity}] ${issue.message} (${issue.code})`);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Preset state logging (feature 009)
// ---------------------------------------------------------------------------

/**
 * Logs a human-readable description of the new preset state: load results
 * for a `loaded` state, or the offending file(s) and issues for `invalid`.
 */
export function logPresetState(state: PresetState): void {
  const describe = (label: string, file: PresetState["shared"]): string =>
    file.present ? `${label}=${file.uri.fsPath} (${file.names.length} preset(s))` : `${label}=(absent)`;

  switch (state.status) {
    case "loaded":
      log(`Presets loaded: ${describe("shared", state.shared)}, ${describe("user", state.user)}`);
      for (const issue of state.validationIssues) {
        log(`  [${issue.severity}] ${issue.message} (${issue.code})`);
      }
      break;
    case "invalid": {
      const offending = [state.shared, state.user]
        .filter((f) => f.issues.some((i) => i.severity === "error"))
        .map((f) => f.uri.fsPath);
      log(
        `[ERROR] Presets invalid: ${offending.join(", ")} — ${state.validationIssues.length} issue(s)`
      );
      for (const issue of state.validationIssues) {
        log(`  [${issue.severity}] ${issue.message} (${issue.code})`);
      }
      break;
    }
  }
}

/**
 * Logs an active-preset normalization: the saved preset id changed because
 * it became unavailable for the active build context or preset data
 * changed (spec `Failure Modes & Diagnostics`).
 */
export function logPresetNormalization(previousPresetId: string, normalizedPresetId: string): void {
  log(
    `Active preset normalized from "${previousPresetId}" to "${normalizedPresetId}": ` +
      `it is no longer available for the active build context, or preset data changed.`
  );
}

/**
 * Logs the discarding of explicit build-option overrides that follows an
 * active-preset change (FR-017). Always paired with a visible Build Options
 * refresh, so the log is the persistent record of a visible action.
 */
export function logOverridesClearedForPreset(
  previousPresetId: string,
  newPresetId: string,
  clearedKeys: ReadonlyArray<string>
): void {
  if (clearedKeys.length === 0) {
    return;
  }
  log(
    `Active preset changed from "${previousPresetId}" to "${newPresetId}": ` +
      `discarded ${clearedKeys.length} build-option override(s) — ${clearedKeys.join(", ")}. ` +
      `Build Options now show the new preset's calculated values.`
  );
}

/** Keys already logged as unknown-to-the-manifest, to avoid repeat entries. */
const _loggedUnknownPresetKeys = new Set<string>();

/**
 * Logs, once per key, an informational entry for a preset option key that no
 * manifest build option claims (research Decision 5). Never blocks and never
 * produces a diagnostic — this is observability only.
 */
export function logUnknownPresetKeys(keys: ReadonlyArray<string>): void {
  const fresh = keys.filter((k) => !_loggedUnknownPresetKeys.has(k));
  if (fresh.length === 0) {
    return;
  }
  fresh.forEach((k) => _loggedUnknownPresetKeys.add(k));
  log(`Preset option key(s) not recognized by the manifest (ignored): ${fresh.join(", ")}`);
}

// ---------------------------------------------------------------------------
// Workflow failure logging
// ---------------------------------------------------------------------------

/**
 * Logs a persistent failure record for a blocked or failed workflow action.
 */
export function logWorkflowFailure(kind: string, message: string): void {
  log(`[ERROR] Workflow ${kind} blocked/failed: ${message}`);
}

/**
 * Logs a persistent failure record for a blocked Flash or Upload action.
 */
export function logArtifactActionBlocked(actionName: string, detail: string): void {
  log(`[ERROR] ${actionName} blocked — ${detail}`);
}

// ---------------------------------------------------------------------------
// Debug launch failure logging
// ---------------------------------------------------------------------------

/**
 * Logs a persistent output-channel entry for a blocked or failed debug launch.
 * Called from executeDebugLaunch before each early-return error path.
 */
export function logDebugLaunchFailure(
  reason: string,
  context: { modelId?: string; targetId?: string; componentId?: string; detail?: string } = {}
): void {
  const ctx = [context.modelId, context.targetId, context.componentId].filter(Boolean).join("/");
  const detail = context.detail ? ` — ${context.detail}` : "";
  log(`[DEBUG-LAUNCH-FAILURE] ${reason}${ctx ? ` [${ctx}]` : ""}${detail}`);
}

// ---------------------------------------------------------------------------
// IntelliSense event logging
// ---------------------------------------------------------------------------

/**
 * Logs a persistent output-channel entry for a blocked or failed debug launch
 * originating from the tf-tools Run and Debug provider rather than a direct command.
 * Includes a "[PROVIDER]" tag to distinguish provider launches from direct command launches.
 */
export function logProviderDebugLaunchFailure(
  reason: string,
  context: { modelId?: string; targetId?: string; componentId?: string; detail?: string } = {}
): void {
  const ctx = [context.modelId, context.targetId, context.componentId].filter(Boolean).join("/");
  const detail = context.detail ? ` — ${context.detail}` : "";
  log(`[DEBUG-LAUNCH-FAILURE] [PROVIDER] ${reason}${ctx ? ` [${ctx}]` : ""}${detail}`);
}


export function logMissingArtifact(expectedPath: string, contextKey: string): void {
  log(
    `[IntelliSense] Compile-commands artifact missing for context ${contextKey}: expected at ${expectedPath}`
  );
}

/**
 * Writes a persistent log entry for a provider warning condition (missing or
 * wrong provider). Also shows a visible VS Code warning notification so the
 * condition is not silent.
 */
export function logProviderWarning(message: string): void {
  log(`[IntelliSense] [WARN] ${message}`);
  vscode.window.showWarningMessage(message);
}

/**
 * Writes a persistent log entry when provider prerequisites are recovered after
 * a previous warning state. Does NOT show a notification — recovery is silent.
 */
export function logProviderRecovery(): void {
  log("[IntelliSense] Provider prerequisites satisfied. IntelliSense is now active.");
}

