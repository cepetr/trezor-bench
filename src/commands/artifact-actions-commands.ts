/**
 * Registration for the Flash, Upload, and openMapFile commands —
 * handlers wiring the artifact-action logic in artifact-actions.ts to the
 * VS Code command surface via CommandDeps.
 */
import * as vscode from "vscode";
import { loadedManifest } from "../manifest/manifest-types";
import { isWorkflowWorkspaceSupported } from "../workspace/workspace-guard";
import {
  ArtifactActionKind,
  evaluateArtifactActionPreconditions,
  isArtifactActionApplicable,
  resolveArtifactActionContext,
  createArtifactTask,
  executeArtifactTask,
  reportArtifactActionBlocked,
  openMapFile,
} from "./artifact-actions";
import { CommandDeps } from "./command-deps";

/**
 * Registers the Flash and Upload commands (identical except for the action
 * kind) and the openMapFile command scoped to the Map File artifact row.
 */
export function registerArtifactActionCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const runArtifactAction = async (kind: ArtifactActionKind): Promise<void> => {
    const state = deps.getManifestState();
    const buildContext = deps.getBuildSelection();
    const manifest = loadedManifest(state);
    const actionCtx = manifest && buildContext ? resolveArtifactActionContext(manifest, buildContext) : undefined;
    const component = manifest?.components.find((c) => c.id === buildContext?.componentId);

    const blockReason = evaluateArtifactActionPreconditions({
      workspaceSupported: isWorkflowWorkspaceSupported(),
      manifestStatus: state?.status ?? "missing",
      hasWorkflowBlockingIssues: manifest?.hasWorkflowBlockingIssues ?? false,
      buildSelectionResolved: !!actionCtx,
      actionApplicable: !!(component && buildContext && isArtifactActionApplicable(kind, component, buildContext)),
      binaryExists: deps.getFileArtifact("binary")?.exists ?? false,
    });

    if (blockReason !== "no-block") {
      reportArtifactActionBlocked(kind, blockReason);
      return;
    }

    if (!actionCtx) {
      reportArtifactActionBlocked(kind, "context-unresolved");
      return;
    }

    const task = createArtifactTask(kind, actionCtx, deps.workspaceFolder);
    await executeArtifactTask(task, kind);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.flash", () => runArtifactAction("flash")),
    vscode.commands.registerCommand("tbench.upload", () => runArtifactAction("upload")),
    vscode.commands.registerCommand("tbench.openMapFile", async () => {
      const mapArtifact = deps.getFileArtifact("map");
      if (!mapArtifact?.exists) {
        // Action is disabled in the UI when the map file is missing;
        // silently return if somehow invoked without a valid path.
        return;
      }
      await openMapFile(mapArtifact.path);
    })
  );
}
