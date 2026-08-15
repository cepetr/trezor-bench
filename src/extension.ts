import * as vscode from "vscode";
import { hasSupportedWorkspace, requireWorkspaceFolder, isWorkflowWorkspaceSupported } from "./workspace/workspace-guard";
import { resolveManifestUri, isStatusBarEnabled, resolveArtifactsPath, resolveDebugTemplatesPath, resolvePresetUris } from "./workspace/settings";
import { RepositoryConfigurationService, loadRepositoryConfiguration, setRepositoryConfiguration } from "./workspace/repository-configuration";
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
import { ConfigurationTreeProvider, PaneTreeProvider, SelectorHeaderItem, BuildOptionMultistateHeaderItem, BuildOptionCheckboxItem, BuildOptionGroupItem } from "./ui/configuration-tree";
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
  logRepositoryConfigurationState,
  notifyWarning,
  notifyError,
} from "./observability/log-channel";
import {
  disposeDiagnostics,
  handleManifestStateDiagnostics,
  handlePresetStateDiagnostics,
  handleRepositoryConfigurationDiagnostics,
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
  dropBuildOptionOverrides,
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
  TbenchDebugConfigurationProvider,
  TBENCH_DEBUG_TYPE,
} from "./debug/run-debug-provider";

let _manifestService: ManifestService | undefined;
let _presetService: PresetService | undefined;
let _presetState: PresetState | undefined;
let _presetEffectiveValues: ReadonlyMap<string, PresetEffectiveValue> = new Map();
/**
 * Backs the `tbench.presetBlocked` context key (an absent shared
 * `presets.toml`, file-level invalidity, or any available-option mismatch).
 */
let _presetBlocked = false;
/**
 * True only for the absent shared `presets.toml` (FR-027). Tracked separately
 * from `_presetBlocked` so the launch path can report the more specific
 * `presets-unavailable` reason; it always implies `_presetBlocked`.
 */
let _presetsUnavailable = false;
let _presetStateSubscription: vscode.Disposable | undefined;
let _treeProvider: ConfigurationTreeProvider | undefined;
let _configurationTreeView: vscode.TreeView<vscode.TreeItem> | undefined;
let _buildArtifactsTreeView: vscode.TreeView<vscode.TreeItem> | undefined;
let _buildOptionsTreeView: vscode.TreeView<vscode.TreeItem> | undefined;
let _statusBar: StatusBarPresenter | undefined;
let _manifestState: ManifestState | undefined;
let _activeConfig: ActiveConfig | undefined;
/**
 * The preset context the last refresh resolved against. Held beside
 * `_activeConfig` — the two are always written together — so a refresh can tell
 * whether the calculated values every stored override was authored against
 * still hold (FR-017). `undefined` until the first refresh with a loaded
 * manifest, which is what keeps activation from wiping a restored session.
 */
let _presetContext: PresetContext | undefined;
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
  activeConfig: ActiveConfig | undefined,
  context: vscode.ExtensionContext,
  presetEffectiveValues: ReadonlyMap<string, PresetEffectiveValue> = new Map()
): ResolvedOption[] {
  if (state.status !== "loaded" || !activeConfig) {
    return [];
  }
  const loaded = state as ManifestStateLoaded;
  const saved = readBuildOptions(context);
  return normalizeBuildOptions(loaded.buildOptions, saved, activeConfig, presetEffectiveValues);
}

/**
 * Recomputes the declared preset list and preset-effective build-option values
 * against the current manifest, active build context, and preset state;
 * normalizes and persists the active preset id when it changed; drops, when
 * the active preset or the preset context changed, exactly those explicit
 * build-option overrides whose calculated value moved with it (FR-017);
 * and refreshes the `Preset` selector and Build Options (FR-009, FR-013,
 * FR-017, SC-004). The single entry point for every preset-relevant
 * trigger: activation, preset-state change, manifest-state change, and
 * active model/target/component change.
 */
