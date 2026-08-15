/**
 * Artifact action helpers: Flash, Upload, and Map File open.
 *
 * Implements action applicability evaluation, dynamic task-label formatting,
 * VS Code Task construction for Flash and Upload, blocked-start reporting,
 * failure logging, and map-file open requests.
 *
 * Flash and Upload run as on-demand VS Code Tasks (not via task provider
 * entries) so they do not appear in the standard build-task picker.
 * Successful completion must NOT trigger any automatic extension refresh.
 */

import * as vscode from "vscode";
import {
  ManifestComponent,
  ManifestState,
  ManifestStateLoaded,
} from "../manifest/manifest-types";
import { ActiveConfig } from "../configuration/active-config";
import { evaluateWhenExpression, EvalContext } from "../manifest/when-expressions";
import { createCargoTaskExecution } from "../tasks/xtask-execution";
import {
  log,
  logArtifactActionBlocked,
  logWorkflowFailure,
} from "../observability/log-channel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ArtifactActionKind = "flash" | "upload";

/** Reason why a Flash or Upload action cannot start. */
export type ArtifactActionBlockReason =
  | "no-block"
  | "workspace-unsupported"
  | "manifest-missing"
  | "manifest-invalid"
  | "context-unresolved"
  | "action-inapplicable"
  | "binary-missing";

/** Minimal active-context information needed for task-label and arg derivation. */
export interface ArtifactActionContext {
  readonly modelId: string;
  readonly modelName: string;
  readonly targetId: string;
  readonly targetDisplay: string;
  readonly componentId: string;
  readonly componentName: string;
}

// ---------------------------------------------------------------------------
// Action applicability
// ---------------------------------------------------------------------------

/**
 * Evaluates whether Flash is applicable for the given component and active
 * build context. Returns `false` when the component has no `flashWhen` rule.
 */
export function isFlashApplicable(
  component: ManifestComponent,
  evalCtx: EvalContext
): boolean {
  if (!component.flashWhen) {
    return false;
  }
  return evaluateWhenExpression(component.flashWhen, evalCtx);
}

/**
 * Evaluates whether Upload is applicable for the given component and active
 * build context. Returns `false` when the component has no `uploadWhen` rule.
 */
export function isUploadApplicable(
  component: ManifestComponent,
  evalCtx: EvalContext
): boolean {
  if (!component.uploadWhen) {
    return false;
  }
  return evaluateWhenExpression(component.uploadWhen, evalCtx);
}

/**
 * Returns whether the Binary and Map File rows should be visible for the
 * active build context.
 */
export function shouldShowArtifactRows(
  flashApplicable: boolean,
  uploadApplicable: boolean
): boolean {
  return flashApplicable || uploadApplicable;
}

/**
 * Resolves the `ArtifactActionContext` from a loaded manifest state and active
 * configuration. Returns `undefined` when any required id cannot be resolved.
 */
export function resolveArtifactActionContext(
  state: ManifestStateLoaded,
  config: ActiveConfig
): ArtifactActionContext | undefined {
  const model = state.models.find((m) => m.id === config.modelId);
  const target = state.targets.find((t) => t.id === config.targetId);
  const component = state.components.find((c) => c.id === config.componentId);

  if (!model || !target || !component) {
    return undefined;
  }

  return {
    modelId: config.modelId,
    modelName: model.name,
    targetId: config.targetId,
    targetDisplay: target.shortName ?? target.name,
    componentId: config.componentId,
    componentName: component.name,
  };
}

// ---------------------------------------------------------------------------
// Task label formatting
// ---------------------------------------------------------------------------

/**
 * Formats the user-facing task label for Flash or Upload.
 *
 * Format: `{Action} {model-name} | {target-display} | {component-name}`
 * Example: `Flash to Device Trezor Model T (v1) | HW | Core`
 */
export function formatArtifactTaskLabel(
  kind: ArtifactActionKind,
  ctx: ArtifactActionContext
): string {
  const actionWord = kind === "flash" ? "Flash to Device" : "Upload to Device";
  return `${actionWord} ${ctx.modelName} | ${ctx.targetDisplay} | ${ctx.componentName}`;
}

// ---------------------------------------------------------------------------
// Precondition evaluation
// ---------------------------------------------------------------------------

/** Inputs to the artifact action precondition check. */
export interface ArtifactActionPreconditionInputs {
  readonly manifestStatus: ManifestState["status"];
  /** True when manifest availability-rule validation blocks workflow actions. */
  readonly hasWorkflowBlockingIssues?: boolean;
  readonly workspaceSupported: boolean;
  /** True when the active configuration resolves to manifest entries. */
  readonly activeConfigResolved?: boolean;
  readonly actionApplicable: boolean;
  readonly binaryExists: boolean;
}

/**
 * Evaluates whether a Flash or Upload action can start.
 * Returns the first blocking reason found, or "no-block" if all clear.
 */
