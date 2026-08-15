/**
 * Recomputes the excluded-files set when its inputs change: gathers
 * candidate files per the settings and coordinates refreshes of the
 * exclusion decorations and overlays.
 */
import * as vscode from "vscode";
import { ExcludedFilesService } from "./excluded-files-service";
import { ProviderPayload } from "./intellisense-types";
import {
  ExcludedFilesSettings,
  readExcludedFilesSettings,
} from "../workspace/settings";

export type ExcludedFilesSettingsReader = (
  workspaceFolder: vscode.WorkspaceFolder
) => ExcludedFilesSettings;

export type ExcludedFilesCandidateProvider = (
  settings: ExcludedFilesSettings,
  workspaceFolder: vscode.WorkspaceFolder
) => Promise<ReadonlyArray<vscode.Uri>>;

/**
 * Gathers workspace file candidates for excluded-file recomputation.
 * For each configured folderGlob, resolves the glob to a workspace-relative
 * form and calls `vscode.workspace.findFiles` to enumerate matching files.
 * Returns an empty array immediately when either scope list is empty.
 */
export async function gatherExcludedFileCandidates(
  settings: ExcludedFilesSettings,
  workspaceFolder: vscode.WorkspaceFolder
): Promise<vscode.Uri[]> {
  if (settings.fileNamePatterns.length === 0 || settings.folderGlobs.length === 0) {
    return [];
  }

  const wsRoot = workspaceFolder.uri.fsPath.replace(/\\/g, "/").replace(/\/$/, "");
  const seen = new Set<string>();
  const results: vscode.Uri[] = [];

  for (const glob of settings.folderGlobs) {
    const normalized = glob.replace(/\\/g, "/");
    const relativeGlob = normalized.startsWith(wsRoot + "/")
      ? normalized.slice(wsRoot.length + 1)
      : normalized.startsWith("/")
        ? normalized.slice(1)
        : normalized;

    const found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceFolder, relativeGlob)
    );

    for (const uri of found) {
      if (!seen.has(uri.toString())) {
        seen.add(uri.toString());
        results.push(uri);
      }
    }
  }

  return results;
}

/**
 * Coordinates excluded-file recomputes in response to IntelliSense payload
 * updates. The payload stream itself is serialized by `IntelliSenseService`,
 * but candidate gathering is async and must not allow an older payload to
 * overwrite a newer snapshot after the await boundary.
 */
export class ExcludedFilesRefreshCoordinator implements vscode.Disposable {
  private _requestVersion = 0;
  private _lastContextKey = "";

  constructor(
    private readonly _service: ExcludedFilesService,
    private readonly _workspaceFolder: vscode.WorkspaceFolder,
    private readonly _readSettings: ExcludedFilesSettingsReader = readExcludedFilesSettings,
    private readonly _candidateProvider: ExcludedFilesCandidateProvider = gatherExcludedFileCandidates
  ) {}

  handlePayload(payload: ProviderPayload | null): void {
    const requestVersion = ++this._requestVersion;

    if (payload === null) {
      this._service.clear(this._lastContextKey);
      return;
    }

    this._lastContextKey = payload.contextKey;
    const settings = this._readSettings(this._workspaceFolder);
    void this._recompute(requestVersion, payload, settings);
  }

  dispose(): void {
    this._requestVersion++;
  }

  private async _recompute(
    requestVersion: number,
    payload: ProviderPayload,
    settings: ExcludedFilesSettings
  ): Promise<void> {
    const candidateUris = await this._candidateProvider(settings, this._workspaceFolder);
    if (requestVersion !== this._requestVersion) {
      return;
    }

    this._service.recompute(
      payload.contextKey,
      payload.artifactPath,
      new Set(payload.entriesByFile.keys()),
      settings,
      this._workspaceFolder.uri.fsPath,
      candidateUris
    );
  }
}