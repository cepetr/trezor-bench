/**
 * Extension entry point: wires up the manifest, preset, repository
 * configuration, and IntelliSense services, registers commands, views, and
 * task and debug providers, and coordinates state refreshes between them.
 */
import * as vscode from "vscode";
import { hasSupportedWorkspace, requireWorkspaceFolder, isWorkflowWorkspaceSupported } from "./workspace/workspace-guard";
import { isStatusBarEnabled } from "./workspace/settings";
import { RepositoryConfigService, loadRepositoryConfig, setRepositoryConfig, resolveManifestUri, resolveArtifactsPath, resolveDebugTemplatesPath, resolvePresetUris } from "./workspace/repository-config";
import { ManifestService } from "./manifest/manifest-service";
import { PresetService } from "./presets/preset-service";
import { PresetState } from "./presets/preset-types";
import {
  derivePresetContext,
  samePresetContext,
  shiftedPresetOptionKeys,
  listPresetChoices,
  computePresetEffectiveValues,
  PresetChoice,
  PresetContext,
  PresetEffectiveValue,
} from "./presets/preset-resolution";
import { PaneTreeModel } from "./ui/pane-tree";
import { registerPaneTreeViews } from "./ui/pane-tree-wiring";
import { StatusBarPresenter } from "./ui/status-bar";
import {
  disposeLogChannel,
  initLogChannel,
  logWarning,
  revealLogs,
  logManifestState,
  logPresetState,
  logPresetNormalization,
  logOverridesPrunedForPreset,
  logOverridesPrunedForContext,
  logRepositoryConfigState,
  notifyWarning,
  notifyError,
} from "./observability/log-channel";
import {
  disposeDiagnostics,
  handleManifestStateDiagnostics,
  handlePresetStateDiagnostics,
  handleRepositoryConfigDiagnostics,
} from "./observability/diagnostics";
import {
  restoreBuildSelection,
  readBuildSelection,
  selectModel,
  selectTarget,
  selectComponent,
  selectPreset,
  activePresetId,
  BuildSelection,
} from "./build/build-selection";
import { normalizeBuildSelection } from "./build/normalize-selection";
import {
  readBuildOptions,
  writeBuildOption,
  dropBuildOptionOverrides,
  normalizeBuildOptions,
  ResolvedOption,
} from "./build/build-options";
import { ManifestState, ManifestStateLoaded, loadedManifest } from "./manifest/manifest-types";
import {
  evaluateWorkflowPreconditions,
  reportWorkflowBlocked,
  executeWorkflowTask,
  WorkflowKind,
} from "./commands/build-workflow";
import {
  BuildTaskProvider,
  resolveWorkflowContext,
  createWorkflowTask,
  isSuccessfulArtifactRefreshTaskProcess,
  TASK_TYPE,
} from "./tasks/build-task-provider";
import { IntelliSenseService } from "./intellisense/intellisense-service";
import { RefreshTrigger } from "./intellisense/intellisense-types";
import { applyProviderSettingFix } from "./intellisense/cpptools-backend";
import { ArtifactFileWatcher } from "./build/artifact-file-watcher";
import { registerExcludedFilesVisibility } from "./intellisense/excluded-files-wiring";
import {
  evaluateArtifactActionPreconditions,
  isArtifactActionApplicable,
  resolveArtifactActionContext,
  createArtifactTask,
  executeArtifactTask,
  reportArtifactActionBlocked,
  openMapFile,
  ArtifactActionKind,
} from "./commands/artifact-actions";
import { registerUnsupportedWorkspaceCommands } from "./commands/unsupported-workspace-commands";
import {
  updateWorkflowBlockedContext,
  updateArtifactActionContext,
  updateDebugContext,
  updateCompileCommandsTreeArtifact,
} from "./ui/context-keys";
import { executeDebugLaunch } from "./commands/debug-launch";
import { logDebugLaunchFailure } from "./observability/log-channel";
import { BuildContext } from "./manifest/manifest-types";
import {
  RunDebugConfigProvider,
  TBENCH_DEBUG_TYPE,
} from "./debug/run-debug-provider";