export function evaluateArtifactActionPreconditions(
  inputs: ArtifactActionPreconditionInputs
): ArtifactActionBlockReason {
  if (!inputs.workspaceSupported) {
    return "workspace-unsupported";
  }
  if (inputs.manifestStatus === "missing") {
    return "manifest-missing";
  }
  if (inputs.manifestStatus === "invalid" || inputs.hasWorkflowBlockingIssues) {
    return "manifest-invalid";
  }
  if (inputs.activeConfigResolved === false) {
    return "context-unresolved";
  }
  if (!inputs.actionApplicable) {
    return "action-inapplicable";
  }
  if (!inputs.binaryExists) {
    return "binary-missing";
  }
  return "no-block";
}

// ---------------------------------------------------------------------------
// Blocked-start reporting
// ---------------------------------------------------------------------------

const BLOCK_REASON_MESSAGES: Record<
  Exclude<ArtifactActionBlockReason, "no-block">,
  string
> = {
  "workspace-unsupported":
    "Trezor Bench requires an open workspace folder.",
  "manifest-missing":
    "Cannot start: the manifest file is missing. Check [paths].manifest in tbench.toml.",
  "manifest-invalid":
    "Cannot start: the manifest file has validation errors. Check the Problems view.",
  "context-unresolved":
    "Cannot start: the active build context is incomplete or no longer matches the manifest. Select a model, target, and component, then try again.",
  "action-inapplicable":
    "Cannot start: this action is not available for the active build context.",
  "binary-missing":
    "Cannot start: the binary artifact is missing for the active build context. Build the firmware first.",
};

/**
 * Shows an error notification describing why the given action was blocked.
 */
export function reportArtifactActionBlocked(
  kind: ArtifactActionKind,
  reason: Exclude<ArtifactActionBlockReason, "no-block">
): void {
  const actionName = kind === "flash" ? "Flash" : "Upload";
  const detail = BLOCK_REASON_MESSAGES[reason];
  logArtifactActionBlocked(actionName, detail);
  vscode.window.showErrorMessage(`Trezor: ${actionName} blocked — ${detail}`);
}

// ---------------------------------------------------------------------------
// Task construction
// ---------------------------------------------------------------------------

const TASK_TYPE = "tbench";
const TASK_SOURCE = "Trezor Bench";

/**
 * Creates an on-demand VS Code Task for the Flash action.
 *
 * Command line: `cargo xtask flash <component-id> -m <model-id>`
 */
export function createFlashTask(
  ctx: ArtifactActionContext,
  workspaceFolder: vscode.WorkspaceFolder
): vscode.Task {
  const label = formatArtifactTaskLabel("flash", ctx);
  const args = [ctx.componentId, "-m", ctx.modelId];

  const definition: vscode.TaskDefinition = { type: TASK_TYPE };
  const execution = createCargoTaskExecution("flash", args, workspaceFolder);
  const task = new vscode.Task(
    definition,
    workspaceFolder,
    label,
    TASK_SOURCE,
    execution
  );
  task.group = undefined; // not a standard build-task entry point
  return task;
}

/**
 * Creates an on-demand VS Code Task for the Upload action.
 *
 * Command line: `cargo xtask upload <component-id> -m <model-id>`
 */
export function createUploadTask(
  ctx: ArtifactActionContext,
  workspaceFolder: vscode.WorkspaceFolder
): vscode.Task {
  const label = formatArtifactTaskLabel("upload", ctx);
  const args = [ctx.componentId, "-m", ctx.modelId];

  const definition: vscode.TaskDefinition = { type: TASK_TYPE };
  const execution = createCargoTaskExecution("upload", args, workspaceFolder);
  const task = new vscode.Task(
    definition,
    workspaceFolder,
    label,
    TASK_SOURCE,
    execution
  );
  task.group = undefined; // not a standard build-task entry point
  return task;
}

// ---------------------------------------------------------------------------
// Task execution
// ---------------------------------------------------------------------------

/**
 * Executes a Flash or Upload task.
 *
 * Post-execution failure is surfaced through VS Code's task-end event and
 * the logChannel, but successful completion deliberately does NOT trigger
 * any automatic extension refresh.
 */
export async function executeArtifactTask(
  task: vscode.Task,
  kind: ArtifactActionKind
): Promise<void> {
  try {
    await vscode.tasks.executeTask(task);
  } catch (err: unknown) {
    const actionName = kind === "flash" ? "Flash" : "Upload";
    const message = err instanceof Error ? err.message : String(err);
    logWorkflowFailure(actionName, message);
    vscode.window.showErrorMessage(
      `Trezor: ${actionName} failed to start — ${message}`
    );
  }
}

// ---------------------------------------------------------------------------
// Map file open
// ---------------------------------------------------------------------------

/**
 * Opens the resolved map file in the current editor.
 * Does nothing and returns silently when the path is empty or the file is
 * absent — callers are responsible for checking `binaryArtifact.exists`
 * before invoking this function.
 */
export async function openMapFile(mapFilePath: string): Promise<void> {
  if (!mapFilePath) {
    return;
  }
  try {
    const uri = vscode.Uri.file(mapFilePath);
    await vscode.window.showTextDocument(uri);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log(`[ERROR] Cannot open map file — ${message}`);
    vscode.window.showErrorMessage(
      `Trezor: Cannot open map file — ${message}`
    );
  }
}
