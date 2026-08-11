/**
 * Build Workflow command logic: label formatting, effective argument derivation,
 * and precondition evaluation for Build, Clippy, Check, and Clean actions.
 *
 * Covers build workflow behavior for active-context task execution.
 */

import * as vscode from "vscode";
import { ResolvedOption } from "../configuration/build-options";
import { logWorkflowFailure } from "../observability/log-channel";
import { ManifestState } from "../manifest/manifest-types";
import { DEFAULT_PRESET_ID } from "../presets/preset-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowKind = "Build" | "Clippy" | "Check" | "Clean";

/** Reason why a workflow action cannot start. */
export type WorkflowBlockReason =
  | "no-block"
  | "workspace-unsupported"
  | "manifest-missing"
  | "manifest-invalid"
  | "presets-unavailable"
  | "presets-invalid";

/** Minimal context needed for task label formatting and arg derivation. */
export interface WorkflowContext {
  readonly modelId: string;
  readonly modelName: string;
  readonly targetId: string;
  readonly targetDisplay: string;
  readonly componentId: string;
  readonly componentName: string;
  /** Target-specific CLI flag from the manifest (appended when not null/undefined). */
  readonly targetFlag?: string | null;
}

/** Inputs to the precondition check. */
export interface PreconditionInputs {
  readonly manifestStatus: ManifestState["status"];
  readonly hasWorkflowBlockingIssues: boolean;
  readonly workspaceSupported: boolean;
  /**
   * True when the shared `presets.toml` does not exist, so the workspace's
   * `xtask` does not support presets (FR-027). Reported ahead of
   * `presetsInvalid`, which it also implies. Callers pass `false` (or omit)
   * for `Clean`, which is exempt (research Decision 11).
   */
  readonly presetsUnavailable?: boolean;
  /**
   * True when preset data is file-level invalid or an available option
   * mismatches. Callers pass `false` (or omit) for `Clean`, which is exempt
   * (research Decision 11).
   */
  readonly presetsInvalid?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed label for the Clean task. */
export const CLEAN_TASK_LABEL = "Clean";

// ---------------------------------------------------------------------------
// Label formatting
// ---------------------------------------------------------------------------

/**
 * Formats the task label for a Build/Clippy/Check/Clean action.
 *
 * - Build/Clippy/Check: `{kind} {model-name} | {target-display} | {component-name}`
 * - Clean:              `"Clean"` (fixed, no context suffix)
 */
export function formatTaskLabel(kind: WorkflowKind, ctx: WorkflowContext): string {
  if (kind === "Clean") {
    return CLEAN_TASK_LABEL;
  }
  return `${kind} ${ctx.modelName} | ${ctx.targetDisplay} | ${ctx.componentName}`;
}

// ---------------------------------------------------------------------------
// Effective argument derivation
// ---------------------------------------------------------------------------

/**
 * Derives the override-only command-line flags for Build, Clippy, or Check:
 * one entry per `available && isOverride` option, in manifest declaration
 * order. Checkbox on -> bare `<flag>`; checkbox off -> `<flag>=false`
 * (research Decision 9); multistate -> the selected state's existing
 * `<flag>=<value>` form, unchanged (FR-023). Nothing is emitted for
 * `unresolved` or `mismatch` options, since `isOverride` is forced `false`
 * for both.
 */
function deriveOverrideFlags(resolved: ReadonlyArray<ResolvedOption>): string[] {
  const flags: string[] = [];
  for (const r of resolved) {
    if (!r.available || !r.isOverride) {
      continue;
    }
    if (r.option.kind === "checkbox") {
      flags.push(r.value === true ? r.option.flag : `${r.option.flag}=false`);
    } else {
      const state = r.option.states?.find((s) => s.id === r.value);
      if (state?.flag) {
        flags.push(state.flag);
      }
    }
  }
  return flags;
}

/**
 * Derives the ordered command-line arguments for Build, Clippy, or Check.
 *
 * Argument format: `<component-id> -m <model-id> [target-flag] [-p <preset-id>] [override-flags…]`.
 * The target flag comes from the manifest target `flag` field and is
 * omitted when absent or null. `-p <preset-id>` is emitted exactly once and
 * only for a non-`default` active preset — `-p default` is never emitted
 * (FR-021). Option flags are emitted only for differing overrides (FR-022).
 */
export function deriveWorkflowArguments(
  kind: Exclude<WorkflowKind, "Clean">,
  ctx: { modelId: string; targetId: string; componentId: string; targetFlag?: string | null },
  resolved: ReadonlyArray<ResolvedOption>,
  presetId: string
): string[] {
  const base = [ctx.componentId, "-m", ctx.modelId];
  const targetArgs = ctx.targetFlag ? [ctx.targetFlag] : [];
  const presetArgs = presetId !== DEFAULT_PRESET_ID ? ["-p", presetId] : [];
  const overrideFlags = deriveOverrideFlags(resolved);
  return [...base, ...targetArgs, ...presetArgs, ...overrideFlags];
}

/**
 * Derives the command-line arguments for Clean.
 * Clean runs with no arguments: `cargo xtask clean`.
 */
export function deriveCleanArguments(_ctx: {
  modelId: string;
  targetId: string;
  componentId: string;
}): string[] {
  return [];
}

// ---------------------------------------------------------------------------
// Precondition checks
// ---------------------------------------------------------------------------

/**
 * Evaluates whether the workflow action can start.
 * Returns the first blocking reason found, or "no-block" if all clear.
 *
 * Priority order: workspace-unsupported > manifest-missing > manifest-invalid >
 * presets-unavailable > presets-invalid
 */
export function evaluateWorkflowPreconditions(
  inputs: PreconditionInputs
): WorkflowBlockReason {
  if (!inputs.workspaceSupported) {
    return "workspace-unsupported";
  }
  if (inputs.manifestStatus === "missing") {
    return "manifest-missing";
  }
  if (inputs.manifestStatus === "invalid" || inputs.hasWorkflowBlockingIssues) {
    return "manifest-invalid";
  }
  if (inputs.presetsUnavailable) {
    return "presets-unavailable";
  }
  if (inputs.presetsInvalid) {
    return "presets-invalid";
  }
  return "no-block";
}

/**
 * Produces the user-facing error message for a given block reason.
 */
export function blockReasonMessage(reason: WorkflowBlockReason): string {
  switch (reason) {
    case "workspace-unsupported":
      return "Build Workflow requires exactly one open workspace folder. Multi-root workspaces and empty windows are not supported.";
    case "manifest-missing":
      return "Build Workflow is blocked: the manifest file (tbench.yaml) was not found. Create or restore it to enable build actions.";
    case "manifest-invalid":
      return "Build Workflow is blocked: the manifest has validation errors or invalid availability rules. Check the Problems view and fix all errors to enable build actions.";
    case "presets-unavailable":
      return "Build Workflow is blocked: presets.toml is unavailable under the configured cargo workspace. This repository's xtask does not support build presets — open a revision that provides xtask/tf-tools/presets.toml to enable build actions.";
    case "presets-invalid":
      return "Build Workflow is blocked: preset data is invalid or a preset value cannot be represented by a build option. Check the Problems view and fix all errors to enable build actions.";
    case "no-block":
      return "";
  }
}

// ---------------------------------------------------------------------------
// Workflow execution helpers
// ---------------------------------------------------------------------------

/**
 * Attempts to run a VS Code task with the given label.
 * Shows a VS Code error message and logs to the output channel on failure.
 */
export async function executeWorkflowTask(
  task: vscode.Task,
  kind: WorkflowKind
): Promise<void> {
  try {
    await vscode.tasks.executeTask(task);
  } catch (err) {
    const msg = `Failed to start ${kind} task: ${err instanceof Error ? err.message : String(err)}`;
    vscode.window.showErrorMessage(msg);
    logWorkflowFailure(kind, msg);
  }
}

/**
 * Shows a visible failure message when a workflow action is blocked,
 * and logs to the output channel.
 */
export function reportWorkflowBlocked(
  kind: WorkflowKind,
  reason: WorkflowBlockReason
): void {
  const msg = blockReasonMessage(reason);
  vscode.window.showErrorMessage(`${kind}: ${msg}`);
  logWorkflowFailure(kind, msg);
}
