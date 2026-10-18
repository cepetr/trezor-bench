/**
 * Selects the one workspace folder the extension works against when several
 * folders are open. Selection looks only at whether marker files exist; it
 * never reads them.
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { REPOSITORY_CONFIG_FILE, REPOSITORY_PATH_DEFAULTS } from "./repository-config";

export type FolderSelectionReason = "repository-config" | "default-manifest" | "fallback";

export interface FolderSelection {
  folder: vscode.WorkspaceFolder;
  reason: FolderSelectionReason;
}

/**
 * Picks the first folder (in workspace order) whose root holds `tbench.toml`,
 * else the first whose root holds the default manifest path, else the first
 * folder. Returns undefined when no folder is open.
 */
export function selectWorkspaceFolder(
  folders: readonly vscode.WorkspaceFolder[] | undefined,
  exists: (fsPath: string) => boolean = fs.existsSync
): FolderSelection | undefined {
  if (!folders || folders.length === 0) {
    return undefined;
  }
  const withMarker = (marker: string) =>
    folders.find((folder) => exists(path.join(folder.uri.fsPath, marker)));

  const configured = withMarker(REPOSITORY_CONFIG_FILE);
  if (configured) {
    return { folder: configured, reason: "repository-config" };
  }
  const defaultManifest = withMarker(REPOSITORY_PATH_DEFAULTS.manifest);
  if (defaultManifest) {
    return { folder: defaultManifest, reason: "default-manifest" };
  }
  return { folder: folders[0], reason: "fallback" };
}

export function isSameFolder(a: vscode.WorkspaceFolder, b: vscode.WorkspaceFolder): boolean {
  return a.uri.toString() === b.uri.toString();
}

export function describeFolderSelectionReason(reason: FolderSelectionReason): string {
  switch (reason) {
    case "repository-config":
      return "tbench.toml found";
    case "default-manifest":
      return "default manifest found";
    case "fallback":
      return "no folder qualified; using the first folder";
  }
}