let _manifestService: ManifestService | undefined;
let _presetService: PresetService | undefined;
let _presetState: PresetState | undefined;
let _presetStateSubscription: vscode.Disposable | undefined;
let _treeModel: PaneTreeModel | undefined;
let _statusBar: StatusBarPresenter | undefined;
let _manifestState: ManifestState | undefined;
let _buildSelection: BuildSelection | undefined;
let _intelliSenseService: IntelliSenseService | undefined;
let _artifactFileWatcher: ArtifactFileWatcher | undefined;
let _manifestStateSubscription: vscode.Disposable | undefined;
let _debugConfigProviderRegistration: vscode.Disposable | undefined;
/** Tracks the last wrong-provider state offered to the user to avoid duplicate Fix notifications. */
let _lastShownProviderFixState: string = "none";

// ---------------------------------------------------------------------------
// Scope guard for the supported command surface, now expanded for
// Build Workflow, IntelliSense, Flash/Upload, and Debug Launch.
//
// This extension contributes ONLY the commands listed below in these feature
// slices. Debug and all other cross-slice commands are intentionally absent.
// Any attempt to register them here is a scope violation.
//
// Allowed commands:
//   tbench.showLogs              — reveal the output channel
//   tbench.build                 — launch Build task
//   tbench.clippy                — launch Clippy task
//   tbench.check                 — launch Check task
//   tbench.clean                 — launch Clean task
//   tbench.refreshIntelliSense   — manual IntelliSense refresh
//   tbench.flash                 — launch Flash task (Flash/Upload slice)
//   tbench.upload                — launch Upload task (Flash/Upload slice)
//   tbench.openMapFile           — open resolved map file (Flash/Upload slice)
//   tbench.startDebugging        — launch debug session (Debug Launch slice)
// ---------------------------------------------------------------------------

const ALLOWED_CONTRIBUTION_COMMANDS = new Set([
  "tbench.showLogs",
  "tbench.build",
  "tbench.clippy",
  "tbench.check",
  "tbench.clean",
  "tbench.refreshIntelliSense",
  "tbench.flash",
  "tbench.upload",
  "tbench.openMapFile",
  "tbench.startDebugging",
]);

/**
 * Development-time guard: verifies that no unauthorized tbench commands are
 * contributed during activation. Throws in development mode if a violation is
 * detected; logs a warning in production.
 */
function assertNoUnauthorizedContributions(
  context: vscode.ExtensionContext
): void {
  const contributed: string[] =
    context.extension.packageJSON?.contributes?.commands?.map(
      (c: { command: string }) => c.command
    ) ?? [];

  const unauthorized = contributed
    .filter((cmd: string) => cmd.startsWith("tbench."))
    .filter((cmd: string) => !ALLOWED_CONTRIBUTION_COMMANDS.has(cmd));

  if (unauthorized.length > 0) {
    const msg =
      `Scope violation: ` +
      `unauthorized commands found in package.json: ${unauthorized.join(", ")}`;
    notifyWarning(msg);
  }
}

/**
 * Computes the resolved build options for the given manifest state, active
 * configuration, current persisted selections, and preset-effective values.
 * Returns an empty array when the manifest is not loaded or no active
 * configuration is available.
 */
function computeResolvedOptions(
  state: ManifestState,
  buildContext: BuildContext | undefined,
  context: vscode.ExtensionContext,
  presetEffectiveValues: ReadonlyMap<string, PresetEffectiveValue> = new Map()
): ResolvedOption[] {
  const manifest = loadedManifest(state);
  if (!manifest || !buildContext) {
    return [];
  }
  const saved = readBuildOptions(context);
  return normalizeBuildOptions(manifest.buildOptions, saved, buildContext, presetEffectiveValues);
}

/**
 * Owns the preset/build-option recomputation state: the preset-effective
 * values, the preset context of the last refresh, the preset-blocked flags,
 * and the resolved build options. Everything here is derived state — the
 * persisted inputs live in workspaceState and the preset files.
 */
