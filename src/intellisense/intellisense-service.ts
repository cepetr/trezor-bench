/**
 * Orchestrates IntelliSense: on each refresh trigger, resolves the active
 * compile-commands artifact and applies or clears it on the selected
 * backend, reporting provider warnings and recovery.
 */
import * as vscode from "vscode";
import {
  ResolvedArtifact,
  IntelliSenseProviderReadiness,
  IntelliSenseRuntimeState,
  ProviderPayload,
  RefreshTrigger,
} from "./intellisense-types";
import {
  buildResolutionInputs,
  resolveCompileCommandsArtifact,
  makeContextKey,
} from "./artifact-resolution";
import { checkProviderReadiness, resolveIntelliSenseBackend } from "./intellisense-backend";
import { CpptoolsBackend } from "./cpptools-backend";
import { ClangdBackend } from "./clangd-backend";
import { parseCompileCommandsFile } from "./compile-commands-parser";
import { BuildContext, ManifestStateLoaded } from "../manifest/manifest-types";
import {
  logIntelliSense,
  logMissingArtifact,
  logProviderWarning,
  logProviderRecovery,
} from "../observability/log-channel";
import { errorMessage } from "../util/errors";

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

/** Called after each completed refresh with the latest artifact and UI state. */
export type IntelliSenseRefreshCallback = (
  artifact: ResolvedArtifact | null,
  readiness: IntelliSenseProviderReadiness
) => void;

// ---------------------------------------------------------------------------
// IntelliSense service
// ---------------------------------------------------------------------------

/**
 * Owns IntelliSense refresh orchestration for the active build context.
 *
 * Responsibilities:
 *  - Serialize refresh requests so concurrent triggers collapse to the latest.
 *  - Resolve the active compile-commands artifact (no fallback).
 *  - Eagerly parse the active `.cc.json` before applying provider state.
 *  - Check provider readiness and emit persistent warnings via the log channel.
 *  - Apply or clear IntelliSense configuration through cpptools or clangd.
 *  - Publish updated artifact and readiness state to registered callbacks.
 */
export class IntelliSenseService {
  private _manifest: ManifestStateLoaded | undefined;
  private _buildContext: BuildContext | undefined;
  private _artifactsRoot: string = "";
  private _workspaceFolder: vscode.WorkspaceFolder | undefined;

  private _lastRuntimeState: IntelliSenseRuntimeState = {
    appliedArtifactPath: null,
    appliedContextKey: null,
    clearedAt: null,
    providerState: "inactive",
  };
  private _lastArtifact: ResolvedArtifact | null = null;
  private _lastReadiness: IntelliSenseProviderReadiness | null = null;
  private _lastPayload: ProviderPayload | null = null;

  /**
   * Last warning state emitted to guard against duplicate warning messages.
  * Warnings are logged once per state transition.
   */
  private _lastWarnedState: string = "none";

  /** Pending refresh promise for serialization (latest-refresh-wins). */
  private _pendingRefresh: Promise<void> | null = null;

  private readonly _onDidRefresh = new vscode.EventEmitter<
    [ResolvedArtifact | null, IntelliSenseProviderReadiness]
  >();

  /** Emitted after each refresh completes with the latest artifact and readiness. */
  readonly onDidRefresh: vscode.Event<
    [ResolvedArtifact | null, IntelliSenseProviderReadiness]
  > = this._onDidRefresh.event;

  private readonly _onDidRefreshPayload = new vscode.EventEmitter<ProviderPayload | null>();

  /**
   * Emitted after each refresh with the latest parsed `ProviderPayload`, or
   * `null` when the compile-database payload is unavailable.  Excluded-file
   * consumers subscribe here to receive the `includedFiles` set (the keys of
   * `ProviderPayload.entriesByFile`) without taking an additional compile-DB
   * parsing dependency.
   */
  readonly onDidRefreshPayload: vscode.Event<ProviderPayload | null> =
    this._onDidRefreshPayload.event;

