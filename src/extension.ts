import * as vscode from "vscode";
import { hasSupportedWorkspace, requireWorkspaceFolder, isWorkflowWorkspaceSupported } from "./workspace/workspace-guard";
import { resolveManifestUri, isStatusBarEnabled, resolveArtifactsPath, resolveDebugTemplatesPath, resolvePresetUris } from "./workspace/settings";
import { ManifestService } from "./manifest/manifest-service";
import { PresetService } from "./presets/preset-service";
import { PresetState } from "./presets/preset-types";
import { derivePresetContext, listAvailablePresets, AvailablePreset } from "./presets/preset-resolution";
import { ConfigurationTreeProvider, SelectorHeaderItem, BuildOptionMultistateHeaderItem, BuildOptionCheckboxItem, BuildOptionGroupItem } from "./ui/configuration-tree";
import { StatusBarPresenter } from "./ui/status-bar";
import {
  disposeLogChannel,
  initLogChannel,
  logWarning,
  logError,
  revealLogs,
  logManifestState,
  logPresetState,
} from "./observability/log-channel";
import {
  disposeDiagnostics,
  handleManifestStateDiagnostics,
  handlePresetStateDiagnostics,
} from "./observability/diagnostics";
import {
  restoreActiveConfig,
  readActiveConfig,
  selectModel,
  selectTarget,
  selectComponent,
  selectPreset,
  activePresetId,
  ActiveConfig,
} from "./configuration/active-config";
import { normalizeActiveConfig } from "./configuration/normalize-config";
import {
  readBuildOptions,
  writeBuildOption,
  normalizeBuildOptions,
  ResolvedOption,
} from "./configuration/build-options";
import { ManifestState, ManifestStateLoaded } from "./manifest/manifest-types";
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
  TASK_TYPE,
} from "./tasks/build-task-provider";
import { IntelliSenseService } from "./intellisense/intellisense-service";
import { RefreshTrigger } from "./intellisense/intellisense-types";
import { applyProviderSettingFix } from "./intellisense/cpptools-provider";
import { ActiveArtifactFileWatcher } from "./intellisense/artifact-file-watcher";
import { ExcludedFilesService } from "./intellisense/excluded-files-service";
import { ExcludedFilesRefreshCoordinator } from "./intellisense/excluded-files-refresh";
import { ExcludedFileDecorationsProvider } from "./ui/excluded-file-decorations";
import { ExcludedFileOverlaysManager } from "./ui/excluded-file-overlays";
import {
  evaluateArtifactActionPreconditions,
  isFlashApplicable,
  isUploadApplicable,
  shouldShowArtifactRows,
  resolveArtifactActionContext,
  createFlashTask,
  createUploadTask,
  executeArtifactTask,
  reportArtifactActionBlocked,
  openMapFile,
} from "./commands/artifact-actions";
import {
  buildResolutionInputs,
  resolveActiveArtifact,
  resolveActiveBinaryArtifact,
  resolveActiveMapArtifact,
  resolveActiveExecutableArtifact,
  ActiveBinaryArtifact,
  ActiveMapArtifact,
} from "./intellisense/artifact-resolution";
import { executeDebugLaunch } from "./commands/debug-launch";
import { logDebugLaunchFailure } from "./observability/log-channel";
import { EvalContext } from "./manifest/when-expressions";
import {
  TfToolsDebugConfigurationProvider,
  TFTOOLS_DEBUG_TYPE,
} from "./debug/run-debug-provider";

let _manifestService: ManifestService | undefined;
let _presetService: PresetService | undefined;
let _presetState: PresetState | undefined;
let _presetStateSubscription: vscode.Disposable | undefined;
let _treeProvider: ConfigurationTreeProvider | undefined;
let _configurationTreeView: vscode.TreeView<vscode.TreeItem> | undefined;
let _statusBar: StatusBarPresenter | undefined;
let _manifestState: ManifestState | undefined;
let _activeConfig: ActiveConfig | undefined;
let _resolvedOptions: ReadonlyArray<ResolvedOption> = [];
let _intelliSenseService: IntelliSenseService | undefined;
let _artifactFileWatcher: ActiveArtifactFileWatcher | undefined;
let _excludedFilesService: ExcludedFilesService | undefined;
let _excludedFilesRefreshCoordinator: ExcludedFilesRefreshCoordinator | undefined;
let _excludedFileDecorations: ExcludedFileDecorationsProvider | undefined;
let _excludedFileOverlays: ExcludedFileOverlaysManager | undefined;
let _manifestStateSubscription: vscode.Disposable | undefined;
let _debugConfigProviderRegistration: vscode.Disposable | undefined;
/** Tracks the last wrong-provider state offered to the user to avoid duplicate Fix notifications. */
let _lastShownProviderFixState: string = "none";
/** Binary and Map artifact state for Flash/Upload/openMapFile context keys. */
let _binaryArtifact: ActiveBinaryArtifact | undefined;
let _mapArtifact: ActiveMapArtifact | undefined;

