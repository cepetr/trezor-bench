/**
 * Publishers for the tbench VS Code context keys that package.json
 * when-clauses reference (workflow blocked, Flash/Upload applicability,
 * artifact existence, debug enablement), plus the artifact-row updates on
 * the pane tree model they are derived together with.
 */
import * as vscode from "vscode";
import { BuildContext, ManifestState, loadedManifest } from "../manifest/manifest-types";
import {
  buildResolutionInputs,
  resolveArtifact,
  resolveExecutableArtifact,
} from "../build/artifact-resolution";
import { evaluateWorkflowPreconditions } from "../commands/build-workflow";
import { isArtifactActionApplicable } from "../commands/artifact-actions";
import { resolveWorkflowContext } from "../tasks/build-task-provider";
import { isWorkflowWorkspaceSupported } from "../workspace/workspace-guard";
import { PaneTreeModel } from "./pane-tree";

/** The kinds updateArtifactActionContext resolves and publishes context keys for. */
const ACTION_ARTIFACT_KINDS = ["binary", "map"] as const;

/**
 * Updates the `tbench.workflowBlocked` VS Code context key so that
 * view/title menu `enablement` clauses reflect the current state.
 */
export function updateWorkflowBlockedContext(
  state: ManifestState,
  buildContext: BuildContext | undefined
): void {
  const manifest = loadedManifest(state);
  const buildSelectionResolved = !!(
    manifest && buildContext && resolveWorkflowContext(manifest, buildContext)
  );
  const blocked =
    evaluateWorkflowPreconditions({
      manifestStatus: state.status,
      hasWorkflowBlockingIssues: manifest?.hasWorkflowBlockingIssues ?? false,
      workspaceSupported: isWorkflowWorkspaceSupported(),
      buildSelectionResolved,
    }) !== "no-block";
  vscode.commands.executeCommand("setContext", "tbench.workflowBlocked", blocked);
}

/**
 * Updates the four Flash/Upload/map VS Code context keys based on the current
 * manifest state, active configuration, and artifact-resolution results.
 */
export function updateArtifactActionContext(
  treeModel: PaneTreeModel | undefined,
  state: ManifestState,
  buildContext: BuildContext | undefined,
  artifactsRoot: string
): void {
  const manifest = loadedManifest(state);
  if (!manifest || !buildContext) {
    vscode.commands.executeCommand("setContext", "tbench.flashApplicable", false);
    vscode.commands.executeCommand("setContext", "tbench.uploadApplicable", false);
    for (const kind of ACTION_ARTIFACT_KINDS) {
      treeModel?.updateArtifact(kind, null);
      vscode.commands.executeCommand("setContext", `tbench.${kind}Exists`, false);
    }
    return;
  }

  const component = manifest.components.find((c) => c.id === buildContext.componentId);

  const flashApplicable = component ? isArtifactActionApplicable("flash", component, buildContext) : false;
  const uploadApplicable = component ? isArtifactActionApplicable("upload", component, buildContext) : false;
  const showArtifactRows = flashApplicable || uploadApplicable;

  const inputs = buildResolutionInputs(manifest, buildContext, artifactsRoot);

  vscode.commands.executeCommand("setContext", "tbench.flashApplicable", flashApplicable);
  vscode.commands.executeCommand("setContext", "tbench.uploadApplicable", uploadApplicable);
  for (const kind of ACTION_ARTIFACT_KINDS) {
    const artifact = inputs && showArtifactRows ? resolveArtifact(kind, inputs, buildContext) : undefined;
    treeModel?.updateArtifact(kind, artifact ?? null);
    vscode.commands.executeCommand("setContext", `tbench.${kind}Exists`, artifact?.exists ?? false);
  }
}

/**
 * Updates the `tbench.startDebuggingEnabled` VS Code context key based on the
 * current manifest state, active configuration, and executable artifact status.
 */
export function updateDebugContext(
  treeModel: PaneTreeModel | undefined,
  state: ManifestState,
  buildContext: BuildContext | undefined,
  artifactsRoot: string
): void {
  const manifest = loadedManifest(state);
  if (!manifest || !buildContext) {
    vscode.commands.executeCommand("setContext", "tbench.startDebuggingEnabled", false);
    treeModel?.updateArtifact("executable", null);
    return;
  }

  const executableArtifact = resolveExecutableArtifact(manifest, buildContext, artifactsRoot);
  const enabled = executableArtifact.status === "present";
  vscode.commands.executeCommand("setContext", "tbench.startDebuggingEnabled", enabled);
  treeModel?.updateArtifact("executable", executableArtifact);
}

/** Refreshes the Compile Commands artifact row from the current on-disk state. */
export function updateCompileCommandsTreeArtifact(
  treeModel: PaneTreeModel | undefined,
  state: ManifestState,
  buildContext: BuildContext | undefined,
  artifactsRoot: string
): void {
  const manifest = loadedManifest(state);
  if (!manifest || !buildContext) {
    treeModel?.updateArtifact("compile-commands", null);
    return;
  }

  const inputs = buildResolutionInputs(manifest, buildContext, artifactsRoot);
  const compileCommandsArtifact = inputs ? resolveArtifact("compile-commands", inputs, buildContext) : null;
  treeModel?.updateArtifact("compile-commands", compileCommandsArtifact);
}