class PresetOptionsCoordinator {
  private _effectiveValues: ReadonlyMap<string, PresetEffectiveValue> = new Map();
  /**
   * The preset context the last refresh resolved against. Held beside
   * `_buildSelection` — the two are always written together — so a refresh can tell
   * whether the calculated values every stored override was authored against
   * still hold. `undefined` until the first refresh with a loaded
   * manifest, which is what keeps activation from wiping a restored session.
   */
  private _presetContext: PresetContext | undefined;
  /**
   * Backs the `tbench.presetBlocked` context key (an absent shared
   * `presets.toml`, file-level invalidity, or any available-option mismatch).
   */
  private _blocked = false;
  /**
   * True only for the absent shared `presets.toml`. Tracked separately
   * from `_blocked` so the launch path can report the more specific
   * `presets-unavailable` reason; it always implies `_blocked`.
   */
  private _unavailable = false;
  private _resolvedOptions: ReadonlyArray<ResolvedOption> = [];

  get presetBlocked(): boolean {
    return this._blocked;
  }

  get presetsUnavailable(): boolean {
    return this._unavailable;
  }

  get resolvedOptions(): ReadonlyArray<ResolvedOption> {
    return this._resolvedOptions;
  }

  /** Recomputes the resolved options against the current effective values. */
  recomputeResolvedOptions(
    state: ManifestState,
    buildContext: BuildContext | undefined,
    context: vscode.ExtensionContext
  ): void {
    this._resolvedOptions = computeResolvedOptions(state, buildContext, context, this._effectiveValues);
  }

  /** Clears the state derived from a loaded manifest (manifest unloaded). */
  resetForUnloadedManifest(): void {
    this._presetContext = undefined;
    this._resolvedOptions = [];
  }

  /** Clears the resolved options (invalid repository configuration). */
  clearResolvedOptions(): void {
    this._resolvedOptions = [];
  }

  /**
   * Recomputes the declared preset list and preset-effective build-option values
   * against the current manifest, active build context, and preset state;
   * normalizes and persists the active preset id when it changed; drops, when
   * the active preset or the preset context changed, exactly those explicit
   * build-option overrides whose calculated value moved with it;
   * and refreshes the `Preset` selector and Build Options.
   * The single entry point for every preset-relevant
   * trigger: activation, preset-state change, manifest-state change, and
   * active model/target/component change.
   */
  async refresh(context: vscode.ExtensionContext): Promise<void> {
    const manifest = loadedManifest(_manifestState);
    if (!manifest) {
      this._effectiveValues = new Map();
      this._blocked = false;
      this._unavailable = false;
      vscode.commands.executeCommand("setContext", "tbench.presetBlocked", false);
      _treeModel?.updatePresets(_presetState, undefined, []);
      return;
    }

    const savedAxes = normalizeBuildSelection(manifest, readBuildSelection(context));
    const presetCtx = derivePresetContext(manifest, savedAxes);

    const currentPresetState = _presetState;
    const presets = currentPresetState?.status === "loaded" ? currentPresetState : undefined;

    // The choice list depends on the two preset files alone: every declared
    // preset is offered whatever the build context, so `knownIds` only
    // ever retires an id the files no longer declare.
    let choices: PresetChoice[] = [];
    let knownIds: Set<string> | undefined;
    if (presets) {
      choices = listPresetChoices(presets.shared, presets.user);
      knownIds = new Set(choices.map((p) => p.id));
    }

    const previousPresetId = _buildSelection ? activePresetId(_buildSelection) : undefined;
    const previousPresetContext = this._presetContext;
    const normalizedConfig = await restoreBuildSelection(context, manifest, knownIds);
    const newPresetId = activePresetId(normalizedConfig);

    const presetIdChanged = previousPresetId !== undefined && previousPresetId !== newPresetId;
    const presetContextChanged =
      previousPresetContext !== undefined && !samePresetContext(previousPresetContext, presetCtx);

    if (presetIdChanged) {
      logPresetNormalization(previousPresetId!, newPresetId);
    }

    this._effectiveValues = presets
      ? computePresetEffectiveValues(manifest.buildOptions, presets.shared, presets.user, newPresetId, presetCtx)
      : new Map();

    if (presets && (presetIdChanged || presetContextChanged)) {
      // An override is authored against a calculated value, and that value is a
      // function of the (active preset, preset context) pair: fragments carry
      // `when = { model, project, emulator }` filters, so both the [[defaults]]
      // layer and the named-preset layer can calculate differently in a
      // different context. So a change to either half is where overrides have to
      // be re-examined — but only per option, and against the same preset files:
      // recalculate what the previous pair produced, and drop exactly the
      // overrides whose value moved. Those would otherwise silently shadow the
      // new calculation, with no way to clear it for a checkbox; the rest still
      // say what the user asked for and are kept. Both change guards
      // require a known previous half, which is what keeps activation from
      // pruning the selections it just restored, and an unloaded preset state
      // never prunes because it can calculate neither side.
      const previousEffective = computePresetEffectiveValues(
        manifest.buildOptions,
        presets.shared,
        presets.user,
        previousPresetId ?? newPresetId,
        previousPresetContext ?? presetCtx
      );
      const shifted = shiftedPresetOptionKeys(previousEffective, this._effectiveValues);
      const dropped = await dropBuildOptionOverrides(context, shifted);
      const kept = Object.keys(readBuildOptions(context)?.values ?? {});
      if (presetIdChanged) {
        logOverridesPrunedForPreset(previousPresetId!, newPresetId, dropped, kept);
      } else {
        logOverridesPrunedForContext(previousPresetContext!, presetCtx, dropped, kept);
      }
    }

    _buildSelection = normalizedConfig;
    this._presetContext = presetCtx;
    this._resolvedOptions = computeResolvedOptions(manifest, normalizedConfig, context, this._effectiveValues);

    this._unavailable = currentPresetState?.status === "unavailable";
    this._blocked =
      this._unavailable ||
      currentPresetState?.status === "invalid" ||
      this._resolvedOptions.some((r) => r.available && r.presetState === "mismatch");
    vscode.commands.executeCommand("setContext", "tbench.presetBlocked", this._blocked);

    _treeModel?.update(manifest, normalizedConfig, this._resolvedOptions);
    _treeModel?.updatePresets(currentPresetState, newPresetId, choices);
  }
}

