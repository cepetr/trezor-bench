import * as vscode from "vscode";
import * as path from "path";

/**
 * Returns the manifest path setting for the given workspace folder, resolved
 * to an absolute URI. Falls back to `core/embed/xtask/tf-tools/manifest.yaml`
 * under the workspace root.
 */
export function resolveManifestUri(
  workspaceFolder: vscode.WorkspaceFolder
): vscode.Uri {
  const cfg = vscode.workspace.getConfiguration("tfTools", workspaceFolder.uri);
  const relative: string = cfg.get<string>("manifestPath") || "core/embed/xtask/tf-tools/manifest.yaml";
  return vscode.Uri.joinPath(workspaceFolder.uri, relative);
}

/**
 * Returns true when status-bar visibility is enabled for the workspace.
 */
export function isStatusBarEnabled(
  workspaceFolder: vscode.WorkspaceFolder
): boolean {
  const cfg = vscode.workspace.getConfiguration("tfTools", workspaceFolder.uri);
  return cfg.get<boolean>("showConfigurationInStatusBar") ?? true;
}

/**
 * Returns the cargo workspace directory for the given workspace folder.
 * Uses `tfTools.cargoWorkspacePath` when set; falls back to the workspace
 * folder root so the extension works without explicit configuration.
 */
export function resolveCargoWorkspacePath(
  workspaceFolder: vscode.WorkspaceFolder
): string {
  const cfg = vscode.workspace.getConfiguration("tfTools", workspaceFolder.uri);
  const relative: string | undefined = cfg.get<string>("cargoWorkspacePath");
  if (relative && relative.trim()) {
    return vscode.Uri.joinPath(workspaceFolder.uri, relative.trim()).fsPath;
  }
  return workspaceFolder.uri.fsPath;
}

/**
 * Returns the resolved absolute artifacts root path for the given workspace folder.
 * Uses `tfTools.artifactsPath` when set (resolved relative to the workspace root
 * when it is not an absolute path); returns an empty string when the setting is absent.
 */
export function resolveArtifactsPath(
  workspaceFolder: vscode.WorkspaceFolder
): string {
  const cfg = vscode.workspace.getConfiguration("tfTools", workspaceFolder.uri);
  const value: string | undefined = cfg.get<string>("artifactsPath");
  if (!value || !value.trim()) {
    return "";
  }
  const trimmed = value.trim();
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  return vscode.Uri.joinPath(workspaceFolder.uri, trimmed).fsPath;
}

// ---------------------------------------------------------------------------
// Excluded-file visibility settings (feature 004)
// ---------------------------------------------------------------------------

/**
 * Normalized excluded-file settings derived from all four resource-scoped
 * `tfTools.excludedFiles.*` preferences.
 */
export interface ExcludedFilesSettings {
  /** Gray excluded entries in the Explorer tree (in addition to the badge). */
  readonly grayInTree: boolean;
  /** Show a first-line warning overlay in open excluded editors. */
  readonly showEditorOverlay: boolean;
  /**
   * Basename-only, case-sensitive glob patterns for eligible filenames.
   * An empty array disables excluded-file marking for the filename dimension.
   */
  readonly fileNamePatterns: ReadonlyArray<string>;
  /**
   * Case-sensitive folder glob patterns (absolute or workspace-relative).
   * An empty array disables excluded-file marking for the folder dimension.
   */
  readonly folderGlobs: ReadonlyArray<string>;
}

/**
 * Reads the four `tfTools.excludedFiles.*` settings for the given workspace
 * folder and returns a normalized snapshot. Defaults match the contract:
 *   grayInTree = true, showEditorOverlay = true,
 *   fileNamePatterns = ["*.c"], folderGlobs = ["core/embed/**", "core/vendor/**"]
 */
export function readExcludedFilesSettings(
  workspaceFolder: vscode.WorkspaceFolder
): ExcludedFilesSettings {
  const cfg = vscode.workspace.getConfiguration("tfTools", workspaceFolder.uri);
  return {
    grayInTree: cfg.get<boolean>("excludedFiles.grayInTree") ?? true,
    showEditorOverlay: cfg.get<boolean>("excludedFiles.showEditorOverlay") ?? true,
    fileNamePatterns: cfg.get<string[]>("excludedFiles.fileNamePatterns") ?? ["*.c"],
    folderGlobs: cfg.get<string[]>("excludedFiles.folderGlobs") ?? ["core/embed/**", "core/vendor/**"],
  };
}

// ---------------------------------------------------------------------------
// Debug launch settings (feature 006)
// ---------------------------------------------------------------------------

/**
 * Returns the resolved absolute path to the debug templates directory for the
 * given workspace folder. Uses `tfTools.debug.templatesPath` when set (resolved
 * relative to the workspace root when it is not an absolute path); falls back to
 * the default `"core/embed/xtask/tf-tools/debug"` joined to the workspace root.
 */
export function resolveDebugTemplatesPath(
  workspaceFolder: vscode.WorkspaceFolder
): string {
  const cfg = vscode.workspace.getConfiguration("tfTools", workspaceFolder.uri);
  const value: string | undefined = cfg.get<string>("debug.templatesPath");
  const relative = value && value.trim() ? value.trim() : "core/embed/xtask/tf-tools/debug";
  if (path.isAbsolute(relative)) {
    return relative;
  }
  return vscode.Uri.joinPath(workspaceFolder.uri, relative).fsPath;
}

/**
 * Returns true when a configuration change event affects any of the four
 * excluded-file settings for the given workspace folder.
 */
export function excludedFilesSettingsChanged(
  event: vscode.ConfigurationChangeEvent,
  workspaceFolder: vscode.WorkspaceFolder
): boolean {
  const scope = workspaceFolder.uri;
  return (
    event.affectsConfiguration("tfTools.excludedFiles.grayInTree", scope) ||
    event.affectsConfiguration("tfTools.excludedFiles.showEditorOverlay", scope) ||
    event.affectsConfiguration("tfTools.excludedFiles.fileNamePatterns", scope) ||
    event.affectsConfiguration("tfTools.excludedFiles.folderGlobs", scope)
  );
}