  private readonly _cpptoolsBackend: CpptoolsBackend;
  private readonly _clangdBackend: ClangdBackend;

  constructor(
    cpptoolsBackend?: CpptoolsBackend,
    clangdBackend?: ClangdBackend
  ) {
    this._cpptoolsBackend = cpptoolsBackend ?? new CpptoolsBackend();
    this._clangdBackend = clangdBackend ?? new ClangdBackend();
  }

  // ---------------------------------------------------------------------------
  // State updates from extension.ts
  // ---------------------------------------------------------------------------

  setManifest(manifest: ManifestStateLoaded | undefined): void {
    this._manifest = manifest;
  }

  setBuildContext(buildContext: BuildContext | undefined): void {
    this._buildContext = buildContext;
  }

  setArtifactsRoot(root: string): void {
    this._artifactsRoot = root;
  }

  setWorkspaceFolder(folder: vscode.WorkspaceFolder | undefined): void {
    this._workspaceFolder = folder;
  }

  // ---------------------------------------------------------------------------
  // Public state accessors
  // ---------------------------------------------------------------------------

  getLastArtifact(): ResolvedArtifact | null {
    return this._lastArtifact;
  }

  getLastReadiness(): IntelliSenseProviderReadiness | null {
    return this._lastReadiness;
  }

  getRuntimeState(): IntelliSenseRuntimeState {
    return this._lastRuntimeState;
  }

  /**
   * Returns the latest parsed `ProviderPayload`, or null when the active
   * compile-database payload is unavailable.  Used by excluded-file consumers
   * to extract the `includedFiles` set without subscribing to the event.
   */
  getLastPayload(): ProviderPayload | null {
    return this._lastPayload;
  }

  // ---------------------------------------------------------------------------
  // Refresh
  // ---------------------------------------------------------------------------

  /**
   * Schedules an IntelliSense refresh. Concurrent calls are serialized;
   * each refresh starts immediately after the previous one completes.
   * This ensures the final state always reflects the latest active
  * configuration, with latest-refresh-wins behavior.
   */
  scheduleRefresh(trigger: RefreshTrigger): void {
    this._pendingRefresh = (this._pendingRefresh ?? Promise.resolve()).then(
      () => this._doRefresh(trigger)
    );
  }

  private async _doRefresh(trigger: RefreshTrigger): Promise<void> {
    logIntelliSense(`Refresh triggered by: ${trigger}`);

    // Ensure cpptools registration is attempted when that backend is active.
    if (resolveIntelliSenseBackend() === "cpptools") {
      void this._cpptoolsBackend.activate();
    }

    const readiness = checkProviderReadiness();
    this._lastReadiness = readiness;

    // Emit warning once per state transition; log recovery when returning to ready.
    if (readiness.warningState !== "none") {
      if (readiness.warningState !== this._lastWarnedState) {
        const msg =
          readiness.lastWarningMessage ??
          "IntelliSense integration is unavailable: see output channel for details.";
        if (readiness.warningState === "wrong-provider") {
          // Log only — extension.ts surfaces the notification with workspace-setting fix action.
          logIntelliSense(`[WARN] ${msg}`);
        } else {
          logProviderWarning(msg);
        }
        this._lastWarnedState = readiness.warningState;
      }
    } else if (this._lastWarnedState !== "none") {
      logProviderRecovery();
      this._lastWarnedState = "none";
    }

    const manifest = this._manifest;
    const buildContext = this._buildContext;

    if (!manifest || !buildContext) {
      // No active context — clear any previously applied state.
      await this._clearProviderState();
      this._lastArtifact = null;
      this._lastPayload = null;
      this._onDidRefresh.fire([null, readiness]);
      this._onDidRefreshPayload.fire(null);
      return;
    }

    const inputs = buildResolutionInputs(manifest, buildContext, this._artifactsRoot);
    const artifact = inputs
      ? resolveCompileCommandsArtifact(inputs, buildContext)
      : {
          path: "",
          exists: false,
          status: "missing" as const,
          missingReason: buildMissingReasonNoInputs(this._artifactsRoot),
          contextKey: makeContextKey(buildContext),
        };

    this._lastArtifact = artifact;

    if (artifact.status === "missing") {
      logMissingArtifact(artifact.path || "(unknown)", artifact.contextKey);
      await this._clearProviderState();
      this._lastPayload = null;
    } else if (readiness.warningState === "none") {
      await this._applyProviderState(artifact.path, artifact.contextKey);
    } else {
      // Provider not ready even though artifact exists — clear stale state.
      await this._clearProviderState();
      this._lastPayload = null;
    }

    this._onDidRefresh.fire([artifact, readiness]);
    this._onDidRefreshPayload.fire(this._lastPayload);
  }