export interface TaskProcessEndLike {
  readonly exitCode?: number;
  readonly execution: {
    readonly task: {
      readonly definition: { readonly type?: string; readonly kind?: string };
      readonly name: string;
    };
  };
}

export function isSuccessfulArtifactRefreshTaskProcess(
  event: TaskProcessEndLike
): boolean {
  if (event.exitCode !== 0 || event.execution.task.definition.type !== TASK_TYPE) {
    return false;
  }

  const kind = event.execution.task.definition.kind;
  return kind === "Build" || kind === "Clean" ||
    event.execution.task.name.startsWith("Build ") ||
    event.execution.task.name === "Clean";
}

// ---------------------------------------------------------------------------
// Scope guard for the supported command surface, now expanded for
// Build Workflow, IntelliSense, Flash/Upload, and Debug Launch.
//
// This extension contributes ONLY the commands listed below in these feature
// slices. Debug and all other cross-slice commands are intentionally absent.
// Any attempt to register them here is a scope violation.
//
// Allowed commands:
//   tfTools.showLogs              — reveal the output channel
//   tfTools.build                 — launch Build task
//   tfTools.clippy                — launch Clippy task
//   tfTools.check                 — launch Check task
//   tfTools.clean                 — launch Clean task
//   tfTools.refreshIntelliSense   — manual IntelliSense refresh
//   tfTools.flash                 — launch Flash task (Flash/Upload slice)
//   tfTools.upload                — launch Upload task (Flash/Upload slice)
//   tfTools.openMapFile           — open resolved map file (Flash/Upload slice)
//   tfTools.startDebugging        — launch debug session (Debug Launch slice)
// ---------------------------------------------------------------------------

const ALLOWED_CONTRIBUTION_COMMANDS = new Set([
  "tfTools.showLogs",
  "tfTools.build",
  "tfTools.clippy",
  "tfTools.check",
  "tfTools.clean",
  "tfTools.refreshIntelliSense",
  "tfTools.flash",
  "tfTools.upload",
  "tfTools.openMapFile",
  "tfTools.startDebugging",
]);

/**
 * Development-time guard: verifies that no unauthorized tfTools commands are
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
    .filter((cmd: string) => cmd.startsWith("tfTools."))
    .filter((cmd: string) => !ALLOWED_CONTRIBUTION_COMMANDS.has(cmd));

  if (unauthorized.length > 0) {
    const msg =
      `Trezor Firmware Tools scope violation: ` +
      `unauthorized commands found in package.json: ${unauthorized.join(", ")}`;
    void vscode.window.showWarningMessage(msg);
  }
}

/**
 * Computes the resolved build options for the given manifest state, active
 * configuration, and current persisted selections. Returns an empty array
 * when the manifest is not loaded or no active configuration is available.
 */
function computeResolvedOptions(
  state: ManifestState,
  activeConfig: ActiveConfig | undefined,
  context: vscode.ExtensionContext
): ResolvedOption[] {
  if (state.status !== "loaded" || !activeConfig) {
    return [];
  }
  const loaded = state as ManifestStateLoaded;
  const saved = readBuildOptions(context);
  return normalizeBuildOptions(loaded.buildOptions, saved, activeConfig);
}

/**
 * Recomputes available presets against the current manifest, active build
 * context, and preset state; normalizes and persists the active preset id
 * when it changed; and refreshes the `Presets` selector and Build Options
 * (FR-009). The single entry point for every preset-relevant trigger:
 * activation, preset-state change, manifest-state change, and active
 * model/target/component change.
 */
async function refreshPresetsAndActiveConfig(
  context: vscode.ExtensionContext
): Promise<void> {
  const manifestState = _manifestState;
  if (!manifestState || manifestState.status !== "loaded") {
    _treeProvider?.updatePresets(_presetState, undefined, []);
    return;
  }
  const loaded = manifestState as ManifestStateLoaded;

  const savedAxes = normalizeActiveConfig(loaded, readActiveConfig(context));

  let available: AvailablePreset[] = [];
  let availableIds: Set<string> | undefined;
  if (_presetState && _presetState.status === "loaded") {
    const presetCtx = derivePresetContext(loaded, savedAxes);
    available = listAvailablePresets(_presetState.shared, _presetState.user, presetCtx);
    availableIds = new Set(available.map((p) => p.id));
  }

  const normalizedConfig = await restoreActiveConfig(context, loaded, availableIds);
  _activeConfig = normalizedConfig;
  _resolvedOptions = computeResolvedOptions(loaded, normalizedConfig, context);

  _treeProvider?.update(loaded, normalizedConfig, _resolvedOptions);
  _treeProvider?.updatePresets(_presetState, activePresetId(normalizedConfig), available);
}

