/**
 * Unit tests for the Build Workflow task provider layer.
 *
 * Argument derivation itself is covered by `workflow/build-arguments.test.ts`;
 * these tests cover the layer above it: `createWorkflowTask` (task definition,
 * label, source, process execution, build group) and `BuildTaskProvider`
 * (dependency guards, the four provided kinds, and `resolveTask`).
 */
import * as assert from "assert";
import * as vscode from "vscode";
import {
  BuildTaskProvider,
  BuildTaskProviderDependencies,
  createWorkflowTask,
  TASK_TYPE,
  TASK_SOURCE,
} from "../../../tasks/build-task-provider";
import { WorkflowContext } from "../../../commands/build-workflow";
import { ResolvedOption } from "../../../build/build-options";
import { ManifestStateLoaded } from "../../../manifest/manifest-types";
import { BuildSelection } from "../../../build/build-selection";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_FOLDER = {
  uri: vscode.Uri.file("/workspace"),
  name: "workspace",
  index: 0,
} as vscode.WorkspaceFolder;

function makeWorkflowContext(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    modelId: "T2T1",
    modelName: "Trezor Model T",
    targetId: "hw",
    targetDisplay: "HW",
    targetFlag: null,
    componentId: "core",
    componentName: "Core",
    ...overrides,
  };
}

function checkboxOverride(key: string, flag: string): ResolvedOption {
  return {
    option: { key, label: key, flag, kind: "checkbox" },
    available: true,
    value: true,
    presetValue: false,
    presetState: "resolved",
    isOverride: true,
  };
}

function makeLoadedState(): ManifestStateLoaded {
  return {
    status: "loaded",
    manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
    models: [{ kind: "model", id: "T2T1", name: "Trezor Model T" }],
    targets: [{ kind: "target", id: "hw", name: "Hardware", shortName: "HW" }],
    components: [{ kind: "component", id: "core", name: "Core" }],
    buildOptions: [],
    hasWorkflowBlockingIssues: false,
    debugProfiles: [],
    hasDebugBlockingIssues: false,
    validationIssues: [],
    loadedAt: new Date(),
  } as ManifestStateLoaded;
}

