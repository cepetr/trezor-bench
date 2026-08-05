import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { ManifestState, ManifestStatus } from "./manifest-types";
import { validateManifest } from "./validate-manifest";

const DEBOUNCE_MS = 300;

export class ManifestService implements vscode.Disposable {
  private _state: ManifestState | undefined;
  /** Status for which a failure notification was last shown. */
  private _lastNotifiedFailureStatus: ManifestStatus | undefined;
  private readonly _onDidChangeState =
    new vscode.EventEmitter<ManifestState>();
  private _watcher: vscode.FileSystemWatcher | undefined;
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly _disposables: vscode.Disposable[] = [];

  /** Fires whenever the manifest state changes. */
  readonly onDidChangeState: vscode.Event<ManifestState> =
    this._onDidChangeState.event;

  constructor(private readonly manifestUri: vscode.Uri) {}

  /**
   * Returns the current manifest state, or undefined before the first load.
   */
  get state(): ManifestState | undefined {
    return this._state;
  }

  /**
   * Loads the manifest from disk, validates it, publishes the new state,
   * and starts watching for changes. Safe to call multiple times.
   */
  async start(): Promise<ManifestState> {
    this._startWatcher();
    return this._load();
  }

  /**
   * Forces an immediate reload from disk.
   */
  async reload(): Promise<ManifestState> {
    return this._load();
  }

  dispose(): void {
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
    }
    this._watcher?.dispose();
    this._onDidChangeState.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async _load(): Promise<ManifestState> {
    let newState: ManifestState;

    try {
      const raw = await fs.readFile(this.manifestUri.fsPath, "utf-8");
      newState = validateManifest(raw, this.manifestUri);
    } catch (err: unknown) {
      const notFound =
        err instanceof Error &&
        (err as NodeJS.ErrnoException).code === "ENOENT";
      if (notFound) {
        newState = { status: "missing", manifestUri: this.manifestUri };
      } else {
        // Unreadable file — treat as invalid so diagnostics fire
        const message =
          err instanceof Error ? err.message : "Could not read manifest file";
        newState = {
          status: "invalid",
          manifestUri: this.manifestUri,
          validationIssues: [
            {
              severity: "error",
              code: "yaml-parse",
              message: `Could not read manifest: ${message}`,
            },
          ],
          loadedAt: new Date(),
        };
      }
    }

    this._setState(newState);
    return newState;
  }

  private _setState(state: ManifestState): void {
    const previousStatus = this._state?.status;
    this._state = state;
    this._showFailureNotificationIfNeeded(state, previousStatus);
    this._onDidChangeState.fire(state);
  }

  /**
   * Shows a VS Code notification when the manifest transitions to a failure
   * state. Suppresses repeated notifications for the same failure status to
   * avoid spamming the user during rapid file-watcher events.
   */
  private _showFailureNotificationIfNeeded(
    state: ManifestState,
    previousStatus: ManifestStatus | undefined
  ): void {
    if (state.status === "loaded") {
      // Clear notification tracking when a failure resolves
      this._lastNotifiedFailureStatus = undefined;
      return;
    }

    if (this._lastNotifiedFailureStatus === state.status) {
      // Same failure already notified — suppress duplicate
      return;
    }

    if (
      previousStatus === state.status &&
      this._lastNotifiedFailureStatus === state.status
    ) {
      return;
    }

    this._lastNotifiedFailureStatus = state.status;

    if (state.status === "missing") {
      vscode.window.showWarningMessage(
        `Trezor Firmware Tools: manifest file not found at "${state.manifestUri.fsPath}". ` +
          "Check [paths].manifest in tf-tools.toml."
      );
    } else if (state.status === "invalid") {
      const count = state.validationIssues.length;
      vscode.window.showErrorMessage(
        `Trezor Firmware Tools: manifest has ${count} validation error(s). ` +
          "Check the Problems view for details."
      );
    }
  }

  private _startWatcher(): void {
    if (this._watcher) {
      return;
    }
    // Watch the exact manifest file for create, change, and delete events.
    // File-change events trigger re-normalization of the active config via
    // the onDidChangeState -> restoreActiveConfig chain in extension.ts.
    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(this.manifestUri.fsPath)),
      path.basename(this.manifestUri.fsPath)
    );

    this._watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this._disposables.push(this._watcher);

    const reload = () => this._scheduleReload();
    this._disposables.push(this._watcher.onDidCreate(reload));
    this._disposables.push(this._watcher.onDidChange(reload));
    this._disposables.push(this._watcher.onDidDelete(reload));
  }

  private _scheduleReload(): void {
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = undefined;
      this._load().catch(() => {
        // errors are captured inside _load and translated to invalid state
      });
    }, DEBOUNCE_MS);
  }
}
