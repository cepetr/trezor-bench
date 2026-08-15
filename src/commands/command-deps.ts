/**
 * The dependency surface the per-slice command registrations receive from
 * the composition root (extension.ts): read access to the current state via
 * getters, plus the refresh callbacks a command runs after mutating it.
 */
import * as vscode from "vscode";
import { ManifestState } from "../manifest/manifest-types";
import { BuildSelection } from "../build/build-selection";
import { ResolvedOption } from "../build/build-options";
import { ResolvedArtifact } from "../build/artifact-resolution";
import { RefreshTrigger } from "../intellisense/intellisense-types";

export interface CommandDeps {
  readonly workspaceFolder: vscode.WorkspaceFolder;
  getManifestState(): ManifestState | undefined;
  getBuildSelection(): BuildSelection | undefined;
  getResolvedOptions(): ReadonlyArray<ResolvedOption>;
  getPresetBlocked(): boolean;
  getPresetsUnavailable(): boolean;
  /** The last published state of one action-relevant artifact, or null. */
  getFileArtifact(kind: "binary" | "map"): ResolvedArtifact | null;
  /** Re-reads the preset files from disk (before Build/Clippy/Check launch). */
  reloadPresets(): Promise<void>;
  /** Recomputes presets, selection, and resolved options, and refreshes the panes. */
  refreshPresetOptions(): Promise<void>;
  /** Recomputes resolved options and refreshes the tree after an option write. */
  refreshResolvedOptionsView(): void;
  refreshStatusBar(): void;
  refreshArtifactFileWatcher(): void;
  refreshBuildArtifacts(trigger: RefreshTrigger): void;
  /** Pushes the current build selection into the IntelliSense service. */
  setIntelliSenseBuildContext(): void;
}