function makeSelection(overrides: Partial<BuildSelection> = {}): BuildSelection {
  return {
    modelId: "T2T1",
    targetId: "hw",
    componentId: "core",
    persistedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeDeps(
  overrides: Partial<BuildTaskProviderDependencies> = {}
): BuildTaskProviderDependencies {
  return {
    getManifestState: () => makeLoadedState(),
    getBuildContext: () => makeSelection(),
    getResolvedOptions: () => [],
    getActivePresetId: () => "default",
    getWorkspaceFolder: () => WORKSPACE_FOLDER,
    ...overrides,
  };
}

function processArgsOf(task: vscode.Task): string[] {
  const execution = task.execution as unknown as { process: string; args: string[] };
  assert.strictEqual(execution.process, "cargo", "task must spawn cargo directly");
  return execution.args;
}

// ---------------------------------------------------------------------------
// Suite: createWorkflowTask
// ---------------------------------------------------------------------------

suite("createWorkflowTask", () => {
  test("builds a Build task with definition, label, source, and build group", () => {
    const task = createWorkflowTask("Build", makeWorkflowContext(), WORKSPACE_FOLDER, []);

    assert.deepStrictEqual(task.definition, { type: TASK_TYPE, kind: "Build" });
    assert.strictEqual(task.name, "Build Trezor Model T | HW | Core");
    assert.strictEqual(task.source, TASK_SOURCE);
    assert.strictEqual(task.group, vscode.TaskGroup.Build);
  });

  test("does not assign the build group to non-Build kinds", () => {
    for (const kind of ["Clippy", "Check", "Clean"] as const) {
      const task = createWorkflowTask(kind, makeWorkflowContext(), WORKSPACE_FOLDER, []);
      assert.strictEqual(task.group, undefined, `${kind} must not join the build group`);
    }
  });

  test("derives cargo xtask arguments for Build with the default preset", () => {
    const task = createWorkflowTask("Build", makeWorkflowContext(), WORKSPACE_FOLDER, []);
    assert.deepStrictEqual(processArgsOf(task), ["xtask", "build", "core", "-m", "T2T1"]);
  });

  test("includes the target flag, preset, and override flags for Clippy", () => {
    const task = createWorkflowTask(
      "Clippy",
      makeWorkflowContext({ targetFlag: "--hw" }),
      WORKSPACE_FOLDER,
      [checkboxOverride("bootloader", "--bootloader")],
      "debug"
    );
    assert.deepStrictEqual(processArgsOf(task), [
      "xtask",
      "clippy",
      "core",
      "-m",
      "T2T1",
      "--hw",
      "-p",
      "debug",
      "--bootloader",
    ]);
  });

  test("Clean runs bare cargo xtask clean, ignoring preset and options", () => {
    const task = createWorkflowTask(
      "Clean",
      makeWorkflowContext({ targetFlag: "--hw" }),
      WORKSPACE_FOLDER,
      [checkboxOverride("bootloader", "--bootloader")],
      "debug"
    );
    assert.strictEqual(task.name, "Clean");
    assert.deepStrictEqual(processArgsOf(task), ["xtask", "clean"]);
  });
});

// ---------------------------------------------------------------------------
// Suite: BuildTaskProvider
// ---------------------------------------------------------------------------

suite("BuildTaskProvider", () => {
  test("provides the four workflow tasks in order for a valid state", () => {
    const provider = new BuildTaskProvider(makeDeps());
    const tasks = provider.provideTasks();

    assert.ok(tasks, "expected tasks for a fully resolvable state");
    assert.deepStrictEqual(
      tasks.map((t) => t.definition.kind),
      ["Build", "Clippy", "Check", "Clean"]
    );
    assert.deepStrictEqual(
      tasks.map((t) => t.name),
      [
        "Build Trezor Model T | HW | Core",
        "Clippy Trezor Model T | HW | Core",
        "Check Trezor Model T | HW | Core",
        "Clean",
      ]
    );
  });

  test("passes the active preset and resolved options through to the tasks", () => {
    const provider = new BuildTaskProvider(
      makeDeps({
        getResolvedOptions: () => [checkboxOverride("bootloader", "--bootloader")],
        getActivePresetId: () => "debug",
      })
    );
    const tasks = provider.provideTasks();

    assert.ok(tasks);
    assert.deepStrictEqual(processArgsOf(tasks[0]), [
      "xtask",
      "build",
      "core",
      "-m",
      "T2T1",
      "-p",
      "debug",
      "--bootloader",
    ]);
  });

  test("falls back to the full target name when shortName is absent", () => {
    const state = makeLoadedState();
    const provider = new BuildTaskProvider(
      makeDeps({
        getManifestState: () => ({
          ...state,
          targets: [{ kind: "target", id: "hw", name: "Hardware" }],
        }),
      })
    );
    const tasks = provider.provideTasks();

    assert.ok(tasks);
    assert.strictEqual(tasks[0].name, "Build Trezor Model T | Hardware | Core");
  });

  test("returns an empty array when the manifest state is unavailable", () => {
    const provider = new BuildTaskProvider(makeDeps({ getManifestState: () => undefined }));
    assert.deepStrictEqual(provider.provideTasks(), []);
  });

  test("returns an empty array when no configuration is active", () => {
    const provider = new BuildTaskProvider(makeDeps({ getBuildContext: () => undefined }));
    assert.deepStrictEqual(provider.provideTasks(), []);
  });

  test("returns an empty array when no workspace folder is open", () => {
    const provider = new BuildTaskProvider(makeDeps({ getWorkspaceFolder: () => undefined }));
    assert.deepStrictEqual(provider.provideTasks(), []);
  });

  test("returns an empty array when the configuration ids do not resolve", () => {
    const provider = new BuildTaskProvider(
      makeDeps({ getBuildContext: () => makeSelection({ modelId: "MISSING" }) })
    );
    assert.deepStrictEqual(provider.provideTasks(), []);
  });

  test("resolveTask returns the task unchanged", () => {
    const provider = new BuildTaskProvider(makeDeps());
    const task = createWorkflowTask("Build", makeWorkflowContext(), WORKSPACE_FOLDER, []);
    assert.strictEqual(provider.resolveTask(task), task);
  });
});
