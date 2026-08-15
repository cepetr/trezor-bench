/**
 * Single-root workspace guards gating extension activation and commands.
 */
import * as vscode from "vscode";

/**
 * Returns the first workspace folder, or throws when the extension is
 * activated outside a single-root workspace. Callers should handle the error
 * with a visible failure message.
 */
export function requireWorkspaceFolder(): vscode.WorkspaceFolder {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error(
      "Trezor Bench requires an open workspace folder. Please open a folder and try again."
    );
  }
  return folders[0];
}

/**
 * Returns true when the extension is running inside a single-root workspace.
 */
export function hasSupportedWorkspace(): boolean {
  const folders = vscode.workspace.workspaceFolders;
  return folders !== undefined && folders.length > 0;
}

/**
 * Returns true when the workspace is supported for Build Workflow.
 * Build Workflow requires exactly one open workspace folder.
 * - No folders: unsupported
 * - More than one folder: unsupported (multi-root)
 * - Exactly one folder: supported
 */
export function isWorkflowWorkspaceSupported(): boolean {
  const folders = vscode.workspace.workspaceFolders;
  return folders !== undefined && folders.length === 1;
}
