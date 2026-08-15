/**
 * Command registrations for the unsupported-workspace activation path:
 * every contributed command resolves without side effects or reports the
 * workspace-unsupported block, so invocations never error.
 */
import * as vscode from "vscode";
import { WorkflowKind, reportWorkflowBlocked } from "./build-workflow";
import { reportArtifactActionBlocked } from "./artifact-actions";
import { logDebugLaunchFailure, notifyError, revealLogs } from "../observability/log-channel";

export function registerUnsupportedWorkspaceCommands(
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
