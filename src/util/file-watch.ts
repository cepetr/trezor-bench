/**
 * Single-file watching helper: one watcher, one handler for create,
 * change, and delete.
 */
import * as vscode from "vscode";

/** The subset of `vscode.FileSystemWatcher` that `watchFile` needs. */
export interface FileWatcherLike extends vscode.Disposable {
  onDidCreate(listener: (uri: vscode.Uri) => void): vscode.Disposable;
  onDidChange(listener: (uri: vscode.Uri) => void): vscode.Disposable;
  onDidDelete(listener: (uri: vscode.Uri) => void): vscode.Disposable;
}

/**
 * Creates a file-system watcher for `pattern` and invokes `onEvent` for
 * every create, change, and delete event. Returns a single disposable that
 * owns the watcher and all three event subscriptions. `createWatcher` can
 * replace the real VS Code watcher factory in tests.
 */
export function watchFile(
  pattern: vscode.GlobPattern,
  onEvent: (uri: vscode.Uri) => void,
  createWatcher: (pattern: vscode.GlobPattern) => FileWatcherLike = (p) =>
    vscode.workspace.createFileSystemWatcher(p)
): vscode.Disposable {
  const watcher = createWatcher(pattern);
  const subscriptions = [
    watcher.onDidCreate(onEvent),
    watcher.onDidChange(onEvent),
    watcher.onDidDelete(onEvent),
  ];
  return {
    dispose: () => {
      for (const subscription of subscriptions) {
        subscription.dispose();
      }
      watcher.dispose();
    },
  };
}