  // ---------------------------------------------------------------------------
  // Provider state management
  // ---------------------------------------------------------------------------

  private async _applyProviderState(
    artifactPath: string,
    contextKey: string
  ): Promise<void> {
    const payload = parseCompileCommandsFile(artifactPath, contextKey);

    if (!payload) {
      logIntelliSense(`Failed to parse compile-commands: ${artifactPath}`);
      await this._clearProviderState();
      this._lastPayload = null;
      return;
    }

    const backend = resolveIntelliSenseBackend();
    if (backend === "clangd") {
      const workspaceFolder = this._workspaceFolder;
      if (!workspaceFolder) {
        logIntelliSense("Cannot apply clangd compile database: workspace folder unavailable.");
        await this._clearProviderState();
        this._lastPayload = null;
        return;
      }

      try {
        await this._clangdBackend.applyArtifact(workspaceFolder, artifactPath);
      } catch (error) {
        logIntelliSense(`Failed to apply clangd compile database: ${errorMessage(error)}`);
        await this._clearProviderState();
        this._lastPayload = null;
        return;
      }
    } else {
      this._cpptoolsBackend.applyPayload(payload);
    }

    this._lastPayload = payload;
    this._lastRuntimeState = {
      appliedArtifactPath: artifactPath,
      appliedContextKey: contextKey,
      clearedAt: null,
      providerState: "applied",
    };
    logIntelliSense(
      `Applied compile-commands (${backend ?? "unknown"}): ${artifactPath} ` +
      `(${payload.entriesByFile.size} entries)`
    );
  }

  private async _clearProviderState(): Promise<void> {
    const workspaceFolder = this._workspaceFolder;

    // clangd state can outlive the in-memory backend: a managed compile-database
    // link left on disk by a previous session must still be cleared, even though
    // `getLinkedArtifactPath()` is undefined right after activation.
    const clangdHasState =
      this._clangdBackend.getLinkedArtifactPath() !== undefined ||
      (workspaceFolder !== undefined &&
        this._clangdBackend.hasManagedCompileDatabase(workspaceFolder));

    if (
      this._lastRuntimeState.providerState === "inactive" &&
      this._cpptoolsBackend.getLastPayload() === undefined &&
      !clangdHasState
    ) {
      return;
    }

    this._cpptoolsBackend.clearPayload();

    if (workspaceFolder && clangdHasState) {
      try {
        await this._clangdBackend.clear(workspaceFolder);
      } catch (error) {
        logIntelliSense(`Failed to clear clangd compile database: ${errorMessage(error)}`);
      }
    }

    this._lastRuntimeState = {
      appliedArtifactPath: null,
      appliedContextKey: null,
      clearedAt: new Date(),
      providerState: "cleared",
    };
    logIntelliSense("Cleared stale compile-commands configuration.");
  }

  dispose(): void {
    this._onDidRefresh.dispose();
    this._onDidRefreshPayload.dispose();
    this._cpptoolsBackend.dispose();
    this._pendingRefresh = null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildMissingReasonNoInputs(artifactsRoot: string): string {
  if (!artifactsRoot) {
    return "[paths].build-artifacts is empty in tbench.toml; cannot resolve the compile-commands artifact.";
  }
  return "Cannot resolve the compile-commands artifact: check manifest artifactFolder and artifactName fields.";
}