async function refreshPresetsAndActiveConfig(
  context: vscode.ExtensionContext
): Promise<void> {
  const manifestState = _manifestState;
  if (!manifestState || manifestState.status !== "loaded") {
    _presetEffectiveValues = new Map();
    _presetBlocked = false;
    _presetsUnavailable = false;
    vscode.commands.executeCommand("setContext", "tbench.presetBlocked", false);
    _treeProvider?.updatePresets(_presetState, undefined, []);
    return;
  }
  const loaded = manifestState as ManifestStateLoaded;

  const savedAxes = normalizeActiveConfig(loaded, readActiveConfig(context));
  const presetCtx = derivePresetContext(loaded, savedAxes);

  const currentPresetState = _presetState;
  const presets = currentPresetState?.status === "loaded" ? currentPresetState : undefined;

  // The choice list depends on the two preset files alone: every declared
  // preset is offered whatever the build context (FR-006), so `knownIds` only
  // ever retires an id the files no longer declare.
  let choices: PresetChoice[] = [];
  let knownIds: Set<string> | undefined;
  if (presets) {
    choices = listPresetChoices(presets.shared, presets.user);
    knownIds = new Set(choices.map((p) => p.id));
  }

  const previousPresetId = _activeConfig ? activePresetId(_activeConfig) : undefined;
  const previousPresetContext = _presetContext;
  const normalizedConfig = await restoreActiveConfig(context, loaded, knownIds);
  const newPresetId = activePresetId(normalizedConfig);

  const presetIdChanged = previousPresetId !== undefined && previousPresetId !== newPresetId;
  const presetContextChanged =
    previousPresetContext !== undefined && !samePresetContext(previousPresetContext, presetCtx);

  if (presetIdChanged) {
    logPresetNormalization(previousPresetId!, newPresetId);
  }

  _presetEffectiveValues = presets
    ? computePresetEffectiveValues(loaded.buildOptions, presets.shared, presets.user, newPresetId, presetCtx)
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
    // say what the user asked for and are kept (FR-017). Both change guards
    // require a known previous half, which is what keeps activation from
    // pruning the selections it just restored, and an unloaded preset state
    // never prunes because it can calculate neither side.
    const previousEffective = computePresetEffectiveValues(
      loaded.buildOptions,
      presets.shared,
      presets.user,
      previousPresetId ?? newPresetId,
      previousPresetContext ?? presetCtx
    );
    const shifted = shiftedPresetOptionKeys(previousEffective, _presetEffectiveValues);
    const dropped = await dropBuildOptionOverrides(context, shifted);
    const kept = Object.keys(readBuildOptions(context)?.values ?? {});
    if (presetIdChanged) {
      logOverridesPrunedForPreset(previousPresetId!, newPresetId, dropped, kept);
    } else {
      logOverridesPrunedForContext(previousPresetContext!, presetCtx, dropped, kept);
    }
  }

  _activeConfig = normalizedConfig;
  _presetContext = presetCtx;
  _resolvedOptions = computeResolvedOptions(loaded, normalizedConfig, context, _presetEffectiveValues);

  _presetsUnavailable = currentPresetState?.status === "unavailable";
  _presetBlocked =
    _presetsUnavailable ||
    currentPresetState?.status === "invalid" ||
    _resolvedOptions.some((r) => r.available && r.presetState === "mismatch");
  vscode.commands.executeCommand("setContext", "tbench.presetBlocked", _presetBlocked);

  _treeProvider?.update(loaded, normalizedConfig, _resolvedOptions);
  _treeProvider?.updatePresets(currentPresetState, newPresetId, choices);
}

/**
 * Updates the `tbench.workflowBlocked` VS Code context key so that
 * view/title menu `enablement` clauses reflect the current state.
 */
