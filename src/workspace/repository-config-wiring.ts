/**
 * Wires the repository-config lifecycle: on every tbench.toml state change it
 * tears down the manifest and preset services that depend on the resolved
 * configuration, and on a valid state rebuilds and restarts them. Owns the
 * one-shot invalid-config error notification latch.
 */
import * as vscode from "vscode";
import { RepositoryConfigService, setRepositoryConfig } from "./repository-config";
import { ManifestService } from "../manifest/manifest-service";
import { ManifestState } from "../manifest/manifest-types";
import { PresetService } from "../presets/preset-service";
import { PresetState } from "../presets/preset-types";
import { logRepositoryConfigState, notifyError } from "../observability/log-channel";
import { handleRepositoryConfigDiagnostics } from "../observability/diagnostics";

/**
 * Mutable slot for a value the extension owns and other wiring reads; the
 * repository-config wiring disposes and replaces it through this surface.
 */
export interface ServiceSlot<T> {
  get(): T | undefined;
  set(value: T | undefined): void;
}

/** Dependency surface through which the wiring reaches extension-owned state. */
export interface RepositoryConfigWiringDeps {
  /** Manifest service slot, disposed on invalid configs and replaced on valid ones. */
  manifestService: ServiceSlot<ManifestService>;
  /** Preset service slot, disposed on invalid configs and replaced on valid ones. */
  presetService: ServiceSlot<PresetService>;
  /** Subscription slot for the manifest state-change handler. */
  manifestStateSubscription: ServiceSlot<vscode.Disposable>;
  /** Subscription slot for the preset state-change handler. */
  presetStateSubscription: ServiceSlot<vscode.Disposable>;
  /** State-change handler resubscribed onto each rebuilt manifest service. */
  onManifestStateChange: (state: ManifestState) => Promise<void>;
  /** State-change handler resubscribed onto each rebuilt preset service. */
  onPresetStateChange: (state: PresetState) => Promise<void>;
  /** Clears manifest/preset state, the build selection, and the resolved options after an invalid-config teardown. */
  clearBuildState: () => void;
  /** Resets the IntelliSense inputs after an invalid-config teardown. */
  resetIntelliSenseInputs: () => void;
  /** Points IntelliSense at the artifacts root of a newly valid config. */
  setIntelliSenseArtifactsRoot: (artifactsRoot: string) => void;
}

/**
 * Connects the repository-config service's state changes to the teardown and
 * rebuild of the dependent manifest and preset services, registering the
 * subscription on the extension context. Service creation and `start()` stay
 * with the caller.
 */
export function registerRepositoryConfigWiring(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  service: RepositoryConfigService,
  deps: RepositoryConfigWiringDeps
): void {
  /** Latch so the invalid-config error notification fires once per invalid entry. */
  let repositoryConfigWasInvalid = false;

  const applyRepositoryConfigState = async (): Promise<void> => {
    const state = service.state;
    if (!state) {
      return;
    }
    handleRepositoryConfigDiagnostics(state);
    logRepositoryConfigState(state);
    if (state.status === "invalid") {
      setRepositoryConfig(workspaceFolder, undefined);
      deps.manifestStateSubscription.get()?.dispose();
      deps.presetStateSubscription.get()?.dispose();
      deps.manifestService.get()?.dispose();
      deps.presetService.get()?.dispose();
      deps.manifestService.set(undefined);
      deps.presetService.set(undefined);
      deps.clearBuildState();
      deps.resetIntelliSenseInputs();
      void vscode.commands.executeCommand("setContext", "tbench.workflowBlocked", true);
      if (!repositoryConfigWasInvalid) {
        repositoryConfigWasInvalid = true;
        notifyError("tbench.toml is invalid. Check the Problems view.");
      }
      return;
    }

    repositoryConfigWasInvalid = false;
    setRepositoryConfig(workspaceFolder, state.config);
    deps.setIntelliSenseArtifactsRoot(state.config.artifactsPath);
    deps.manifestStateSubscription.get()?.dispose();
    deps.presetStateSubscription.get()?.dispose();
    deps.manifestService.get()?.dispose();
    deps.presetService.get()?.dispose();
    const manifestService = new ManifestService(state.config.manifestUri);
    const presetService = new PresetService(state.config.presetUris.shared, state.config.presetUris.user);
    deps.manifestService.set(manifestService);
    deps.presetService.set(presetService);
    deps.manifestStateSubscription.set(manifestService.onDidChangeState(deps.onManifestStateChange));
    deps.presetStateSubscription.set(presetService.onDidChangeState(deps.onPresetStateChange));
    await manifestService.start();
    await presetService.start();
  };

  context.subscriptions.push(
    service.onDidChangeState(() => {
      void applyRepositoryConfigState();
    })
  );
}
