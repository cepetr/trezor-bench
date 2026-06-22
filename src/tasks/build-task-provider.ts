/**
 * VS Code build task provider for Build Workflow actions.
 *
 * Exposes Build, Clippy, Check, and Clean as VS Code tasks through the
 * standard task system, so users can run them from the terminal,
 * the Run Task picker, and keybindings in addition to the Configuration view.
 *
 * Tasks are accessible through standard VS Code entry points.
 * Task labels reflect the active build context.
 * `target-display` uses `shortName` when present.
 */

import * as vscode from "vscode";
import {
  WorkflowKind,
  WorkflowContext,
  deriveWorkflowArguments,
  deriveCleanArguments,
  formatTaskLabel,
} from "../commands/build-workflow";
import { ResolvedOption } from "../configuration/build-options";
import { ManifestStateLoaded } from "../manifest/manifest-types";
import { ActiveConfig } from "../configuration/active-config";
import { createCargoTaskExecution } from "./xtask-execution";

// ---------------------------------------------------------------------------
// Task type identifier
// ---------------------------------------------------------------------------

export const TASK_TYPE = "tfTools";
export const TASK_SOURCE = "Trezor Firmware Tools";

// ---------------------------------------------------------------------------
// Label builder (also used by integration tests)
// ---------------------------------------------------------------------------

/**
 * Builds a task label for the given workflow kind and context.
 * Delegates to `formatTaskLabel` but accepts the structured context type
 * used in this module.
 */
export function buildTaskLabel(kind: WorkflowKind, ctx: WorkflowContext): string {
  return formatTaskLabel(kind, ctx);
}

// ---------------------------------------------------------------------------
// Workflow context resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the full `WorkflowContext` from the loaded manifest state and
 * active configuration.
 *
 * Returns `undefined` when any required id cannot be resolved from the
 * manifest (defensive check; the active config values should always resolve
 * against the loaded manifest that produced them).
 */
export function resolveWorkflowContext(
  state: ManifestStateLoaded,
  activeConfig: ActiveConfig
): WorkflowContext | undefined {
  const model = state.models.find((m) => m.id === activeConfig.modelId);
  const target = state.targets.find((t) => t.id === activeConfig.targetId);
  const component = state.components.find((c) => c.id === activeConfig.componentId);

  if (!model || !target || !component) {
    return undefined;
  }

  return {
    modelId: activeConfig.modelId,
    modelName: model.name,
    targetId: activeConfig.targetId,
    targetDisplay: target.shortName ?? target.name,
    targetFlag: target.flag ?? null,
    componentId: activeConfig.componentId,
    componentName: component.name,
  };
}

// ---------------------------------------------------------------------------
// Task construction
// ---------------------------------------------------------------------------

function buildShellArgs(
  kind: Exclude<WorkflowKind, "Clean">,
  ctx: WorkflowContext,
  resolved: ReadonlyArray<ResolvedOption>
): string[] {
  return deriveWorkflowArguments(kind, ctx, resolved);
}

function cleanShellArgs(ctx: WorkflowContext): string[] {
  return deriveCleanArguments(ctx);
}

/**
 * Creates a VS Code `Task` for the given workflow kind.
 */
export function createWorkflowTask(
  kind: WorkflowKind,
  ctx: WorkflowContext,
  workspaceFolder: vscode.WorkspaceFolder,
  resolved: ReadonlyArray<ResolvedOption>
): vscode.Task {
  const args =
    kind === "Clean"
      ? cleanShellArgs(ctx)
      : buildShellArgs(kind as Exclude<WorkflowKind, "Clean">, ctx, resolved);

  const subcommand = kind.toLowerCase();
  const execution = createCargoTaskExecution(subcommand, args, workspaceFolder);

  const taskDef = { type: TASK_TYPE, kind };
  const task = new vscode.Task(
    taskDef,
    workspaceFolder,
    buildTaskLabel(kind, ctx),
    TASK_SOURCE,
    execution,
    [] // problemMatchers
  );

  if (kind === "Build") {
    task.group = vscode.TaskGroup.Build;
  }

  return task;
}

// ---------------------------------------------------------------------------
// Task provider implementation
// ---------------------------------------------------------------------------

export interface BuildTaskProviderDependencies {
  getManifestState: () => ManifestStateLoaded | undefined;
  getActiveConfig: () => ActiveConfig | undefined;
  getResolvedOptions: () => ReadonlyArray<ResolvedOption>;
  getWorkspaceFolder: () => vscode.WorkspaceFolder | undefined;
}

/**
 * VS Code `TaskProvider` that exposes the four Build Workflow tasks through
 * the standard task picker and `tasks.fetchTasks()` API.
 */
export class BuildTaskProvider implements vscode.TaskProvider {
  private readonly _deps: BuildTaskProviderDependencies;

  constructor(deps: BuildTaskProviderDependencies) {
    this._deps = deps;
  }

  provideTasks(): vscode.Task[] | undefined {
    const state = this._deps.getManifestState();
    const activeConfig = this._deps.getActiveConfig();
    const workspaceFolder = this._deps.getWorkspaceFolder();

    if (!state || !activeConfig || !workspaceFolder) {
      return [];
    }

    const wfCtx = resolveWorkflowContext(state, activeConfig);
    if (!wfCtx) {
      return [];
    }

    const resolved = this._deps.getResolvedOptions();
    const kinds: WorkflowKind[] = ["Build", "Clippy", "Check", "Clean"];

    return kinds.map((kind) =>
      createWorkflowTask(kind, wfCtx, workspaceFolder, resolved)
    );
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    // Tasks returned by provideTasks() are already fully resolved.
    return task;
  }
}
