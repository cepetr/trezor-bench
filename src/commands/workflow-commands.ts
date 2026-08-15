/**
 * Registration for the Build / Clippy / Check / Clean workflow commands.
 *
 * Lives beside — not inside — build-workflow.ts: the handlers need
 * `resolveWorkflowContext`/`createWorkflowTask` from the task provider,
 * which itself imports from build-workflow.ts, so co-locating them there
 * would create a module cycle.
 */
import * as vscode from "vscode";
import {
  WorkflowKind,
  evaluateWorkflowPreconditions,
  reportWorkflowBlocked,
  executeWorkflowTask,
} from "./build-workflow";
import { CommandDeps } from "./command-deps";
import { resolveWorkflowContext, createWorkflowTask } from "../tasks/build-task-provider";
import { activePresetId } from "../build/build-selection";
import { loadedManifest } from "../manifest/manifest-types";
import { isWorkflowWorkspaceSupported } from "../workspace/workspace-guard";

/**
 * Registers the four workflow commands. Build/Clippy/Check reload preset
 * inputs and recompute before deriving arguments; Clean is exempt from
 * preset blocking entirely.
 */
export function registerWorkflowCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const registerWorkflowCommand = (kind: WorkflowKind): vscode.Disposable =>
    vscode.commands.registerCommand(`tbench.${kind.toLowerCase()}`, async () => {
      if (kind !== "Clean") {
        await deps.reloadPresets();
        await deps.refreshPresetOptions();
      }

      const state = deps.getManifestState();
      const manifest = loadedManifest(state);
      const buildSelection = deps.getBuildSelection();
      const wfCtx = manifest && buildSelection ? resolveWorkflowContext(manifest, buildSelection) : undefined;
      const blockReason = evaluateWorkflowPreconditions({
        manifestStatus: state?.status ?? "missing",
        hasWorkflowBlockingIssues: manifest?.hasWorkflowBlockingIssues ?? false,
        workspaceSupported: isWorkflowWorkspaceSupported(),
        buildSelectionResolved: !!wfCtx,
        presetsUnavailable: kind !== "Clean" && deps.getPresetsUnavailable(),
        presetsInvalid: kind !== "Clean" && deps.getPresetBlocked(),
      });

      if (blockReason !== "no-block") {
        reportWorkflowBlocked(kind, blockReason);
        return;
      }

      if (!wfCtx) {
        reportWorkflowBlocked(kind, "context-unresolved");
        return;
      }

      const task = createWorkflowTask(kind, wfCtx, deps.workspaceFolder, deps.getResolvedOptions(), activePresetId(buildSelection!));
      await executeWorkflowTask(task, kind);
    });

  context.subscriptions.push(
    registerWorkflowCommand("Build"),
    registerWorkflowCommand("Clippy"),
    registerWorkflowCommand("Check"),
    registerWorkflowCommand("Clean")
  );
}