let _presetOptions = new PresetOptionsCoordinator();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initLogChannel();
  _presetOptions = new PresetOptionsCoordinator();

  // --- Scope guard: verify no unrelated commands are registered. ---
  assertNoUnauthorizedContributions(context);

  // Recomputes the resolved options and refreshes the tree after a
  // build-option write, shared by the checkbox and toggle/select handlers.
  const refreshResolvedOptionsView = (): void => {
    const state = _manifestState;
    if (state) {
      _presetOptions.recomputeResolvedOptions(state, _buildSelection, context);
      _treeModel?.update(state, _buildSelection, _presetOptions.resolvedOptions);
    }
  };

  // Always register the tree provider so VS Code never shows
  // "no data provider registered" when the activity bar is clicked.
  _treeModel = new PaneTreeModel();
  context.subscriptions.push({
    dispose: () => {
      _treeModel?.dispose();
      _treeModel = undefined;
    },
  });
  registerPaneTreeViews(context, _treeModel, {
    writeBuildOption: async (key, value) => {
      await writeBuildOption(context, key, value);
    },
    refreshResolvedOptionsView,
  });

  if (!hasSupportedWorkspace()) {
    registerUnsupportedWorkspaceCommands(context);
    // Extension activated without a workspace — show a visible warning and bail.
    const noWorkspaceMsg =
      "Trezor Bench requires an open workspace folder.";
    logWarning(noWorkspaceMsg);
    // Mark workflow as blocked (workspace unsupported) so header actions are disabled.
    vscode.commands.executeCommand("setContext", "tbench.workflowBlocked", true);
    return;
  }

  const workspaceFolder = requireWorkspaceFolder();
  const repositoryConfigState = await loadRepositoryConfig(workspaceFolder);
  if (repositoryConfigState.status !== "invalid") {
    setRepositoryConfig(workspaceFolder, repositoryConfigState.config);
  }
  const manifestUri = resolveManifestUri(workspaceFolder);
  const refreshArtifactFileWatcher = (): void => {
    const manifest = loadedManifest(_manifestState);

    _artifactFileWatcher?.update(
      manifest,
      _buildSelection,
      resolveArtifactsPath(workspaceFolder)
    );
  };
  const refreshArtifactActionState = (): void => {
    if (!_manifestState) {
      return;
    }

    updateArtifactActionContext(
      _treeModel,
      _manifestState,
      _buildSelection,
      resolveArtifactsPath(workspaceFolder)
    );
    updateDebugContext(
      _treeModel,
      _manifestState,
      _buildSelection,
      resolveArtifactsPath(workspaceFolder)
    );
  };
  const refreshStatusBar = (): void => {
    if (!_manifestState) {
      return;
    }

    _statusBar?.update(
      _manifestState,
      _buildSelection,
      isStatusBarEnabled(workspaceFolder)
    );
  };
  const refreshBuildArtifacts = (trigger: RefreshTrigger): void => {
    if (_manifestState) {
      updateCompileCommandsTreeArtifact(
        _treeModel,
        _manifestState,
        _buildSelection,
        resolveArtifactsPath(workspaceFolder)
      );
    }
    refreshArtifactActionState();
    _intelliSenseService?.scheduleRefresh(trigger);
  };

  // --- Status-bar presenter. ---
  _statusBar = new StatusBarPresenter();
  context.subscriptions.push(_statusBar);

  // --- IntelliSense service ---
  _intelliSenseService = new IntelliSenseService();
  _artifactFileWatcher = new ArtifactFileWatcher(() => {
    refreshBuildArtifacts("artifact-file-change");
  });
  context.subscriptions.push({
    dispose: () => {
      _intelliSenseService?.dispose();
      _intelliSenseService = undefined;
    },
  });
  context.subscriptions.push({
    dispose: () => {
      _artifactFileWatcher?.dispose();
      _artifactFileWatcher = undefined;
    },
  });

  // --- Excluded-file visibility: explorer badges and editor overlays. ---
  registerExcludedFilesVisibility(context, workspaceFolder, _intelliSenseService);

  // Subscribe to IntelliSense refresh results → update tree view artifact row
  context.subscriptions.push(
    _intelliSenseService.onDidRefresh(([compileCommandsArtifact, readiness]) => {
      const state = _manifestState;
      if (state) {
        _treeModel?.updateArtifact("compile-commands", compileCommandsArtifact);
      }
      // Show the wrong-provider fix notification once per state entry.
      if (readiness.warningState === "wrong-provider" && readiness.warningState !== _lastShownProviderFixState) {
        _lastShownProviderFixState = "wrong-provider";
        notifyWarning(
          readiness.lastWarningMessage ??
            "Another C/C++ configuration provider is active. Switch to Trezor Bench?",
          "Fix"
        ).then((selection) => {
          if (selection === "Fix") {
            applyProviderSettingFix(workspaceFolder, () => {
              _lastShownProviderFixState = "none";
              _intelliSenseService?.scheduleRefresh("build-selection-change");
            });
          }
        });
      } else if (readiness.warningState !== "wrong-provider") {
        _lastShownProviderFixState = "none";
      }
    })
  );

  // Initialize artifactsRoot from current settings
  _intelliSenseService.setWorkspaceFolder(workspaceFolder);
  _intelliSenseService.setArtifactsRoot(resolveArtifactsPath(workspaceFolder));

  // Watch remaining VS Code settings that still control user-local behavior.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("tbench.showConfigurationInStatusBar", workspaceFolder.uri)) {
        refreshStatusBar();
      }
      if (
        e.affectsConfiguration("tbench.excludedFiles.grayInTree", workspaceFolder.uri) ||
        e.affectsConfiguration("tbench.excludedFiles.showEditorOverlay", workspaceFolder.uri) ||
        e.affectsConfiguration("tbench.excludedFiles.fileNamePatterns", workspaceFolder.uri) ||
        e.affectsConfiguration("tbench.excludedFiles.folderGlobs", workspaceFolder.uri)
      ) {
        _intelliSenseService?.scheduleRefresh("excluded-files-setting-change");
      }
    })
  );

  // --- Manifest service ---
  _manifestService = new ManifestService(manifestUri);
  context.subscriptions.push({
    dispose: () => {
      _manifestStateSubscription?.dispose();
      _manifestService?.dispose();
    },
  });

  // Connect manifest state changes to the tree model, diagnostics, and logs.
  // On each state change, restore and normalize the active config and the
  // active preset together.
  const onManifestStateChange = async (state: ManifestState): Promise<void> => {
    _manifestState = state;
    if (state.status === "loaded") {
      await _presetOptions.refresh(context);
    } else {
      _buildSelection = undefined;
      _presetOptions.resetForUnloadedManifest();
      _treeModel?.update(state, undefined, []);
      _treeModel?.updatePresets(_presetState, undefined, []);
    }
    refreshStatusBar();
    handleManifestStateDiagnostics(state);
    logManifestState(state);
    updateWorkflowBlockedContext(state, _buildSelection);

    // Update IntelliSense service with the new manifest state
    const manifest = loadedManifest(state);
    _intelliSenseService?.setManifest(manifest);
    _intelliSenseService?.setBuildContext(_buildSelection);
    refreshArtifactFileWatcher();
    refreshBuildArtifacts("manifest-change");
  };

  _manifestStateSubscription = _manifestService.onDidChangeState(onManifestStateChange);

  // --- Preset service ---
  const presetUris = resolvePresetUris(workspaceFolder);
  _presetService = new PresetService(presetUris.shared, presetUris.user);
  context.subscriptions.push({
    dispose: () => {
      _presetStateSubscription?.dispose();
      _presetService?.dispose();
    },
  });

  // Connect preset state changes to diagnostics, logs, and preset-list
  // recomputation/normalization.
  const onPresetStateChange = async (state: PresetState): Promise<void> => {
    _presetState = state;
    handlePresetStateDiagnostics(state);
    logPresetState(state);
    await _presetOptions.refresh(context);
  };

  _presetStateSubscription = _presetService.onDidChangeState(onPresetStateChange);

  // --- Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.showLogs", () => {
      revealLogs();
    })
  );

  // --- Refresh IntelliSense command. ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.refreshIntelliSense", () => {
      _intelliSenseService?.scheduleRefresh("manual-refresh");
    })
  );

  // --- Flash and Upload commands. Identical except for the action kind. ---
  const runArtifactAction = async (kind: ArtifactActionKind): Promise<void> => {
    const state = _manifestState;
    const buildContext = _buildSelection;
    const manifest = loadedManifest(state);
    const actionCtx = manifest && buildContext ? resolveArtifactActionContext(manifest, buildContext) : undefined;
    const component = manifest?.components.find((c) => c.id === buildContext?.componentId);

    const blockReason = evaluateArtifactActionPreconditions({
      workspaceSupported: isWorkflowWorkspaceSupported(),
      manifestStatus: state?.status ?? "missing",
      hasWorkflowBlockingIssues: manifest?.hasWorkflowBlockingIssues ?? false,
      buildSelectionResolved: !!actionCtx,
      actionApplicable: !!(component && buildContext && isArtifactActionApplicable(kind, component, buildContext)),
      binaryExists: _treeModel?.getArtifact("binary")?.exists ?? false,
    });

    if (blockReason !== "no-block") {
      reportArtifactActionBlocked(kind, blockReason);
      return;
    }

    if (!actionCtx) {
      reportArtifactActionBlocked(kind, "context-unresolved");
      return;
    }

    const task = createArtifactTask(kind, actionCtx, workspaceFolder);
    await executeArtifactTask(task, kind);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.flash", () => runArtifactAction("flash"))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.upload", () => runArtifactAction("upload"))
  );

  // --- startDebugging command (Debug Launch slice) ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.startDebugging", async () => {
      const state = _manifestState;
      const config = _buildSelection;
      const manifest = loadedManifest(state);
      if (!manifest || !config) {
        logDebugLaunchFailure("unsupported-workspace", {
          detail: "manifest not loaded or no active configuration",
        });
        revealLogs();
        notifyError("Cannot start debugging: manifest not loaded.");
        return;
      }
      await executeDebugLaunch(workspaceFolder, manifest, config);
    })
  );

  // --- Run and Debug provider (Run and Debug Integration slice) ---
  const debugConfigProvider = new RunDebugConfigProvider(
    () => loadedManifest(_manifestState),
    () => _buildSelection,
    () => resolveArtifactsPath(workspaceFolder),
    () => resolveDebugTemplatesPath(workspaceFolder)
  );
  _debugConfigProviderRegistration?.dispose();
  _debugConfigProviderRegistration = vscode.debug.registerDebugConfigurationProvider(
    TBENCH_DEBUG_TYPE,
    debugConfigProvider,
    vscode.DebugConfigurationProviderTriggerKind.Dynamic
  );
  context.subscriptions.push(_debugConfigProviderRegistration);

  // --- openMapFile command, scoped to the artifact row. ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.openMapFile", async () => {
      const mapArtifact = _treeModel?.getArtifact("map");
      if (!mapArtifact?.exists) {
        // Action is disabled in the UI when the map file is missing;
        // silently return if somehow invoked without a valid path.
        return;
      }
      await openMapFile(mapArtifact.path);
    })
  );

  // --- Provider-change refresh: re-evaluate readiness when extensions change. ---
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      _intelliSenseService?.scheduleRefresh("provider-change");
    })
  );

  // --- Build-context selector commands. ---
  // Each selection also re-normalizes the active preset against the new
  // build context, via refreshPresetsAndBuildSelection. All selectors
  // share the same guard and post-selection refresh chain.
  const registerSelector = (
    command: string,
    apply: (id: string, state: ManifestStateLoaded) => Promise<unknown>
  ): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async (id: string) => {
        const state = _manifestState;
        if (!state || state.status !== "loaded") { return; }
        await apply(id, state);
        await _presetOptions.refresh(context);
        refreshStatusBar();
        _intelliSenseService?.setBuildContext(_buildSelection);
        refreshArtifactFileWatcher();
        refreshBuildArtifacts("build-selection-change");
      })
    );
  };

  registerSelector("tbench.selectModel", (id, state) => selectModel(context, id, state));
  registerSelector("tbench.selectTarget", (id, state) => selectTarget(context, id, state));
  registerSelector("tbench.selectComponent", (id, state) => selectComponent(context, id, state));
  // Preset selector: not a contributed command — invoked only
  // through the Preset selector's tree-item command binding.
  registerSelector("tbench.selectPreset", (id, state) => selectPreset(context, id, state));

  // --- Workflow commands: Build / Clippy / Check / Clean. ---
  // Build/Clippy/Check reload preset inputs and recompute before deriving
  // arguments; Clean is exempt from preset
  // blocking entirely.
  const registerWorkflowCommand = (kind: WorkflowKind): vscode.Disposable =>
    vscode.commands.registerCommand(`tbench.${kind.toLowerCase()}`, async () => {
      if (kind !== "Clean") {
        await _presetService?.reload();
        await _presetOptions.refresh(context);
      }

      const state = _manifestState;
      const manifest = loadedManifest(state);
      const buildSelection = _buildSelection;
      const wfCtx = manifest && buildSelection ? resolveWorkflowContext(manifest, buildSelection) : undefined;
      const blockReason = evaluateWorkflowPreconditions({
        manifestStatus: state?.status ?? "missing",
        hasWorkflowBlockingIssues: manifest?.hasWorkflowBlockingIssues ?? false,
        workspaceSupported: isWorkflowWorkspaceSupported(),
        buildSelectionResolved: !!wfCtx,
        presetsUnavailable: kind !== "Clean" && _presetOptions.presetsUnavailable,
        presetsInvalid: kind !== "Clean" && _presetOptions.presetBlocked,
      });

      if (blockReason !== "no-block") {
        reportWorkflowBlocked(kind, blockReason);
        return;
      }

      if (!wfCtx) {
        reportWorkflowBlocked(kind, "context-unresolved");
        return;
      }

      const task = createWorkflowTask(kind, wfCtx, workspaceFolder, _presetOptions.resolvedOptions, activePresetId(buildSelection!));
      await executeWorkflowTask(task, kind);
    });

  context.subscriptions.push(
    registerWorkflowCommand("Build"),
    registerWorkflowCommand("Clippy"),
    registerWorkflowCommand("Check"),
    registerWorkflowCommand("Clean")
  );

  // --- Build-option toggle/select commands. ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.toggleBuildOption", async (key: string) => {
      const resolved = _presetOptions.resolvedOptions.find((r) => r.option.key === key);
      if (!resolved || !resolved.available || resolved.option.kind !== "checkbox") {
        return;
      }
      const newValue = resolved.value !== true;
      await writeBuildOption(context, key, newValue);
      refreshResolvedOptionsView();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tbench.selectBuildOptionState",
      async (key: string, stateId: string) => {
        const resolved = _presetOptions.resolvedOptions.find((r) => r.option.key === key);
        if (!resolved || !resolved.available || resolved.option.kind !== "multistate") {
          return;
        }
        if (!resolved.option.states?.some((s) => s.id === stateId)) {
          return;
        }
        await writeBuildOption(context, key, stateId);
        refreshResolvedOptionsView();
      }
    )
  );

  // --- Task provider. ---
  const taskProvider = new BuildTaskProvider({
    getManifestState: () => loadedManifest(_manifestState),
    getBuildContext: () => _buildSelection,
    getResolvedOptions: () => _presetOptions.resolvedOptions,
    getActivePresetId: () => activePresetId(_buildSelection),
    getWorkspaceFolder: () => workspaceFolder,
  });
  context.subscriptions.push(vscode.tasks.registerTaskProvider(TASK_TYPE, taskProvider));

  context.subscriptions.push(
    vscode.tasks.onDidEndTaskProcess((event) => {
      if (isSuccessfulArtifactRefreshTaskProcess(event)) {
        refreshBuildArtifacts("workflow-task-complete");
      }
    })
  );

  // Trigger IntelliSense refresh when workspace folders change so excluded-file
  // candidate paths are re-evaluated against the updated workspace root.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      _intelliSenseService?.scheduleRefresh("workspace-change");
    })
  );

  const repositoryConfigService = new RepositoryConfigService(workspaceFolder);
  context.subscriptions.push(repositoryConfigService);
  let repositoryConfigWasInvalid = false;
  const applyRepositoryConfigState = async (): Promise<void> => {
    const state = repositoryConfigService.state;
    if (!state) {
      return;
    }
    handleRepositoryConfigDiagnostics(state);
    logRepositoryConfigState(state);
    if (state.status === "invalid") {
      setRepositoryConfig(workspaceFolder, undefined);
      _manifestStateSubscription?.dispose();
      _presetStateSubscription?.dispose();
      _manifestService?.dispose();
      _presetService?.dispose();
      _manifestService = undefined;
      _presetService = undefined;
      _manifestState = undefined;
      _presetState = undefined;
      _buildSelection = undefined;
      _presetOptions.clearResolvedOptions();
      _intelliSenseService?.setManifest(undefined);
      _intelliSenseService?.setBuildContext(undefined);
      _intelliSenseService?.setArtifactsRoot("");
      void vscode.commands.executeCommand("setContext", "tbench.workflowBlocked", true);
      if (!repositoryConfigWasInvalid) {
        repositoryConfigWasInvalid = true;
        notifyError("tbench.toml is invalid. Check the Problems view.");
      }
      return;
    }

    repositoryConfigWasInvalid = false;
    setRepositoryConfig(workspaceFolder, state.config);
    _intelliSenseService?.setArtifactsRoot(state.config.artifactsPath);
    _manifestStateSubscription?.dispose();
    _presetStateSubscription?.dispose();
    _manifestService?.dispose();
    _presetService?.dispose();
    _manifestService = new ManifestService(state.config.manifestUri);
    _presetService = new PresetService(state.config.presetUris.shared, state.config.presetUris.user);
    _manifestStateSubscription = _manifestService.onDidChangeState(onManifestStateChange);
    _presetStateSubscription = _presetService.onDidChangeState(onPresetStateChange);
    await _manifestService.start();
    await _presetService.start();
  };
  context.subscriptions.push(
    repositoryConfigService.onDidChangeState(() => {
      void applyRepositoryConfigState();
    })
  );

  // --- Start root configuration and its dependent services. ---
  await repositoryConfigService.start();

  // Schedule IntelliSense refresh on activation.
  refreshArtifactFileWatcher();
  _intelliSenseService?.scheduleRefresh("activation");
}

/**
 * Every service, watcher, view, and subscription registers its disposal on
 * `context.subscriptions` during activation — VS Code runs those on
 * deactivation, so only the two module-owned globals remain to tear down.
 */
export function deactivate(): void {
  _manifestState = undefined;
  _buildSelection = undefined;
  disposeDiagnostics();
  disposeLogChannel();
}
