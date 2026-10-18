/**
 * Reacts to workspace-folder list changes: keeps running when the selected
 * folder is still the one selection picks, and otherwise reports the change
 * once so the composition root can release the folder.
 */
import * as vscode from "vscode";
import { FolderSelection, isSameFolder, selectWorkspaceFolder } from "./folder-selection";

export type FolderChangeOutcome = "unchanged" | { next: FolderSelection | undefined };

/**
 * Re-runs folder selection over `folders` and compares the result with the
 * folder the extension is bound to.
 */
export function evaluateFolderChange(
  current: vscode.WorkspaceFolder,
  folders: readonly vscode.WorkspaceFolder[] | undefined,
  exists?: (fsPath: string) => boolean
): FolderChangeOutcome {
  const next = selectWorkspaceFolder(folders, exists);
  return next && isSameFolder(next.folder, current) ? "unchanged" : { next };
}

export interface FolderChangeHandlers {
  /** The same folder is still selected. */
  onUnchanged(): void;
  /** A different folder, or none, is now selected. Called at most once. */
  onRelease(next: FolderSelection | undefined): void;
}

/**
 * Subscribes once to workspace-folder changes. After the first change that
 * selects a different folder, later events are ignored.
 */
export function registerFolderChangeWiring(
  context: vscode.ExtensionContext,
  current: vscode.WorkspaceFolder,
  handlers: FolderChangeHandlers
): void {
  let released = false;
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (released) {
        return;
      }
      const outcome = evaluateFolderChange(current, vscode.workspace.workspaceFolders);
      if (outcome === "unchanged") {
        handlers.onUnchanged();
        return;
      }
      released = true;
      handlers.onRelease(outcome.next);
    })
  );
}
