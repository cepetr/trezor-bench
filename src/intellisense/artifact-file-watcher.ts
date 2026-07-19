import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import { ActiveConfig } from "../configuration/active-config";
import { ManifestStateLoaded } from "../manifest/manifest-types";
import {
  buildResolutionInputs,
  deriveArtifactPath,
  deriveBinaryArtifactPath,
  deriveMapArtifactPath,
  resolveActiveExecutableArtifact,
} from "./artifact-resolution";

export interface ArtifactWatchScope {
  readonly folderPath: string;
  readonly relativePaths: ReadonlySet<string>;
}

export interface FileSystemWatcherLike extends vscode.Disposable {
  onDidCreate(listener: (uri: vscode.Uri) => void): vscode.Disposable;
  onDidChange(listener: (uri: vscode.Uri) => void): vscode.Disposable;
  onDidDelete(listener: (uri: vscode.Uri) => void): vscode.Disposable;
}

export type FileSystemWatcherFactory = (
  globPattern: vscode.GlobPattern
) => FileSystemWatcherLike;

const DEFAULT_POLL_INTERVAL_MS = 1_000;

function addWatchPath(
  scopesByFolder: Map<string, Set<string>>,
  artifactsRoot: string,
  artifactPath: string | undefined
): void {
  if (!artifactPath) {
    return;
  }

  const watchRoot = path.dirname(artifactsRoot);
  const relativePath = path.relative(watchRoot, artifactPath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return;
  }

  let relativePaths = scopesByFolder.get(watchRoot);
  if (!relativePaths) {
    relativePaths = new Set<string>();
    scopesByFolder.set(watchRoot, relativePaths);
  }
  relativePaths.add(relativePath);
}

export function resolveArtifactWatchScopes(
  manifest: ManifestStateLoaded | undefined,
  config: ActiveConfig | undefined,
  artifactsRoot: string
): ArtifactWatchScope[] {
  if (!manifest || !config) {
    return [];
  }

  const scopesByFolder = new Map<string, Set<string>>();
  const inputs = buildResolutionInputs(manifest, config, artifactsRoot);
  if (inputs) {
    addWatchPath(scopesByFolder, artifactsRoot, deriveArtifactPath(inputs));
    addWatchPath(scopesByFolder, artifactsRoot, deriveBinaryArtifactPath(inputs));
    addWatchPath(scopesByFolder, artifactsRoot, deriveMapArtifactPath(inputs));
  }

  const executableArtifact = resolveActiveExecutableArtifact(
    manifest,
    config,
    artifactsRoot
  );
  addWatchPath(
    scopesByFolder,
    artifactsRoot,
    executableArtifact.expectedPath || undefined
  );

  return Array.from(scopesByFolder.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([folderPath, relativePaths]) => ({ folderPath, relativePaths }));
}

function buildScopeSignature(scopes: ReadonlyArray<ArtifactWatchScope>): string {
  return scopes
    .map((scope) => {
      const relativePaths = Array.from(scope.relativePaths).sort().join(",");
      return `${scope.folderPath}:${relativePaths}`;
    })
    .join("|");
}

export class ActiveArtifactFileWatcher implements vscode.Disposable {
  private _scopeSignature = "";
  private _watchers: vscode.Disposable[] = [];
  private _watchedFilePaths: string[] = [];
  private _fileStates = new Map<string, string>();
  private _poller: ReturnType<typeof setInterval> | undefined;
  private _refreshQueued = false;
  private _disposed = false;

  constructor(
    private readonly _onRelevantChange: () => void,
    private readonly _createWatcher: FileSystemWatcherFactory = (globPattern) =>
      vscode.workspace.createFileSystemWatcher(globPattern),
    private readonly _pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
  ) {}

  update(
    manifest: ManifestStateLoaded | undefined,
    config: ActiveConfig | undefined,
    artifactsRoot: string
  ): void {
    if (this._disposed) {
      return;
    }

    const scopes = resolveArtifactWatchScopes(manifest, config, artifactsRoot);
    const nextSignature = buildScopeSignature(scopes);
    if (nextSignature === this._scopeSignature) {
      return;
    }

    this._disposeWatchers();
    this._scopeSignature = nextSignature;
    this._watchedFilePaths = scopes.flatMap((scope) =>
      Array.from(scope.relativePaths, (relativePath) => path.join(scope.folderPath, relativePath))
    );
    this._fileStates = this._captureFileStates();

    for (const scope of scopes) {
      for (const relativePath of scope.relativePaths) {
        const watcher = this._createWatcher(
          new vscode.RelativePattern(vscode.Uri.file(scope.folderPath), relativePath)
        );
        const handleEvent = (uri: vscode.Uri) => {
          this._handleFileEvent(scope, uri);
        };

        this._watchers.push(
          watcher,
          watcher.onDidCreate(handleEvent),
          watcher.onDidChange(handleEvent),
          watcher.onDidDelete(handleEvent)
        );
      }
    }

    this._startPolling();
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }

    this._disposed = true;
    this._scopeSignature = "";
    this._disposeWatchers();
    this._stopPolling();
    this._watchedFilePaths = [];
    this._fileStates.clear();
  }

  private _disposeWatchers(): void {
    for (const disposable of this._watchers) {
      disposable.dispose();
    }
    this._watchers = [];
  }

  private _handleFileEvent(scope: ArtifactWatchScope, uri: vscode.Uri): void {
    const relativePath = path.relative(scope.folderPath, uri.fsPath);
    if (!scope.relativePaths.has(relativePath)) {
      return;
    }

    this._fileStates.set(uri.fsPath, this._getFileState(uri.fsPath));
    this._queueRefresh();
  }

  private _startPolling(): void {
    this._stopPolling();
    if (this._watchedFilePaths.length === 0) {
      return;
    }

    this._poller = setInterval(() => {
      this._pollForChanges();
    }, this._pollIntervalMs);
  }

  private _stopPolling(): void {
    if (this._poller) {
      clearInterval(this._poller);
      this._poller = undefined;
    }
  }

  private _pollForChanges(): void {
    if (this._disposed) {
      return;
    }

    const nextFileStates = this._captureFileStates();
    const changed = this._watchedFilePaths.some(
      (filePath) => this._fileStates.get(filePath) !== nextFileStates.get(filePath)
    );
    if (!changed) {
      return;
    }

    this._fileStates = nextFileStates;
    this._queueRefresh();
  }

  private _captureFileStates(): Map<string, string> {
    return new Map(
      this._watchedFilePaths.map((filePath) => [filePath, this._getFileState(filePath)])
    );
  }

  private _getFileState(filePath: string): string {
    try {
      const stat = fs.statSync(filePath);
      return stat.isFile() ? `${stat.size}:${stat.mtimeMs}` : "missing";
    } catch {
      return "missing";
    }
  }

  private _queueRefresh(): void {
    if (this._refreshQueued || this._disposed) {
      return;
    }

    this._refreshQueued = true;
    queueMicrotask(() => {
      this._refreshQueued = false;
      if (!this._disposed) {
        this._onRelevantChange();
      }
    });
  }
}