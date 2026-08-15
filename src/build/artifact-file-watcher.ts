/**
 * Watches the active build context's on-disk artifacts (compile commands,
 * binary, map, executable) using file-system watchers with a polling
 * reconciliation fallback, and reports relevant changes.
 */
import * as path from "path";
import * as vscode from "vscode";
import { FilePoller } from "../util/file-poller";
import { watchFile } from "../util/file-watch";
import { BuildContext, ManifestStateLoaded } from "../manifest/manifest-types";
import {
  buildResolutionInputs,
  deriveArtifactPath,
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
  buildContext: BuildContext | undefined,
  artifactsRoot: string
): ArtifactWatchScope[] {
  if (!manifest || !buildContext) {
    return [];
  }

  const scopesByFolder = new Map<string, Set<string>>();
  const inputs = buildResolutionInputs(manifest, buildContext, artifactsRoot);
  if (inputs) {
    addWatchPath(scopesByFolder, artifactsRoot, deriveArtifactPath("compile-commands", inputs));
    addWatchPath(scopesByFolder, artifactsRoot, deriveArtifactPath("binary", inputs));
    addWatchPath(scopesByFolder, artifactsRoot, deriveArtifactPath("map", inputs));
    addWatchPath(scopesByFolder, artifactsRoot, deriveArtifactPath("executable", inputs));
  }

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

export class ArtifactFileWatcher implements vscode.Disposable {
  private _scopeSignature = "";
  private _watchers: vscode.Disposable[] = [];
  private _watchedFilePaths: string[] = [];
  private readonly _filePoller: FilePoller;
  private _refreshQueued = false;
  private _disposed = false;

  constructor(
    private readonly _onRelevantChange: () => void,
    private readonly _createWatcher: FileSystemWatcherFactory = (globPattern) =>
      vscode.workspace.createFileSystemWatcher(globPattern),
    private readonly _pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
  ) {
    this._filePoller = new FilePoller(this._pollIntervalMs, () => this._queueRefresh());
  }

  update(
    manifest: ManifestStateLoaded | undefined,
    buildContext: BuildContext | undefined,
    artifactsRoot: string
  ): void {
    if (this._disposed) {
      return;
    }

    const scopes = resolveArtifactWatchScopes(manifest, buildContext, artifactsRoot);
    const nextSignature = buildScopeSignature(scopes);
    if (nextSignature === this._scopeSignature) {
      return;
    }

    this._disposeWatchers();
    this._scopeSignature = nextSignature;
    this._watchedFilePaths = scopes.flatMap((scope) =>
      Array.from(scope.relativePaths, (relativePath) => path.join(scope.folderPath, relativePath))
    );

    for (const scope of scopes) {
      for (const relativePath of scope.relativePaths) {
        this._watchers.push(
          watchFile(
            new vscode.RelativePattern(vscode.Uri.file(scope.folderPath), relativePath),
            (uri) => this._handleFileEvent(scope, uri),
            this._createWatcher
          )
        );
      }
    }

    this._filePoller.start(this._watchedFilePaths);
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }

    this._disposed = true;
    this._scopeSignature = "";
    this._disposeWatchers();
    this._filePoller.dispose();
    this._watchedFilePaths = [];
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

    // Re-baseline so the poller does not re-report the change this event
    // already delivered.
    this._filePoller.resync();
    this._queueRefresh();
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