function updateWorkflowBlockedContext(state: ManifestState): void {
  const loaded = state.status === "loaded" ? (state as ManifestStateLoaded) : undefined;
  const activeConfigResolved = !!(
    loaded && _activeConfig && resolveWorkflowContext(loaded, _activeConfig)
  );
  const blocked =
    evaluateWorkflowPreconditions({
      manifestStatus: state.status,
      hasWorkflowBlockingIssues: loaded?.hasWorkflowBlockingIssues ?? false,
      workspaceSupported: isWorkflowWorkspaceSupported(),
      activeConfigResolved,
    }) !== "no-block";
  vscode.commands.executeCommand("setContext", "tbench.workflowBlocked", blocked);
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
    vscode.commands.executeCommand("setContext", "tbench.flashApplicable", false);
    vscode.commands.executeCommand("setContext", "tbench.uploadApplicable", false);
    vscode.commands.executeCommand("setContext", "tbench.binaryExists", false);
    vscode.commands.executeCommand("setContext", "tbench.mapExists", false);
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

  vscode.commands.executeCommand("setContext", "tbench.flashApplicable", flashApplicable);
  vscode.commands.executeCommand("setContext", "tbench.uploadApplicable", uploadApplicable);
  vscode.commands.executeCommand("setContext", "tbench.binaryExists", binaryExists);
  vscode.commands.executeCommand("setContext", "tbench.mapExists", mapExists);
}

/**
 * Updates the `tbench.startDebuggingEnabled` VS Code context key based on the
 * current manifest state, active configuration, and executable artifact status.
 */
