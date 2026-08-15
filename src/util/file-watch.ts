import * as vscode from "vscode";

/**
 * Creates a file-system watcher for `pattern` and invokes `onEvent` for
 * every create, change, and delete event. Returns a single disposable that
 * owns the watcher and all three event subscriptions.
 */
export function watchFile(
  pattern: vscode.GlobPattern,
  onEvent: (uri: vscode.Uri) => void
): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  return vscode.Disposable.from(
    watcher,
    watcher.onDidCreate(onEvent),
    watcher.onDidChange(onEvent),
    watcher.onDidDelete(onEvent)
  );
}
