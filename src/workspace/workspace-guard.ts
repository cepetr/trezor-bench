/**
 * Workspace guard gating extension activation and commands.
 */
import * as vscode from "vscode";

/**
 * Returns true when at least one workspace folder is open.
 */
export function hasSupportedWorkspace(): boolean {
  const folders = vscode.workspace.workspaceFolders;
  return folders !== undefined && folders.length > 0;
}
