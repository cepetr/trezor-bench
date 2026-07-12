import * as assert from "assert";
import * as vscode from "vscode";
import {
  resolveConfigurationVariables,
  resolveConfigurationVariablesDeep,
} from "../../../workspace/configuration-variables";
import {
  readTaskExtraEnv,
  resolveArtifactsPath,
  resolveCargoWorkspacePath,
} from "../../../workspace/settings";

const MOCK_WORKSPACE_FOLDER = {
  uri: vscode.Uri.file("/workspace"),
  name: "workspace",
  index: 0,
} as vscode.WorkspaceFolder;

suite("resolveConfigurationVariables", () => {
  test("expands workspaceFolder", () => {
    const value = resolveConfigurationVariables("${workspaceFolder}/core/embed", MOCK_WORKSPACE_FOLDER);
    assert.strictEqual(value, "/workspace/core/embed");
  });

  test("expands deprecated workspaceRoot alias", () => {
    const value = resolveConfigurationVariables("${workspaceRoot}/artifacts", MOCK_WORKSPACE_FOLDER);
    assert.strictEqual(value, "/workspace/artifacts");
  });

  test("expands workspaceFolderBasename", () => {
    const value = resolveConfigurationVariables("${workspaceFolderBasename}-build", MOCK_WORKSPACE_FOLDER);
    assert.strictEqual(value, "workspace-build");
  });

  test("expands env variables", () => {
    const original = process.env.TEST_TF_TOOLS_VAR;
    process.env.TEST_TF_TOOLS_VAR = "from-env";
    try {
      const value = resolveConfigurationVariables("prefix-${env:TEST_TF_TOOLS_VAR}", MOCK_WORKSPACE_FOLDER);
      assert.strictEqual(value, "prefix-from-env");
    } finally {
      if (original === undefined) {
        delete process.env.TEST_TF_TOOLS_VAR;
      } else {
        process.env.TEST_TF_TOOLS_VAR = original;
      }
    }
  });

  test("leaves unknown variables unchanged", () => {
    const value = resolveConfigurationVariables("${command:pickFolder}/build", MOCK_WORKSPACE_FOLDER);
    assert.strictEqual(value, "${command:pickFolder}/build");
  });

  test("does not re-expand substituted values", () => {
    const value = resolveConfigurationVariables("${workspaceFolder}", MOCK_WORKSPACE_FOLDER);
    assert.strictEqual(value, "/workspace");
    assert.doesNotThrow(() => resolveConfigurationVariables(value, MOCK_WORKSPACE_FOLDER));
  });
});

suite("resolveConfigurationVariablesDeep", () => {
  test("expands strings inside objects and arrays", () => {
    const value = resolveConfigurationVariablesDeep(
      {
        PATH: "${workspaceFolder}/.venv/bin:${env:PATH}",
        nested: ["${workspaceFolder}/a"],
      },
      MOCK_WORKSPACE_FOLDER
    );
    assert.ok(value.PATH.startsWith("/workspace/.venv/bin:"));
    assert.deepStrictEqual(value.nested, ["/workspace/a"]);
  });
});

suite("settings path resolution", () => {
  const originalGetConfiguration = vscode.workspace.getConfiguration;

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test("resolveCargoWorkspacePath expands workspaceFolder in setting value", () => {
    vscode.workspace.getConfiguration = () => ({
      get: (key: string) => (key === "cargoWorkspacePath" ? "${workspaceFolder}/core/embed" : undefined),
      update: () => Promise.resolve(),
      has: () => true,
      inspect: () => undefined,
    });

    assert.strictEqual(resolveCargoWorkspacePath(MOCK_WORKSPACE_FOLDER), "/workspace/core/embed");
  });

  test("resolveArtifactsPath treats expanded absolute paths as absolute", () => {
    vscode.workspace.getConfiguration = () => ({
      get: (key: string) => (key === "artifactsPath" ? "${workspaceFolder}/core/build-xtask/artifacts" : undefined),
      update: () => Promise.resolve(),
      has: () => true,
      inspect: () => undefined,
    });

    assert.strictEqual(resolveArtifactsPath(MOCK_WORKSPACE_FOLDER), "/workspace/core/build-xtask/artifacts");
  });

  test("readTaskExtraEnv expands variable references in values", () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "/bin";
    vscode.workspace.getConfiguration = () => ({
      get: (key: string) =>
        key === "taskExtraEnv"
          ? {
              VIRTUAL_ENV: "${workspaceFolder}/.venv",
              PATH: "${workspaceFolder}/.venv/bin:${env:PATH}",
            }
          : undefined,
      update: () => Promise.resolve(),
      has: () => true,
      inspect: () => undefined,
    });

    try {
      assert.deepStrictEqual(readTaskExtraEnv(MOCK_WORKSPACE_FOLDER), {
        VIRTUAL_ENV: "/workspace/.venv",
        PATH: "/workspace/.venv/bin:/bin",
      });
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });
});
