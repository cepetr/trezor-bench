import * as vscode from "vscode";
import { ValidationSeverity, ManifestState } from "../manifest/manifest-types";
import { PresetState } from "../presets/preset-types";
import { RepositoryConfigurationState } from "../workspace/repository-configuration";

// ---------------------------------------------------------------------------
// Diagnostic collection
// ---------------------------------------------------------------------------

/** Reusable diagnostic collection for manifest validation problems. */
let _collection: vscode.DiagnosticCollection | undefined;

/**
 * Returns the shared manifest diagnostic collection, creating it on first call.
 * The returned collection is registered with the extension context disposables.
 */
export function getDiagnosticCollection(): vscode.DiagnosticCollection {
  if (!_collection) {
    _collection = vscode.languages.createDiagnosticCollection("tbench");
  }
  return _collection;
}

/** The minimal issue shape needed to publish a diagnostic. */
export interface DiagnosticIssue {
  readonly message: string;
  readonly code: string;
  readonly range?: vscode.Range;
  /** Treated as `"error"` when absent. */
  readonly severity?: ValidationSeverity;
}

/**
 * Publishes `issues` as VS Code diagnostics attached to `uri`.
 * Clears any previous diagnostics on `uri` before publishing.
 */
export function publishDiagnostics(
  uri: vscode.Uri,
  issues: ReadonlyArray<DiagnosticIssue>
): void {
  const collection = getDiagnosticCollection();
  const diagnostics = issues.map((issue) => {
    const range = issue.range ?? new vscode.Range(0, 0, 0, 0);
    const severity =
      (issue.severity ?? "error") === "error"
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning;
    const diagnostic = new vscode.Diagnostic(range, issue.message, severity);
    diagnostic.source = "tbench";
    diagnostic.code = issue.code;
    return diagnostic;
  });
  collection.set(uri, diagnostics);
}

/**
 * Clears all diagnostics for `uri`.
 */
export function clearDiagnostics(uri: vscode.Uri): void {
  getDiagnosticCollection().delete(uri);
}

/**
 * Disposes the diagnostic collection. Call on extension deactivation.
 */
export function disposeDiagnostics(): void {
  _collection?.dispose();
  _collection = undefined;
}

// ---------------------------------------------------------------------------
// Manifest state → diagnostics
// ---------------------------------------------------------------------------

/**
 * Translates a `ManifestState` to VS Code diagnostics.
 *
 * - `loaded`: publishes all validation issues (including error-level
 *   `invalid-when` issues that block Build Workflow); publishing an empty
 *   list clears any previous diagnostics.
 * - `invalid`: publishes all validation issues as diagnostics.
 * - `missing`: clears all diagnostics for the manifest URI (the missing state
 *   is communicated through notifications and log output, not diagnostics).
 */
export function handleManifestStateDiagnostics(state: ManifestState): void {
  switch (state.status) {
    case "loaded":
    case "invalid":
      publishDiagnostics(state.manifestUri, state.validationIssues);
      break;
    case "missing":
      clearDiagnostics(state.manifestUri);
      break;
  }
}

// ---------------------------------------------------------------------------
// Preset state → diagnostics
// ---------------------------------------------------------------------------

/**
 * Translates a `PresetState` to VS Code diagnostics, attributed to the URI
 * of the file that produced each issue (shared vs. user). Ranges use the
 * `headerLine`-anchored range attached at parse time when present, and
 * `publishDiagnostics` already falls back to `Range(0,0,0,0)` otherwise
 * (research Decision 15).
 *
 * `unavailable` clears both instead: the shared file does not exist, so there
 * is no content to anchor a diagnostic to. That state is communicated through
 * the `Preset` selector and log output, mirroring `manifest-missing` (FR-027).
 */
export function handlePresetStateDiagnostics(state: PresetState): void {
  if (state.status === "unavailable") {
    clearDiagnostics(state.shared.uri);
    clearDiagnostics(state.user.uri);
    return;
  }
  publishDiagnostics(state.shared.uri, state.shared.issues);
  publishDiagnostics(state.user.uri, state.user.issues);
}

/** Publishes or clears diagnostics for the root repository configuration file. */
export function handleRepositoryConfigurationDiagnostics(
  state: RepositoryConfigurationState
): void {
  if (state.status !== "invalid") {
    clearDiagnostics(state.configuration.configurationUri);
    return;
  }
  publishDiagnostics(state.configurationUri, state.validationIssues);
}