/**
 * Updates the `tfTools.workflowBlocked` VS Code context key so that
 * view/title menu `enablement` clauses reflect the current state.
 */
function updateWorkflowBlockedContext(state: ManifestState): void {
  const loaded = state.status === "loaded" ? (state as ManifestStateLoaded) : undefined;
  const blocked =
    evaluateWorkflowPreconditions({
      manifestStatus: state.status,
      hasWorkflowBlockingIssues: loaded?.hasWorkflowBlockingIssues ?? false,
      workspaceSupported: isWorkflowWorkspaceSupported(),
    }) !== "no-block";
  vscode.commands.executeCommand("setContext", "tfTools.workflowBlocked", blocked);
}

/**
 * Updates the four Flash/Upload/map VS Code context keys based on the current
 * manifest state, active configuration, and artifact-resolution results.
 */
function updateArtifactActionContext(
  state: ManifestState,
  config: ActiveConfig | undefined,
  artifactsRoot: string,
  workspaceFolder: vscode.WorkspaceFolder
): void {
  if (state.status !== "loaded" || !config) {
    _binaryArtifact = undefined;
    _mapArtifact = undefined;
    vscode.commands.executeCommand("setContext", "tfTools.flashApplicable", false);
    vscode.commands.executeCommand("setContext", "tfTools.uploadApplicable", false);
    vscode.commands.executeCommand("setContext", "tfTools.binaryExists", false);
    vscode.commands.executeCommand("setContext", "tfTools.mapExists", false);
    return;
  }

  const loaded = state as ManifestStateLoaded;
  const component = loaded.components.find((c) => c.id === config.componentId);
  const evalCtx: EvalContext = {
    modelId: config.modelId,
    targetId: config.targetId,
    componentId: config.componentId,
  };

  const flashApplicable = component ? isFlashApplicable(component, evalCtx) : false;
  const uploadApplicable = component ? isUploadApplicable(component, evalCtx) : false;
  const showArtifactRows = shouldShowArtifactRows(flashApplicable, uploadApplicable);

  const inputs = buildResolutionInputs(loaded, config, artifactsRoot);
  let binaryExists = false;
  let mapExists = false;

  if (inputs && showArtifactRows) {
    const binary = resolveActiveBinaryArtifact(inputs, config);
    const map = resolveActiveMapArtifact(inputs, config);
    _binaryArtifact = binary;
    _mapArtifact = map;
    binaryExists = binary.exists;
    mapExists = map.exists;
    _treeProvider?.updateBinaryArtifact(binary, workspaceFolder);
    _treeProvider?.updateMapArtifact(map, workspaceFolder);
  } else {
    _binaryArtifact = undefined;
    _mapArtifact = undefined;
    _treeProvider?.updateBinaryArtifact(null, workspaceFolder);
    _treeProvider?.updateMapArtifact(null, workspaceFolder);
  }

  vscode.commands.executeCommand("setContext", "tfTools.flashApplicable", flashApplicable);
  vscode.commands.executeCommand("setContext", "tfTools.uploadApplicable", uploadApplicable);
  vscode.commands.executeCommand("setContext", "tfTools.binaryExists", binaryExists);
  vscode.commands.executeCommand("setContext", "tfTools.mapExists", mapExists);
}

/**
 * Updates the `tfTools.startDebuggingEnabled` VS Code context key based on the
 * current manifest state, active configuration, and executable artifact status.
 */
function updateDebugContext(
  state: ManifestState,
  config: ActiveConfig | undefined,
  artifactsRoot: string
): void {
  if (state.status !== "loaded" || !config) {
    vscode.commands.executeCommand("setContext", "tfTools.startDebuggingEnabled", false);
    _treeProvider?.updateExecutableArtifact(null);
    return;
  }

  const loaded = state as ManifestStateLoaded;
  const artifact = resolveActiveExecutableArtifact(loaded, config, artifactsRoot);
  const enabled = artifact.status === "valid";
  vscode.commands.executeCommand("setContext", "tfTools.startDebuggingEnabled", enabled);
  _treeProvider?.updateExecutableArtifact(artifact);
}

function updateCompileCommandsTreeArtifact(
  state: ManifestState,
  config: ActiveConfig | undefined,
  artifactsRoot: string
): void {
  if (state.status !== "loaded" || !config) {
    _treeProvider?.updateArtifact(null);
    return;
  }

  const loaded = state as ManifestStateLoaded;
  const inputs = buildResolutionInputs(loaded, config, artifactsRoot);
  const artifact = inputs ? resolveActiveArtifact(inputs, config) : null;
  _treeProvider?.updateArtifact(artifact);
}

