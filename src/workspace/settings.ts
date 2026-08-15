/**
 * Typed accessors for tbench settings and repository-configuration-derived
 * paths (manifest, artifacts, presets, debug templates, excluded files).
 */
import * as vscode from "vscode";
import {
  resolveConfigurationVariablesDeep,
} from "./configuration-variables";
import { getRepositoryConfiguration } from "./repository-configuration";

/**
 * Returns the manifest URI for the given workspace folder, resolved from the
 * `[paths].manifest` entry in the root-level `tbench.toml`. Falls back to
 * `core/embed/xtask/tf-tools/manifest.yaml` under the workspace root.
 */
export function resolveManifestUri(
  workspaceFolder: vscode.WorkspaceFolder
): vscode.Uri {
  return getRepositoryConfiguration(workspaceFolder).manifestUri;
}

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
 * Returns the cargo workspace directory for the given workspace folder,
 * resolved from the `[paths].cargo-workspace` entry in the root-level
 * `tbench.toml`. Defaults to `core/embed` under the workspace root; an empty
 * value resolves to the workspace root itself.
 */
export function resolveCargoWorkspacePath(
  workspaceFolder: vscode.WorkspaceFolder
): string {
  return getRepositoryConfiguration(workspaceFolder).cargoWorkspacePath;
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

  const resolved = resolveConfigurationVariablesDeep(
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

/**
 * Returns the resolved absolute artifacts root path for the given workspace
 * folder, from the `[paths].build-artifacts` entry in the root-level
 * `tbench.toml`. Defaults to `core/build-xtask/artifacts` under the workspace
 * root; an empty value returns an empty string, which disables artifact-based
 * resolution.
 */
export function resolveArtifactsPath(
  workspaceFolder: vscode.WorkspaceFolder
): string {
  return getRepositoryConfiguration(workspaceFolder).artifactsPath;
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
// Debug launch settings
// ---------------------------------------------------------------------------

/**
 * Returns the resolved absolute path to the debug templates directory for the
 * given workspace folder, from the `[paths].debug-templates` entry in the
 * root-level `tbench.toml`. Defaults to `core/embed/xtask/tf-tools/debug`
 * under the workspace root.
 */
export function resolveDebugTemplatesPath(
  workspaceFolder: vscode.WorkspaceFolder
): string {
  return getRepositoryConfiguration(workspaceFolder).debugTemplatesPath;
}

// ---------------------------------------------------------------------------
// Preset input path resolution
// ---------------------------------------------------------------------------

/** Resolved locations of the two preset TOML inputs for a workspace folder. */
export interface PresetUris {
  readonly shared: vscode.Uri;
  readonly user: vscode.Uri;
}

/**
 * Resolves both preset input URIs from the configured `xtask-presets` directory
 * by appending `presets.toml` and `user-presets.toml`.
 */
export function resolvePresetUris(workspaceFolder: vscode.WorkspaceFolder): PresetUris {
  return getRepositoryConfiguration(workspaceFolder).presetUris;
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
    event.affectsConfiguration("tbench.excludedFiles.grayInTree", scope) ||
    event.affectsConfiguration("tbench.excludedFiles.showEditorOverlay", scope) ||
    event.affectsConfiguration("tbench.excludedFiles.fileNamePatterns", scope) ||
    event.affectsConfiguration("tbench.excludedFiles.folderGlobs", scope)
  );
}
