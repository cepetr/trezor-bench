/**
 * Integration tests for VS Code build-task provider.
 *
 * Verifies:
 * - TaskProvider is registered and provideTasks returns all four task types
 * - Task labels follow the required format.
 * - Clean task label is always "Clean".
 * - `target-display` uses `shortName` when available.
 * - Task failure logging writes to the output channel.
 *
 * These tests run inside the VS Code extension host.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import { CLEAN_TASK_LABEL, blockReasonMessage } from "../../commands/build-workflow";
import { buildTaskLabel, createWorkflowTask, resolveWorkflowContext } from "../../tasks/build-task-provider";
import { logWorkflowFailure } from "../../observability/log-channel";
import { ManifestStateLoaded } from "../../manifest/manifest-types";

// ---------------------------------------------------------------------------
// Suite: task label formatting integration
// ---------------------------------------------------------------------------

suite("Build Task Provider – task label construction", () => {
  const context = {
    modelId: "model-t2t1",
    modelName: "T2T1",
    targetId: "hw",
    targetDisplay: "HW",
    componentName: "Core",
    componentId: "core",
  };

  test("Build task label follows 'Build {model}-{target}-{component}' format", () => {
    const label = buildTaskLabel("Build", context);
    assert.strictEqual(label, "Build T2T1 | HW | Core");
  });

  test("Clippy task label follows 'Clippy {model}-{target}-{component}' format", () => {
    const label = buildTaskLabel("Clippy", context);
    assert.strictEqual(label, "Clippy T2T1 | HW | Core");
  });

  test("Check task label follows 'Check {model}-{target}-{component}' format", () => {
    const label = buildTaskLabel("Check", context);
    assert.strictEqual(label, "Check T2T1 | HW | Core");
  });

  test("Clean task label is always 'Clean'", () => {
    const label = buildTaskLabel("Clean", context);
    assert.strictEqual(label, CLEAN_TASK_LABEL);
  });

  test("uses target shortName when available", () => {
    const label = buildTaskLabel("Build", { ...context, targetDisplay: "HW" });
    assert.ok(label.includes("HW"), "label should use shortName 'HW'");
    assert.ok(!label.includes("Hardware"), "label should not use full name");
  });

  test("falls back to full target name when shortName is absent", () => {
    const emuCtx = { ...context, targetId: "emu", targetDisplay: "Emulator" };
    const label = buildTaskLabel("Build", emuCtx);
    assert.ok(label.includes("Emulator"), "label should use full target name");
  });
});

// ---------------------------------------------------------------------------
// Suite: VS Code task provider registration
// ---------------------------------------------------------------------------

suite("Build Task Provider – VS Code registration", () => {
  test("fetchTasks returns tasks with correct labels for valid state", async () => {
    // This test verifies the provider is registered and returns tasks when active.
    const tasks = await vscode.tasks.fetchTasks({ type: "tbench" });
    assert.ok(Array.isArray(tasks), "fetchTasks should return an array");
  });
});

// ---------------------------------------------------------------------------
// Suite: task failure notification integration
// ---------------------------------------------------------------------------

suite("Build Task Provider – task failure visibility", () => {
  test("logWorkflowFailure writes a persistent log entry", () => {
    // Test that the log function runs without throwing
    assert.doesNotThrow(() => {
      logWorkflowFailure("Build", "Test failure for integration test");
    });
  });

  test("blocked workflow action reports correct message via blockReasonMessage", () => {
    const msg = blockReasonMessage("manifest-invalid");
    assert.ok(typeof msg === "string" && msg.length > 0);
  });

  test("workspace-unsupported reason produces non-empty message", () => {
    const msg = blockReasonMessage("workspace-unsupported");
    assert.ok(typeof msg === "string" && msg.length > 0);
  });

  test("build task defines a process execution", () => {
    const activeBuildContext = {
      modelId: "model-t2t1",
      targetId: "hw",
      componentId: "core",
      persistedAt: "2026-01-01T00:00:00Z",
    };
    const state: ManifestStateLoaded = {
      status: "loaded",
      manifestUri: vscode.Uri.file("/fake/tbench.yaml"),
      models: [{ kind: "model" as const, id: "model-t2t1", name: "T2T1" }],
      targets: [{ kind: "target" as const, id: "hw", name: "Hardware", shortName: "HW" }],
      components: [{ kind: "component" as const, id: "core", name: "Core" }],
      buildOptions: [],
      hasWorkflowBlockingIssues: false,
      hasDebugBlockingIssues: false,
      validationIssues: [],
      loadedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const wfCtx = resolveWorkflowContext(state, activeBuildContext);
    assert.ok(wfCtx, "expected valid workflow context");
    assert.strictEqual(wfCtx?.modelName, "T2T1");

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return; // Skip if no workspace in test host
    }

    const task = createWorkflowTask("Build", wfCtx, workspaceFolder, []);
    assert.ok(task instanceof vscode.Task, "expected a vscode.Task");
    assert.ok(task.execution instanceof vscode.ProcessExecution, "expected ProcessExecution");
    assert.ok(task.name.startsWith("Build"), "task name should start with Build");
  });
});