function registerUnsupportedWorkspaceCommands(
  context: vscode.ExtensionContext
): void {
  const registerNoop = (command: string): vscode.Disposable =>
    vscode.commands.registerCommand(command, async () => {
      return;
    });

  const registerBlockedWorkflow = (kind: WorkflowKind): vscode.Disposable =>
    vscode.commands.registerCommand(`tfTools.${kind.toLowerCase()}`, async () => {
      reportWorkflowBlocked(kind, "workspace-unsupported");
    });

  const registerBlockedArtifact = (
    command: "tfTools.flash" | "tfTools.upload",
    kind: "flash" | "upload"
  ): vscode.Disposable =>
    vscode.commands.registerCommand(command, async () => {
      reportArtifactActionBlocked(kind, "workspace-unsupported");
    });

  context.subscriptions.push(
    vscode.commands.registerCommand("tfTools.showLogs", () => {
      revealLogs();
    }),
    vscode.commands.registerCommand("tfTools.refreshIntelliSense", async () => {
      return;
    }),
    registerBlockedWorkflow("Build"),
    registerBlockedWorkflow("Clippy"),
    registerBlockedWorkflow("Check"),
    registerBlockedWorkflow("Clean"),
    registerBlockedArtifact("tfTools.flash", "flash"),
    registerBlockedArtifact("tfTools.upload", "upload"),
    registerNoop("tfTools.openMapFile"),
    vscode.commands.registerCommand("tfTools.startDebugging", () => {
      logDebugLaunchFailure("unsupported-workspace", {
        detail: "workspace is not supported",
      });
      revealLogs();
      void vscode.window.showErrorMessage(
        "Cannot start debugging: workspace is not supported."
      );
    }),
    registerNoop("tfTools.selectModel"),
    registerNoop("tfTools.selectTarget"),
    registerNoop("tfTools.selectComponent"),
    registerNoop("tfTools.selectPreset"),
    registerNoop("tfTools.toggleBuildOption"),
    registerNoop("tfTools.selectBuildOptionState")
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initLogChannel();

  // --- Scope guard: verify no unrelated commands are registered. ---
  assertNoUnauthorizedContributions(context);

  // Always register the tree provider so VS Code never shows
  // "no data provider registered" when the activity bar is clicked.
  _treeProvider = new ConfigurationTreeProvider();
  _configurationTreeView = vscode.window.createTreeView("tfTools.configuration", {
    treeDataProvider: _treeProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(
    _configurationTreeView,
    _configurationTreeView.onDidExpandElement(({ element }) => {
      if (element instanceof SelectorHeaderItem) {
        _treeProvider?.setExpandedSelector(element.selectorKind);
      } else if (element instanceof BuildOptionMultistateHeaderItem) {
        _treeProvider?.setExpandedMultistateKey(element.optionKey);
      } else if (element instanceof BuildOptionGroupItem) {
        _treeProvider?.setGroupCollapsed(element.groupLabel, false);
      }
    }),
    _configurationTreeView.onDidCollapseElement(({ element }) => {
      if (element instanceof SelectorHeaderItem) {
        if (_treeProvider?.getExpandedSelector() === element.selectorKind) {
          _treeProvider.setExpandedSelector(undefined);
        }
      } else if (element instanceof BuildOptionMultistateHeaderItem) {
        if (_treeProvider?.getExpandedMultistateKey() === element.optionKey) {
          _treeProvider.setExpandedMultistateKey(undefined);
        }
      } else if (element instanceof BuildOptionGroupItem) {
        _treeProvider?.setGroupCollapsed(element.groupLabel, true);
      }
    }),
    _configurationTreeView.onDidChangeCheckboxState(async ({ items }) => {
      for (const [element, state] of items) {
        if (!(element instanceof BuildOptionCheckboxItem)) {
          continue;
        }
        const newValue = state === vscode.TreeItemCheckboxState.Checked;
        await writeBuildOption(context, element.optionKey, newValue);
      }
      const manifestState = _manifestState;
      if (manifestState) {
        _resolvedOptions = computeResolvedOptions(manifestState, _activeConfig, context);
        _treeProvider?.update(manifestState, _activeConfig, _resolvedOptions);
      }
    })
  );

  if (!hasSupportedWorkspace()) {
    registerUnsupportedWorkspaceCommands(context);
    // Extension activated without a workspace — show a visible warning and bail.
    const noWorkspaceMsg =
      "Trezor Firmware Tools requires an open workspace folder.";
    logWarning(noWorkspaceMsg);
    // Mark workflow as blocked (workspace unsupported) so header actions are disabled.
    vscode.commands.executeCommand("setContext", "tfTools.workflowBlocked", true);
    return;
  }

  const workspaceFolder = requireWorkspaceFolder();
  const manifestUri = resolveManifestUri(workspaceFolder);
  const refreshArtifactFileWatcher = (): void => {
    const loadedState =
      _manifestState?.status === "loaded"
        ? (_manifestState as ManifestStateLoaded)
        : undefined;

    _artifactFileWatcher?.update(
      loadedState,
      _activeConfig,
      resolveArtifactsPath(workspaceFolder)
    );
  };
  const refreshArtifactActionState = (): void => {
    if (!_manifestState) {
      return;
    }

    updateArtifactActionContext(
      _manifestState,
      _activeConfig,
      resolveArtifactsPath(workspaceFolder),
      workspaceFolder
    );
    updateDebugContext(
      _manifestState,
      _activeConfig,
      resolveArtifactsPath(workspaceFolder)
    );
  };
  const refreshStatusBar = (): void => {
    if (!_manifestState) {
      return;
    }

    _statusBar?.update(
      _manifestState,
      _activeConfig,
      isStatusBarEnabled(workspaceFolder)
    );
  };
  const refreshBuildArtifacts = (trigger: RefreshTrigger): void => {
    if (_manifestState) {
      updateCompileCommandsTreeArtifact(
        _manifestState,
        _activeConfig,
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
  _artifactFileWatcher = new ActiveArtifactFileWatcher(() => {
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

  // --- Excluded-file visibility services: explorer badges and editor overlays. ---
  _excludedFilesService = new ExcludedFilesService();
  _excludedFilesRefreshCoordinator = new ExcludedFilesRefreshCoordinator(
    _excludedFilesService,
    workspaceFolder
  );
  _excludedFileDecorations = new ExcludedFileDecorationsProvider();
  _excludedFileOverlays = new ExcludedFileOverlaysManager();
  context.subscriptions.push(
    { dispose: () => { _excludedFilesService?.dispose(); _excludedFilesService = undefined; } },
    { dispose: () => { _excludedFilesRefreshCoordinator?.dispose(); _excludedFilesRefreshCoordinator = undefined; } },
    { dispose: () => { _excludedFileDecorations?.dispose(); _excludedFileDecorations = undefined; } },
    { dispose: () => { _excludedFileOverlays?.dispose(); _excludedFileOverlays = undefined; } },
    vscode.window.registerFileDecorationProvider(_excludedFileDecorations)
  );

  // Connect snapshot updates → decoration provider so Explorer badges refresh.
  context.subscriptions.push(
    _excludedFilesService.onDidUpdateSnapshot((snapshot) => {
      _excludedFileDecorations?.handleSnapshot(snapshot);
      _excludedFileOverlays?.handleSnapshot(snapshot);
    })
  );

  // Re-apply overlays whenever new editors become visible.
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(() => {
      _excludedFileOverlays?.applyToVisibleEditors();
    })
  );

  // Connect IntelliSense payload changes → excluded-file recomputation.
  context.subscriptions.push(
    _intelliSenseService.onDidRefreshPayload((payload) => {
      _excludedFilesRefreshCoordinator?.handlePayload(payload);
    })
  );

  // Subscribe to IntelliSense refresh results → update tree view artifact row
  context.subscriptions.push(
    _intelliSenseService.onDidRefresh(([artifact, readiness]) => {
      const state = _manifestState;
      if (state) {
        _treeProvider?.updateArtifact(artifact);
      }
      // Show the wrong-provider fix notification once per state entry.
      if (readiness.warningState === "wrong-provider" && readiness.warningState !== _lastShownProviderFixState) {
        _lastShownProviderFixState = "wrong-provider";
        vscode.window.showWarningMessage(
          readiness.lastWarningMessage ??
            "IntelliSense: another C/C++ configuration provider is active. Switch to Trezor Firmware Tools?",
          "Fix"
        ).then((selection) => {
          if (selection === "Fix") {
            applyProviderSettingFix(workspaceFolder, () => {
              _lastShownProviderFixState = "none";
              _intelliSenseService?.scheduleRefresh("active-config-change");
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

  // Watch for tfTools.artifactsPath AND tfTools.manifestPath configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("tfTools.artifactsPath", workspaceFolder.uri)) {
        _intelliSenseService?.setArtifactsRoot(resolveArtifactsPath(workspaceFolder));
        refreshArtifactFileWatcher();
        refreshBuildArtifacts("artifacts-path-change");
      }
      if (e.affectsConfiguration("tfTools.debug.templatesPath", workspaceFolder.uri)) {
        // The templates path does not affect startDebuggingEnabled (templates are validated
        // at invocation time, not pre-checked). Trigger a context refresh to keep the tree
        // and context keys consistent with the new setting if future logic depends on it.
        refreshArtifactActionState();
      }
      if (e.affectsConfiguration("tfTools.showConfigurationInStatusBar", workspaceFolder.uri)) {
        refreshStatusBar();
      }
      if (
        e.affectsConfiguration("tfTools.excludedFiles.grayInTree", workspaceFolder.uri) ||
        e.affectsConfiguration("tfTools.excludedFiles.showEditorOverlay", workspaceFolder.uri) ||
        e.affectsConfiguration("tfTools.excludedFiles.fileNamePatterns", workspaceFolder.uri) ||
        e.affectsConfiguration("tfTools.excludedFiles.folderGlobs", workspaceFolder.uri)
      ) {
        _intelliSenseService?.scheduleRefresh("excluded-files-setting-change");
      }
      if (e.affectsConfiguration("tfTools.manifestPath", workspaceFolder.uri)) {
        // Restart the manifest service with the newly resolved path.
        // The resulting onDidChangeState fires will propagate "manifest-change"
        // to the IntelliSense service automatically.
        _manifestStateSubscription?.dispose();
        _manifestService?.dispose();
        const newManifestUri = resolveManifestUri(workspaceFolder);
        _manifestService = new ManifestService(newManifestUri);
        _manifestStateSubscription = _manifestService.onDidChangeState(onManifestStateChange);
        _manifestService.start().catch((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          const message = `Failed to start manifest service after path change: ${detail}`;
          logError(`[tf-tools] ${message}`);
        });
      }
      if (e.affectsConfiguration("tfTools.cargoWorkspacePath", workspaceFolder.uri)) {
        // Restart the preset service against the newly resolved xtask/tf-tools
        // directory (research Decision 2, Decision 14).
        _presetStateSubscription?.dispose();
        _presetService?.dispose();
        const newPresetUris = resolvePresetUris(workspaceFolder);
        _presetService = new PresetService(newPresetUris.shared, newPresetUris.user);
        _presetStateSubscription = _presetService.onDidChangeState(onPresetStateChange);
        _presetService.start().catch((err) => {
          const detail = err instanceof Error ? err.message : String(err);
          const message = `Failed to start preset service after cargo workspace path change: ${detail}`;
          logError(`[tf-tools] ${message}`);
        });
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

  // Connect manifest state changes to the tree provider, diagnostics, and logs.
  // On each state change, restore and normalize the active config and the
  // active preset together (FR-009).
  const onManifestStateChange = async (state: ManifestState): Promise<void> => {
    _manifestState = state;
    if (state.status === "loaded") {
      await refreshPresetsAndActiveConfig(context);
    } else {
      _activeConfig = undefined;
      _resolvedOptions = [];
      _treeProvider?.update(state, undefined, []);
      _treeProvider?.updatePresets(_presetState, undefined, []);
    }
    refreshStatusBar();
    handleManifestStateDiagnostics(state);
    logManifestState(state);
    updateWorkflowBlockedContext(state);

    // Update IntelliSense service with the new manifest state
    const loadedState = state.status === "loaded" ? (state as ManifestStateLoaded) : undefined;
    _intelliSenseService?.setManifest(loadedState);
    _intelliSenseService?.setActiveConfig(_activeConfig);
    refreshArtifactFileWatcher();
    refreshBuildArtifacts("manifest-change");
  };

  _manifestStateSubscription = _manifestService.onDidChangeState(onManifestStateChange);

  // --- Preset service (feature 009) ---
  const presetUris = resolvePresetUris(workspaceFolder);
  _presetService = new PresetService(presetUris.shared, presetUris.user);
  context.subscriptions.push({
    dispose: () => {
      _presetStateSubscription?.dispose();
      _presetService?.dispose();
    },
  });

  // Connect preset state changes to diagnostics, logs, and available-preset
  // recomputation/normalization (FR-009).
  const onPresetStateChange = async (state: PresetState): Promise<void> => {
    _presetState = state;
    handlePresetStateDiagnostics(state);
    logPresetState(state);
    await refreshPresetsAndActiveConfig(context);
  };

  _presetStateSubscription = _presetService.onDidChangeState(onPresetStateChange);

  // --- Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tfTools.showLogs", () => {
      revealLogs();
    })
  );

  // --- Refresh IntelliSense command. ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tfTools.refreshIntelliSense", () => {
      _intelliSenseService?.scheduleRefresh("manual-refresh");
    })
  );

  // --- Flash command. ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tfTools.flash", async () => {
      const state = _manifestState;
      const config = _activeConfig;
      const loaded = state?.status === "loaded" ? (state as ManifestStateLoaded) : undefined;
      const component = loaded?.components.find((c) => c.id === config?.componentId);
      const evalCtx: EvalContext | undefined = config
        ? { modelId: config.modelId, targetId: config.targetId, componentId: config.componentId }
        : undefined;

      const blockReason = evaluateArtifactActionPreconditions({
        workspaceSupported: isWorkflowWorkspaceSupported(),
        manifestStatus: state?.status ?? "missing",
        actionApplicable: !!(component && evalCtx && isFlashApplicable(component, evalCtx)),
        binaryExists: _binaryArtifact?.exists ?? false,
      });

      if (blockReason !== "no-block") {
        reportArtifactActionBlocked("flash", blockReason);
        return;
      }

      const ctx = loaded && config ? resolveArtifactActionContext(loaded, config) : undefined;
      if (!ctx) { return; }

      const task = createFlashTask(ctx, workspaceFolder);
      await executeArtifactTask(task, "flash");
    })
  );

  // --- Upload command. ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tfTools.upload", async () => {
      const state = _manifestState;
      const config = _activeConfig;
      const loaded = state?.status === "loaded" ? (state as ManifestStateLoaded) : undefined;
      const component = loaded?.components.find((c) => c.id === config?.componentId);
      const evalCtx: EvalContext | undefined = config
        ? { modelId: config.modelId, targetId: config.targetId, componentId: config.componentId }
        : undefined;

      const blockReason = evaluateArtifactActionPreconditions({
        workspaceSupported: isWorkflowWorkspaceSupported(),
        manifestStatus: state?.status ?? "missing",
        actionApplicable: !!(component && evalCtx && isUploadApplicable(component, evalCtx)),
        binaryExists: _binaryArtifact?.exists ?? false,
      });

      if (blockReason !== "no-block") {
        reportArtifactActionBlocked("upload", blockReason);
        return;
      }

      const ctx = loaded && config ? resolveArtifactActionContext(loaded, config) : undefined;
      if (!ctx) { return; }

      const task = createUploadTask(ctx, workspaceFolder);
      await executeArtifactTask(task, "upload");
    })
  );

  // --- startDebugging command (Debug Launch slice) ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tfTools.startDebugging", async () => {
      const state = _manifestState;
      const config = _activeConfig;
      const loaded = state?.status === "loaded" ? (state as ManifestStateLoaded) : undefined;
      if (!loaded || !config) {
        logDebugLaunchFailure("unsupported-workspace", {
          detail: "manifest not loaded or no active configuration",
        });
        revealLogs();
        void vscode.window.showErrorMessage("Cannot start debugging: manifest not loaded.");
        return;
      }
      await executeDebugLaunch(workspaceFolder, loaded, config);
    })
  );

  // --- Run and Debug provider (Run and Debug Integration slice) ---
  const debugConfigProvider = new TfToolsDebugConfigurationProvider(
    () => _manifestState?.status === "loaded" ? (_manifestState as ManifestStateLoaded) : undefined,
    () => _activeConfig,
    () => resolveArtifactsPath(workspaceFolder),
    () => resolveDebugTemplatesPath(workspaceFolder),
    workspaceFolder
  );
  _debugConfigProviderRegistration?.dispose();
  _debugConfigProviderRegistration = vscode.debug.registerDebugConfigurationProvider(
    TFTOOLS_DEBUG_TYPE,
    debugConfigProvider,
    vscode.DebugConfigurationProviderTriggerKind.Dynamic
  );
  context.subscriptions.push(_debugConfigProviderRegistration);

  // --- openMapFile command, scoped to the artifact row. ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tfTools.openMapFile", async () => {
      const mapArtifact = _mapArtifact;
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
  // build context (FR-009), via refreshPresetsAndActiveConfig.
  context.subscriptions.push(
    vscode.commands.registerCommand("tfTools.selectModel", async (modelId: string) => {
      const state = _manifestState;
      if (!state || state.status !== "loaded") { return; }
      await selectModel(context, modelId, state);
      await refreshPresetsAndActiveConfig(context);
      refreshStatusBar();
      _intelliSenseService?.setActiveConfig(_activeConfig);
      refreshArtifactFileWatcher();
      refreshBuildArtifacts("active-config-change");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tfTools.selectTarget", async (targetId: string) => {
      const state = _manifestState;
      if (!state || state.status !== "loaded") { return; }
      await selectTarget(context, targetId, state);
      await refreshPresetsAndActiveConfig(context);
      refreshStatusBar();
      _intelliSenseService?.setActiveConfig(_activeConfig);
      refreshArtifactFileWatcher();
      refreshBuildArtifacts("active-config-change");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tfTools.selectComponent", async (componentId: string) => {
      const state = _manifestState;
      if (!state || state.status !== "loaded") { return; }
      await selectComponent(context, componentId, state);
      await refreshPresetsAndActiveConfig(context);
      refreshStatusBar();
      _intelliSenseService?.setActiveConfig(_activeConfig);
      refreshArtifactFileWatcher();
      refreshBuildArtifacts("active-config-change");
    })
  );

  // --- Preset selector command (feature 009). Not a contributed command —
  // invoked only through the Presets selector's tree-item command binding. ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tfTools.selectPreset", async (presetId: string) => {
      const state = _manifestState;
      if (!state || state.status !== "loaded") { return; }
      await selectPreset(context, presetId, state);
      await refreshPresetsAndActiveConfig(context);
      refreshStatusBar();
      _intelliSenseService?.setActiveConfig(_activeConfig);
      refreshArtifactFileWatcher();
      refreshBuildArtifacts("active-config-change");
    })
  );

  // --- Workflow commands: Build / Clippy / Check / Clean. ---
  const registerWorkflowCommand = (kind: WorkflowKind): vscode.Disposable =>
    vscode.commands.registerCommand(`tfTools.${kind.toLowerCase()}`, async () => {
      const state = _manifestState;
      const loaded = state?.status === "loaded" ? (state as ManifestStateLoaded) : undefined;
      const blockReason = evaluateWorkflowPreconditions({
        manifestStatus: state?.status ?? "missing",
        hasWorkflowBlockingIssues: loaded?.hasWorkflowBlockingIssues ?? false,
        workspaceSupported: isWorkflowWorkspaceSupported(),
      });

      if (blockReason !== "no-block") {
        reportWorkflowBlocked(kind, blockReason);
        return;
      }

      const activeConfig = _activeConfig;
      if (!loaded || !activeConfig) {
        return;
      }

      const wfCtx = resolveWorkflowContext(loaded, activeConfig);
      if (!wfCtx) {
        return;
      }

      const task = createWorkflowTask(kind, wfCtx, workspaceFolder, _resolvedOptions);
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
    vscode.commands.registerCommand("tfTools.toggleBuildOption", async (key: string) => {
      const resolved = _resolvedOptions.find((r) => r.option.key === key);
      if (!resolved || !resolved.available || resolved.option.kind !== "checkbox") {
        return;
      }
      const newValue = resolved.value !== true;
      await writeBuildOption(context, key, newValue);
      const state = _manifestState;
      if (state) {
        _resolvedOptions = computeResolvedOptions(state, _activeConfig, context);
        _treeProvider?.update(state, _activeConfig, _resolvedOptions);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tfTools.selectBuildOptionState",
      async (key: string, stateId: string) => {
        const resolved = _resolvedOptions.find((r) => r.option.key === key);
        if (!resolved || !resolved.available || resolved.option.kind !== "multistate") {
          return;
        }
        if (!resolved.option.states?.some((s) => s.id === stateId)) {
          return;
        }
        await writeBuildOption(context, key, stateId);
        const state = _manifestState;
        if (state) {
          _resolvedOptions = computeResolvedOptions(state, _activeConfig, context);
          _treeProvider?.update(state, _activeConfig, _resolvedOptions);
        }
      }
    )
  );

  // --- Task provider. ---
  const taskProvider = new BuildTaskProvider({
    getManifestState: () =>
      _manifestState?.status === "loaded" ? (_manifestState as ManifestStateLoaded) : undefined,
    getActiveConfig: () => _activeConfig,
    getResolvedOptions: () => _resolvedOptions,
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

  // --- Start manifest and preset services (load and begin watching) ---
  await _manifestService.start();
  await _presetService.start();

  // Schedule IntelliSense refresh on activation.
  refreshArtifactFileWatcher();
  _intelliSenseService?.scheduleRefresh("activation");
}

export function deactivate(): void {
  _manifestStateSubscription?.dispose();
  _manifestStateSubscription = undefined;
  _presetStateSubscription?.dispose();
  _presetStateSubscription = undefined;
  _debugConfigProviderRegistration?.dispose();
  _debugConfigProviderRegistration = undefined;
  _manifestService?.dispose();
  _manifestService = undefined;
  _presetService?.dispose();
  _presetService = undefined;
  _treeProvider?.dispose();
  _treeProvider = undefined;
  _configurationTreeView?.dispose();
  _configurationTreeView = undefined;
  _statusBar?.dispose();
  _statusBar = undefined;
  _intelliSenseService?.dispose();
  _intelliSenseService = undefined;
  _artifactFileWatcher?.dispose();
  _artifactFileWatcher = undefined;
  _excludedFilesService?.dispose();
  _excludedFilesService = undefined;
  _excludedFilesRefreshCoordinator?.dispose();
  _excludedFilesRefreshCoordinator = undefined;
  _excludedFileDecorations?.dispose();
  _excludedFileDecorations = undefined;
  _excludedFileOverlays?.dispose();
  _excludedFileOverlays = undefined;
  _manifestState = undefined;
  _activeConfig = undefined;
  _resolvedOptions = [];
  _binaryArtifact = undefined;
  _mapArtifact = undefined;
  disposeDiagnostics();
  disposeLogChannel();
}
