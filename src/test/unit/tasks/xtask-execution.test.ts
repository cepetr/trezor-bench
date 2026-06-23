import * as assert from "assert";
import * as vscode from "vscode";
import { createCargoTaskExecution } from "../../../tasks/xtask-execution";

const MOCK_WORKSPACE_FOLDER = {
  uri: { fsPath: "/workspace", scheme: "file" },
  name: "workspace",
  index: 0,
} as vscode.WorkspaceFolder;

suite("createCargoTaskExecution", () => {
  const originalGetConfiguration = vscode.workspace.getConfiguration;

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test("omits env from execution options when taskExtraEnv is empty", () => {
    vscode.workspace.getConfiguration = () => ({
      get: (key: string) => (key === "taskExtraEnv" ? {} : undefined),
      update: () => Promise.resolve(),
      has: () => true,
      inspect: () => undefined,
    });

    const execution = createCargoTaskExecution("build", ["core", "-m", "T2T1"], MOCK_WORKSPACE_FOLDER);
    assert.strictEqual(execution.options?.env, undefined);
  });

  test("merges taskExtraEnv into execution options", () => {
    vscode.workspace.getConfiguration = () => ({
      get: (key: string) =>
        key === "taskExtraEnv"
          ? { VIRTUAL_ENV: "/workspace/.venv", IS_RUST_ANALYZER: "true" }
          : undefined,
      update: () => Promise.resolve(),
      has: () => true,
      inspect: () => undefined,
    });

    const execution = createCargoTaskExecution("build", ["core", "-m", "T2T1"], MOCK_WORKSPACE_FOLDER);
    assert.deepStrictEqual(execution.options?.env, {
      VIRTUAL_ENV: "/workspace/.venv",
      IS_RUST_ANALYZER: "true",
    });
  });
});
