import * as vscode from "vscode";
import * as path from "path";
import {
  resolveConfigurationVariables,
  resolveConfigurationVariablesDeep,
} from "./configuration-variables";

/**
 * Expands configuration variables and resolves the result to an absolute path.
 * Relative paths are joined to the workspace folder root.
 */
function resolveConfiguredPath(
  raw: string | undefined,
  workspaceFolder: vscode.WorkspaceFolder,
  defaultRelative?: string
): string {
  const source = raw?.trim() || defaultRelative?.trim() || "";
  const expanded = resolveConfigurationVariables(source, workspaceFolder).trim();
  if (!expanded) {
    return workspaceFolder.uri.fsPath;
  }
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  return vscode.Uri.joinPath(workspaceFolder.uri, expanded).fsPath;
}

/**
 * Returns the manifest path setting for the given workspace folder, resolved
 * to an absolute URI. Falls back to `core/embed/xtask/tf-tools/manifest.yaml`
 * under the workspace root.
 */
export function resolveManifestUri(
  workspaceFolder: vscode.WorkspaceFolder
): vscode.Uri {
  const cfg = vscode.workspace.getConfiguration("tfTools", workspaceFolder.uri);
  const relative: string | undefined = cfg.get<string>("manifestPath");
  return vscode.Uri.file(
    resolveConfiguredPath(relative, workspaceFolder, "core/embed/xtask/tf-tools/manifest.yaml")
  );
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
  if (!relative?.trim()) {
    return workspaceFolder.uri.fsPath;
  }
  return resolveConfiguredPath(relative, workspaceFolder);
}

/**
 * Returns extra environment variables to merge into tf-tools task processes.
 * Uses `tfTools.taskExtraEnv` when set; returns an empty object when absent.
 * String keys and values support VS Code variable references.
 */
export function readTaskExtraEnv(
  workspaceFolder: vscode.WorkspaceFolder
): Readonly<Record<string, string>> {
  const cfg = vscode.workspace.getConfiguration("tfTools", workspaceFolder.uri);
  const raw = cfg.get<Record<string, string>>("taskExtraEnv") ?? {};
  return resolveConfigurationVariablesDeep(raw, workspaceFolder);
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
  if (!value?.trim()) {
    return "";
  }
  return resolveConfiguredPath(value, workspaceFolder);
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
    fileNamePatterns: resolveConfigurationVariablesDeep(
      cfg.get<string[]>("excludedFiles.fileNamePatterns") ?? ["*.c"],
      workspaceFolder
    ),
    folderGlobs: resolveConfigurationVariablesDeep(
      cfg.get<string[]>("excludedFiles.folderGlobs") ?? ["core/embed/**", "core/vendor/**"],
      workspaceFolder
    ),
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
  return resolveConfiguredPath(value, workspaceFolder, "core/embed/xtask/tf-tools/debug");
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
