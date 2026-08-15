/**
 * Loads, validates, watches, and republishes the combined preset state
 * from `presets.toml` and `user-presets.toml`.
 */
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { PresetFile, PresetSource, PresetState } from "./preset-types";
import { parsePresetFile } from "./parse-presets";
import { errorMessage, isFileNotFound } from "../util/errors";
import { Debouncer } from "../util/debouncer";
import { watchFile } from "../util/file-watch";
import { FilePoller } from "../util/file-poller";

const DEBOUNCE_MS = 300;
const POLL_INTERVAL_MS = 1_000;

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
    if (isFileNotFound(err)) {
      // Absence carries no issue of its own: for `user-presets.toml` it is
      // equivalent to an empty file, and for the shared file `_load` turns it
      // into the `unavailable` state instead.
      return { source, uri, present: false, names: [], fragments: [], issues: [] };
    }
    const message = errorMessage(err);
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
  private _sharedWatcher: vscode.Disposable | undefined;
  private _userWatcher: vscode.Disposable | undefined;
  private readonly _debouncer = new Debouncer(DEBOUNCE_MS, () => {
    this._load().catch(() => {
      // errors are captured inside _load and translated to invalid state
    });
  });
  /**
   * Reliability backstop for the file-system watchers: VS Code does not
   * dependably deliver events for these paths in every host — the
   * integration harness, for one, runs with no workspace folder open,
   * where watcher events never arrive at all.
   */
  private readonly _filePoller = new FilePoller(POLL_INTERVAL_MS, () =>
    this._debouncer.schedule()
  );
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
    const state = await this._load();
    this._filePoller.start([this.sharedUri.fsPath, this.userUri.fsPath]);
    return state;
  }

  /** Forces an immediate reload from disk (used before Build/Clippy/Check launch). */
  async reload(): Promise<PresetState> {
    return this._load();
  }

  dispose(): void {
    this._debouncer.dispose();
    this._filePoller.dispose();
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

    // An absent shared file outranks any content error: `presets.toml` ships
    // with the `xtask` that understands `-p`, so its absence says the whole
    // repository has no preset support — the more fundamental condition to
    // report, and the one that explains a broken `user-presets.toml` too
    //.
    const newState: PresetState = !shared.present
      ? { status: "unavailable", shared, user, loadedAt, validationIssues }
      : hasError
        ? { status: "invalid", shared, user, loadedAt, validationIssues }
        : { status: "loaded", shared, user, loadedAt, validationIssues };

    this._state = newState;
    this._filePoller.resync();
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

  private _watch(uri: vscode.Uri): vscode.Disposable {
    // Watch the containing directory with a wildcard rather than the exact
    // filename: for a path outside any open workspace folder, VS Code
    // resolves a literal (non-glob) RelativePattern to watching that exact
    // file path, which never establishes when the target does not yet
    // exist — exactly user-presets.toml's common case. Filtering by exact
    // path below keeps behavior scoped to this one file.
    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(uri.fsPath)),
      "*"
    );
    const targetFsPath = uri.fsPath;

    const watcher = watchFile(pattern, (changedUri) => {
      if (changedUri.fsPath === targetFsPath) {
        this._debouncer.schedule();
      }
    });
    this._disposables.push(watcher);

    return watcher;
  }
}