function updateDebugContext(
  state: ManifestState,
  config: ActiveConfig | undefined,
  artifactsRoot: string
): void {
  if (state.status !== "loaded" || !config) {
    vscode.commands.executeCommand("setContext", "tbench.startDebuggingEnabled", false);
    _treeProvider?.updateExecutableArtifact(null);
    return;
  }

  const loaded = state as ManifestStateLoaded;
  const artifact = resolveActiveExecutableArtifact(loaded, config, artifactsRoot);
  const enabled = artifact.status === "valid";
  vscode.commands.executeCommand("setContext", "tbench.startDebuggingEnabled", enabled);
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
    vscode.commands.registerCommand(`tbench.${kind.toLowerCase()}`, async () => {
      reportWorkflowBlocked(kind, "workspace-unsupported");
    });

  const registerBlockedArtifact = (
    command: "tbench.flash" | "tbench.upload",
    kind: "flash" | "upload"
  ): vscode.Disposable =>
    vscode.commands.registerCommand(command, async () => {
      reportArtifactActionBlocked(kind, "workspace-unsupported");
    });

  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.showLogs", () => {
      revealLogs();
    }),
    vscode.commands.registerCommand("tbench.refreshIntelliSense", async () => {
      return;
    }),
    registerBlockedWorkflow("Build"),
    registerBlockedWorkflow("Clippy"),
    registerBlockedWorkflow("Check"),
    registerBlockedWorkflow("Clean"),
    registerBlockedArtifact("tbench.flash", "flash"),
    registerBlockedArtifact("tbench.upload", "upload"),
    registerNoop("tbench.openMapFile"),
    vscode.commands.registerCommand("tbench.startDebugging", () => {
      logDebugLaunchFailure("unsupported-workspace", {
        detail: "workspace is not supported",
      });
      revealLogs();
      notifyError("Cannot start debugging: workspace is not supported.");
    }),
    registerNoop("tbench.selectModel"),
    registerNoop("tbench.selectTarget"),
    registerNoop("tbench.selectComponent"),
    registerNoop("tbench.selectPreset"),
    registerNoop("tbench.toggleBuildOption"),
    registerNoop("tbench.selectBuildOptionState")
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initLogChannel();

  // --- Scope guard: verify no unrelated commands are registered. ---
  assertNoUnauthorizedContributions(context);

  // Always register the tree provider so VS Code never shows
  // "no data provider registered" when the activity bar is clicked.
  _treeProvider = new ConfigurationTreeProvider();
  _configurationTreeView = vscode.window.createTreeView("tbench.configuration", {
    treeDataProvider: new PaneTreeProvider(_treeProvider, "build-selection"),
    showCollapseAll: false,
  });
  _buildArtifactsTreeView = vscode.window.createTreeView("tbench.buildArtifacts", {
    treeDataProvider: new PaneTreeProvider(_treeProvider, "build-artifacts"),
    showCollapseAll: false,
  });
  _buildOptionsTreeView = vscode.window.createTreeView("tbench.buildOptions", {
    treeDataProvider: new PaneTreeProvider(_treeProvider, "build-options"),
    showCollapseAll: false,
  });
  context.subscriptions.push(
    _configurationTreeView,
    _buildArtifactsTreeView,
    _buildOptionsTreeView,
    // Selector expand/collapse: rows only ever render in Build Selection.
    _configurationTreeView.onDidExpandElement(({ element }) => {
      if (element instanceof SelectorHeaderItem) {
        _treeProvider?.setExpandedSelector(element.selectorKind);
      }
    }),
    _configurationTreeView.onDidCollapseElement(({ element }) => {
      if (element instanceof SelectorHeaderItem) {
        if (_treeProvider?.getExpandedSelector() === element.selectorKind) {
          _treeProvider.setExpandedSelector(undefined);
        }
      }
    }),
    // Multistate expand/collapse, option-group collapse, and checkbox toggling:
    // rows only ever render in Build Options.
    _buildOptionsTreeView.onDidExpandElement(({ element }) => {
      if (element instanceof BuildOptionMultistateHeaderItem) {
        _treeProvider?.setExpandedMultistateKey(element.optionKey);
      } else if (element instanceof BuildOptionGroupItem) {
        _treeProvider?.setGroupCollapsed(element.groupLabel, false);
      }
    }),
    _buildOptionsTreeView.onDidCollapseElement(({ element }) => {
      if (element instanceof BuildOptionMultistateHeaderItem) {
        if (_treeProvider?.getExpandedMultistateKey() === element.optionKey) {
          _treeProvider.setExpandedMultistateKey(undefined);
        }
      } else if (element instanceof BuildOptionGroupItem) {
        _treeProvider?.setGroupCollapsed(element.groupLabel, true);
      }
    }),
    _buildOptionsTreeView.onDidChangeCheckboxState(async ({ items }) => {
      for (const [element, state] of items) {
        if (!(element instanceof BuildOptionCheckboxItem)) {
          continue;
        }
        const newValue = state === vscode.TreeItemCheckboxState.Checked;
        await writeBuildOption(context, element.optionKey, newValue);
      }
      const manifestState = _manifestState;
      if (manifestState) {
        _resolvedOptions = computeResolvedOptions(manifestState, _activeConfig, context, _presetEffectiveValues);
        _treeProvider?.update(manifestState, _activeConfig, _resolvedOptions);
      }
    })
  );

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
  const repositoryConfigurationState = await loadRepositoryConfiguration(workspaceFolder);
  if (repositoryConfigurationState.status !== "invalid") {
    setRepositoryConfiguration(workspaceFolder, repositoryConfigurationState.configuration);
  }
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
        notifyWarning(
          readiness.lastWarningMessage ??
            "Another C/C++ configuration provider is active. Switch to Trezor Bench?",
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

  // Connect manifest state changes to the tree provider, diagnostics, and logs.
  // On each state change, restore and normalize the active config and the
  // active preset together (FR-009).
  const onManifestStateChange = async (state: ManifestState): Promise<void> => {
    _manifestState = state;
    if (state.status === "loaded") {
      await refreshPresetsAndActiveConfig(context);
    } else {
      _activeConfig = undefined;
      _presetContext = undefined;
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

  // Connect preset state changes to diagnostics, logs, and preset-list
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

  // --- Flash command. ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.flash", async () => {
      const state = _manifestState;
      const config = _activeConfig;
      const loaded = state?.status === "loaded" ? (state as ManifestStateLoaded) : undefined;
      const actionCtx = loaded && config ? resolveArtifactActionContext(loaded, config) : undefined;
      const component = loaded?.components.find((c) => c.id === config?.componentId);
      const evalCtx: EvalContext | undefined = config
        ? { modelId: config.modelId, targetId: config.targetId, componentId: config.componentId }
        : undefined;

      const blockReason = evaluateArtifactActionPreconditions({
        workspaceSupported: isWorkflowWorkspaceSupported(),
        manifestStatus: state?.status ?? "missing",
        hasWorkflowBlockingIssues: loaded?.hasWorkflowBlockingIssues ?? false,
        activeConfigResolved: !!actionCtx,
        actionApplicable: !!(component && evalCtx && isFlashApplicable(component, evalCtx)),
        binaryExists: _binaryArtifact?.exists ?? false,
      });

      if (blockReason !== "no-block") {
        reportArtifactActionBlocked("flash", blockReason);
        return;
      }

      if (!actionCtx) {
        reportArtifactActionBlocked("flash", "context-unresolved");
        return;
      }

      const task = createFlashTask(actionCtx, workspaceFolder);
      await executeArtifactTask(task, "flash");
    })
  );

  // --- Upload command. ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.upload", async () => {
      const state = _manifestState;
      const config = _activeConfig;
      const loaded = state?.status === "loaded" ? (state as ManifestStateLoaded) : undefined;
      const actionCtx = loaded && config ? resolveArtifactActionContext(loaded, config) : undefined;
      const component = loaded?.components.find((c) => c.id === config?.componentId);
      const evalCtx: EvalContext | undefined = config
        ? { modelId: config.modelId, targetId: config.targetId, componentId: config.componentId }
        : undefined;

      const blockReason = evaluateArtifactActionPreconditions({
        workspaceSupported: isWorkflowWorkspaceSupported(),
        manifestStatus: state?.status ?? "missing",
        hasWorkflowBlockingIssues: loaded?.hasWorkflowBlockingIssues ?? false,
        activeConfigResolved: !!actionCtx,
        actionApplicable: !!(component && evalCtx && isUploadApplicable(component, evalCtx)),
        binaryExists: _binaryArtifact?.exists ?? false,
      });

      if (blockReason !== "no-block") {
        reportArtifactActionBlocked("upload", blockReason);
        return;
      }

      if (!actionCtx) {
        reportArtifactActionBlocked("upload", "context-unresolved");
        return;
      }

      const task = createUploadTask(actionCtx, workspaceFolder);
      await executeArtifactTask(task, "upload");
    })
  );

  // --- startDebugging command (Debug Launch slice) ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.startDebugging", async () => {
      const state = _manifestState;
      const config = _activeConfig;
      const loaded = state?.status === "loaded" ? (state as ManifestStateLoaded) : undefined;
      if (!loaded || !config) {
        logDebugLaunchFailure("unsupported-workspace", {
          detail: "manifest not loaded or no active configuration",
        });
        revealLogs();
        notifyError("Cannot start debugging: manifest not loaded.");
        return;
      }
      await executeDebugLaunch(workspaceFolder, loaded, config);
    })
  );

  // --- Run and Debug provider (Run and Debug Integration slice) ---
  const debugConfigProvider = new TbenchDebugConfigurationProvider(
    () => _manifestState?.status === "loaded" ? (_manifestState as ManifestStateLoaded) : undefined,
    () => _activeConfig,
    () => resolveArtifactsPath(workspaceFolder),
    () => resolveDebugTemplatesPath(workspaceFolder),
    workspaceFolder
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
    vscode.commands.registerCommand("tbench.selectModel", async (modelId: string) => {
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
    vscode.commands.registerCommand("tbench.selectTarget", async (targetId: string) => {
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
    vscode.commands.registerCommand("tbench.selectComponent", async (componentId: string) => {
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
  // invoked only through the Preset selector's tree-item command binding. ---
  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.selectPreset", async (presetId: string) => {
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
  // Build/Clippy/Check reload preset inputs and recompute before deriving
  // arguments (FR-020, research Decision 13); Clean is exempt from preset
  // blocking entirely (FR-025, research Decision 11).
  const registerWorkflowCommand = (kind: WorkflowKind): vscode.Disposable =>
    vscode.commands.registerCommand(`tbench.${kind.toLowerCase()}`, async () => {
      if (kind !== "Clean") {
        await _presetService?.reload();
        await refreshPresetsAndActiveConfig(context);
      }

      const state = _manifestState;
      const loaded = state?.status === "loaded" ? (state as ManifestStateLoaded) : undefined;
      const activeConfig = _activeConfig;
      const wfCtx = loaded && activeConfig ? resolveWorkflowContext(loaded, activeConfig) : undefined;
      const blockReason = evaluateWorkflowPreconditions({
        manifestStatus: state?.status ?? "missing",
        hasWorkflowBlockingIssues: loaded?.hasWorkflowBlockingIssues ?? false,
        workspaceSupported: isWorkflowWorkspaceSupported(),
        activeConfigResolved: !!wfCtx,
        presetsUnavailable: kind !== "Clean" && _presetsUnavailable,
        presetsInvalid: kind !== "Clean" && _presetBlocked,
      });

      if (blockReason !== "no-block") {
        reportWorkflowBlocked(kind, blockReason);
        return;
      }

      if (!wfCtx) {
        reportWorkflowBlocked(kind, "context-unresolved");
        return;
      }

      const task = createWorkflowTask(kind, wfCtx, workspaceFolder, _resolvedOptions, activePresetId(activeConfig!));
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
      const resolved = _resolvedOptions.find((r) => r.option.key === key);
      if (!resolved || !resolved.available || resolved.option.kind !== "checkbox") {
        return;
      }
      const newValue = resolved.value !== true;
      await writeBuildOption(context, key, newValue);
      const state = _manifestState;
      if (state) {
        _resolvedOptions = computeResolvedOptions(state, _activeConfig, context, _presetEffectiveValues);
        _treeProvider?.update(state, _activeConfig, _resolvedOptions);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tbench.selectBuildOptionState",
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
          _resolvedOptions = computeResolvedOptions(state, _activeConfig, context, _presetEffectiveValues);
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
    getActivePresetId: () => activePresetId(_activeConfig),
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

  const repositoryConfigurationService = new RepositoryConfigurationService(workspaceFolder);
  context.subscriptions.push(repositoryConfigurationService);
  let repositoryConfigurationWasInvalid = false;
  const applyRepositoryConfigurationState = async (): Promise<void> => {
    const state = repositoryConfigurationService.state;
    if (!state) {
      return;
    }
    handleRepositoryConfigurationDiagnostics(state);
    logRepositoryConfigurationState(state);
    if (state.status === "invalid") {
      setRepositoryConfiguration(workspaceFolder, undefined);
      _manifestStateSubscription?.dispose();
      _presetStateSubscription?.dispose();
      _manifestService?.dispose();
      _presetService?.dispose();
      _manifestService = undefined;
      _presetService = undefined;
      _manifestState = undefined;
      _presetState = undefined;
      _activeConfig = undefined;
      _resolvedOptions = [];
      _intelliSenseService?.setManifest(undefined);
      _intelliSenseService?.setActiveConfig(undefined);
      _intelliSenseService?.setArtifactsRoot("");
      void vscode.commands.executeCommand("setContext", "tbench.workflowBlocked", true);
      if (!repositoryConfigurationWasInvalid) {
        repositoryConfigurationWasInvalid = true;
        notifyError("tbench.toml is invalid. Check the Problems view.");
      }
      return;
    }

    repositoryConfigurationWasInvalid = false;
    setRepositoryConfiguration(workspaceFolder, state.configuration);
    _intelliSenseService?.setArtifactsRoot(state.configuration.artifactsPath);
    _manifestStateSubscription?.dispose();
    _presetStateSubscription?.dispose();
    _manifestService?.dispose();
    _presetService?.dispose();
    _manifestService = new ManifestService(state.configuration.manifestUri);
    _presetService = new PresetService(state.configuration.presetUris.shared, state.configuration.presetUris.user);
    _manifestStateSubscription = _manifestService.onDidChangeState(onManifestStateChange);
    _presetStateSubscription = _presetService.onDidChangeState(onPresetStateChange);
    await _manifestService.start();
    await _presetService.start();
  };
  context.subscriptions.push(
    repositoryConfigurationService.onDidChangeState(() => {
      void applyRepositoryConfigurationState();
    })
  );

  // --- Start root configuration and its dependent services. ---
  await repositoryConfigurationService.start();

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
  _buildArtifactsTreeView?.dispose();
  _buildArtifactsTreeView = undefined;
  _buildOptionsTreeView?.dispose();
  _buildOptionsTreeView = undefined;
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
  _presetContext = undefined;
  _resolvedOptions = [];
  _binaryArtifact = undefined;
  _mapArtifact = undefined;
  disposeDiagnostics();
  disposeLogChannel();
}
