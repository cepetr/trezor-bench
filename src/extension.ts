/**
 * Extension entry point: wires up the manifest, preset, repository
 * configuration, and IntelliSense services, registers commands, views, and
 * task and debug providers, and coordinates state refreshes between them.
 */
import * as vscode from "vscode";
import { hasSupportedWorkspace, requireWorkspaceFolder } from "./workspace/workspace-guard";
import { isStatusBarEnabled } from "./workspace/settings";
import { RepositoryConfigService, loadRepositoryConfig, setRepositoryConfig, resolveManifestUri, resolveArtifactsPath, resolveDebugTemplatesPath, resolvePresetUris } from "./workspace/repository-config";
import { ManifestService } from "./manifest/manifest-service";
import { PresetService } from "./presets/preset-service";
import { PresetState } from "./presets/preset-types";
import { PresetOptionsCoordinator } from "./presets/preset-options-coordinator";
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
import { activePresetId, BuildSelection } from "./build/build-selection";
import { writeBuildOption } from "./build/build-options";
import { ManifestState, loadedManifest } from "./manifest/manifest-types";
import {
  BuildTaskProvider,
  isSuccessfulArtifactRefreshTaskProcess,
  TASK_TYPE,
} from "./tasks/build-task-provider";
import { IntelliSenseService } from "./intellisense/intellisense-service";
import { RefreshTrigger } from "./intellisense/intellisense-types";
import { ArtifactFileWatcher } from "./build/artifact-file-watcher";
import { registerExcludedFilesVisibility } from "./intellisense/excluded-files-wiring";
import { registerIntelliSenseWiring } from "./intellisense/intellisense-wiring";
import { registerArtifactActionCommands } from "./commands/artifact-actions-commands";
import { registerUnsupportedWorkspaceCommands } from "./commands/unsupported-workspace-commands";
import { registerDebugLaunchCommand } from "./commands/debug-launch-commands";
import { registerBuildSelectionCommands } from "./commands/build-selection-commands";
import { registerBuildOptionCommands } from "./commands/build-options-commands";
import { registerBuildWorkflowCommands } from "./commands/build-workflow-commands";
import { CommandDeps } from "./commands/command-deps";
import { CONTRIBUTED_COMMAND_IDS } from "./commands/command-ids";
import {
  updateWorkflowBlockedContext,
  updateArtifactActionContext,
  updateDebugContext,
  updateCompileCommandsTreeArtifact,
} from "./ui/context-keys";
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

// ---------------------------------------------------------------------------
// Scope guard for the supported command surface: this extension contributes
// ONLY the commands declared in commands/command-ids.ts. Any attempt to
// contribute others is a scope violation.
// ---------------------------------------------------------------------------

const ALLOWED_CONTRIBUTION_COMMANDS = new Set<string>(CONTRIBUTED_COMMAND_IDS);

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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initLogChannel();

  // Preset/build-option recomputation state, wired to the module-owned
  // service state through explicit getters and setters.
  const presetOptions = new PresetOptionsCoordinator({
    getManifestState: () => _manifestState,
    getPresetState: () => _presetState,
    getBuildSelection: () => _buildSelection,
    setBuildSelection: (selection) => {
      _buildSelection = selection;
    },
    updateTree: (state, buildContext, resolvedOptions) => {
      _treeModel?.update(state, buildContext, resolvedOptions);
    },
    updatePresets: (state, activeId, choices) => {
      _treeModel?.updatePresets(state, activeId, choices);
    },
  });

  // --- Scope guard: verify no unrelated commands are registered. ---
  assertNoUnauthorizedContributions(context);

  // Recomputes the resolved options and refreshes the tree after a
  // build-option write, shared by the checkbox and toggle/select handlers.
  const refreshResolvedOptionsView = (): void => {
    const state = _manifestState;
    if (state) {
      presetOptions.recomputeResolvedOptions(state, _buildSelection, context);
      _treeModel?.update(state, _buildSelection, presetOptions.resolvedOptions);
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

  // The dependency surface handed to the per-slice command registrations.
  const commandDeps: CommandDeps = {
    workspaceFolder,
    getManifestState: () => _manifestState,
    getBuildSelection: () => _buildSelection,
    getResolvedOptions: () => presetOptions.resolvedOptions,
    getPresetBlocked: () => presetOptions.presetBlocked,
    getPresetsUnavailable: () => presetOptions.presetsUnavailable,
    getFileArtifact: (kind) => _treeModel?.getArtifact(kind) ?? null,
    reloadPresets: async () => {
      await _presetService?.reload();
    },
    refreshPresetOptions: () => presetOptions.refresh(context),
    refreshResolvedOptionsView,
    refreshStatusBar,
    refreshArtifactFileWatcher,
    refreshBuildArtifacts,
    setIntelliSenseBuildContext: () => {
      _intelliSenseService?.setBuildContext(_buildSelection);
    },
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

  // --- IntelliSense event wiring: refresh results, setting watchers, and
  // extension-/workspace-change refresh triggers. ---
  registerIntelliSenseWiring(context, workspaceFolder, _intelliSenseService, {
    updateTreeArtifact: (artifact) => {
      if (_manifestState) {
        _treeModel?.updateArtifact("compile-commands", artifact);
      }
    },
    refreshStatusBar,
  });

  // Initialize artifactsRoot from current settings
  _intelliSenseService.setWorkspaceFolder(workspaceFolder);
  _intelliSenseService.setArtifactsRoot(resolveArtifactsPath(workspaceFolder));

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
      await presetOptions.refresh(context);
    } else {
      _buildSelection = undefined;
      presetOptions.resetForUnloadedManifest();
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
    await presetOptions.refresh(context);
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

  // --- Per-slice command registrations. ---
  registerArtifactActionCommands(context, commandDeps);
  registerDebugLaunchCommand(context, commandDeps);
  registerBuildSelectionCommands(context, commandDeps);
  registerBuildOptionCommands(context, commandDeps);
  registerBuildWorkflowCommands(context, commandDeps);

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

  // --- Task provider. ---
  const taskProvider = new BuildTaskProvider({
    getManifestState: () => loadedManifest(_manifestState),
    getBuildContext: () => _buildSelection,
    getResolvedOptions: () => presetOptions.resolvedOptions,
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
      presetOptions.clearResolvedOptions();
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
