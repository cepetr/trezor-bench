import * as assert from "assert";
import * as vscode from "vscode";
import {
  resolveConfigurationVariables,
  resolveConfigurationVariablesDeep,
} from "../../../workspace/configuration-variables";
import {
  readTaskExtraEnv,
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

  test("expands userHome", () => {
    const value = resolveConfigurationVariables("${userHome}/.cache", MOCK_WORKSPACE_FOLDER);
    assert.ok(value.endsWith("/.cache"));
    assert.notStrictEqual(value, "${userHome}/.cache");
  });

  test("leaves unknown variables unchanged", () => {
    const value = resolveConfigurationVariables("${command:pickFolder}/build", MOCK_WORKSPACE_FOLDER);
    assert.strictEqual(value, "${command:pickFolder}/build");
  });

  test("leaves context-dependent and unsupported variables unchanged", () => {
    const value = resolveConfigurationVariables(
      "${file}:${selectedText}:${lineNumber}:${execPath}:${pathSeparator}",
      MOCK_WORKSPACE_FOLDER
    );
    assert.strictEqual(value, "${file}:${selectedText}:${lineNumber}:${execPath}:${pathSeparator}");
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

suite("task environment settings", () => {
  const originalGetConfiguration = vscode.workspace.getConfiguration;

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
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
