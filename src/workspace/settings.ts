/**
 * Typed accessors for tbench extension settings (status bar, task
 * environment, excluded files).
 */
import * as vscode from "vscode";
import {
  resolveSettingsVariablesDeep,
} from "./settings-variables";

/**
 * Returns true when status-bar visibility is enabled for the workspace.
 */
export function isStatusBarEnabled(
  workspaceFolder: vscode.WorkspaceFolder
): boolean {
  const cfg = vscode.workspace.getConfiguration("tbench", workspaceFolder.uri);
  return cfg.get<boolean>("showConfigurationInStatusBar") ?? true;
}

/**
 * Returns extra environment variables to merge into tbench task processes.
 * Uses `tbench.taskExtraEnv` when set; returns an empty object when absent.
 * String keys and values support VS Code variable references.
 */
export function readTaskExtraEnv(
  workspaceFolder: vscode.WorkspaceFolder
): Readonly<Record<string, string>> {
  const cfg = vscode.workspace.getConfiguration("tbench", workspaceFolder.uri);
  const raw = cfg.get<unknown>("taskExtraEnv") ?? {};

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const resolved = resolveSettingsVariablesDeep(
    raw as Record<string, unknown>,
    workspaceFolder
  ) as Record<string, unknown>;

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  return env;
}

// ---------------------------------------------------------------------------
// Excluded-file visibility settings
// ---------------------------------------------------------------------------

/**
 * Normalized excluded-file settings derived from all four resource-scoped
 * `tbench.excludedFiles.*` preferences.
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
 * Reads the four `tbench.excludedFiles.*` settings for the given workspace
 * folder and returns a normalized snapshot. Defaults match the contract:
 *   grayInTree = true, showEditorOverlay = true,
 *   fileNamePatterns = ["*.c"], folderGlobs = ["core/embed/**", "core/vendor/**"]
 */
export function readExcludedFilesSettings(
  workspaceFolder: vscode.WorkspaceFolder
): ExcludedFilesSettings {
  const cfg = vscode.workspace.getConfiguration("tbench", workspaceFolder.uri);
  return {
    grayInTree: cfg.get<boolean>("excludedFiles.grayInTree") ?? true,
    showEditorOverlay: cfg.get<boolean>("excludedFiles.showEditorOverlay") ?? true,
    fileNamePatterns: resolveSettingsVariablesDeep(
      cfg.get<string[]>("excludedFiles.fileNamePatterns") ?? ["*.c"],
      workspaceFolder
    ),
    folderGlobs: resolveSettingsVariablesDeep(
      cfg.get<string[]>("excludedFiles.folderGlobs") ?? ["core/embed/**", "core/vendor/**"],
      workspaceFolder
    ),
  };
}

