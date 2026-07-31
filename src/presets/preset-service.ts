import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { PresetFile, PresetSource, PresetState } from "./preset-types";
import { parsePresetFile } from "./parse-presets";

const DEBOUNCE_MS = 300;

async function loadPresetFile(uri: vscode.Uri, source: PresetSource): Promise<PresetFile> {
  try {
    const raw = await fs.readFile(uri.fsPath, "utf-8");
    const parsed = parsePresetFile(raw, source);
    return {
      source,
      uri,
      present: true,
      names: parsed.names,
      fragments: parsed.fragments,
      issues: parsed.issues,
    };
  } catch (err: unknown) {
    const notFound =
      err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
    if (notFound) {
      // Absent is equivalent to empty (FR-027) — never an error.
      return { source, uri, present: false, names: [], fragments: [], issues: [] };
    }
    const message = err instanceof Error ? err.message : "Could not read preset file";
    return {
      source,
      uri,
      present: true,
      names: [],
      fragments: [],
      issues: [
        { severity: "error", code: "toml-parse", message: `Could not read preset file: ${message}` },
      ],
    };
  }
}

/**
 * Loads, validates, and watches both preset inputs (shared `presets.toml`
 * and optional `user-presets.toml`), publishing a combined `PresetState`.
 * Modeled on `ManifestService`.
 */
export class PresetService implements vscode.Disposable {
  private _state: PresetState | undefined;
  private readonly _onDidChangeState = new vscode.EventEmitter<PresetState>();
  private _sharedWatcher: vscode.FileSystemWatcher | undefined;
  private _userWatcher: vscode.FileSystemWatcher | undefined;
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly _disposables: vscode.Disposable[] = [];

  /** Fires whenever the combined preset state changes. */
  readonly onDidChangeState: vscode.Event<PresetState> = this._onDidChangeState.event;

  constructor(
    private readonly sharedUri: vscode.Uri,
    private readonly userUri: vscode.Uri
  ) {}

  /** Returns the current preset state, or undefined before the first load. */
  get state(): PresetState | undefined {
    return this._state;
  }

  /**
   * Loads both preset inputs from disk, validates them, publishes the new
   * state, and starts watching for changes. Safe to call multiple times.
   */
  async start(): Promise<PresetState> {
    this._startWatchers();
    return this._load();
  }

  /** Forces an immediate reload from disk (used before Build/Clippy/Check launch). */
  async reload(): Promise<PresetState> {
    return this._load();
  }

  dispose(): void {
    if (this._debounceTimer !== undefined) {
      clearTimeout(this._debounceTimer);
    }
    this._sharedWatcher?.dispose();
    this._userWatcher?.dispose();
    this._onDidChangeState.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async _load(): Promise<PresetState> {
    const [shared, user] = await Promise.all([
      loadPresetFile(this.sharedUri, "shared"),
      loadPresetFile(this.userUri, "user"),
    ]);

    const validationIssues = [...shared.issues, ...user.issues];
    const hasError = validationIssues.some((i) => i.severity === "error");
    const loadedAt = new Date();

    const newState: PresetState = hasError
      ? { status: "invalid", shared, user, loadedAt, validationIssues }
      : { status: "loaded", shared, user, loadedAt, validationIssues };

    this._state = newState;
    this._onDidChangeState.fire(newState);
    return newState;
  }

  private _startWatchers(): void {
    if (this._sharedWatcher || this._userWatcher) {
      return;
    }
    this._sharedWatcher = this._watch(this.sharedUri);
    this._userWatcher = this._watch(this.userUri);
  }

  private _watch(uri: vscode.Uri): vscode.FileSystemWatcher {
    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(uri.fsPath)),
      path.basename(uri.fsPath)
    );

    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this._disposables.push(watcher);

    const reload = () => this._scheduleReload();
    this._disposables.push(watcher.onDidCreate(reload));
    this._disposables.push(watcher.onDidChange(reload));
    this._disposables.push(watcher.onDidDelete(reload));

    return watcher;
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
