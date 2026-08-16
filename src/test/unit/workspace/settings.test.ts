/**
 * Unit tests for the typed tbench settings accessors.
 *
 * Variable expansion itself is covered by `settings-variables.test.ts`;
 * these tests cover the accessor layer: defaults when settings are absent,
 * configured values, and the malformed-value guard of `readTaskExtraEnv`.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import {
  isStatusBarEnabled,
  readTaskExtraEnv,
  readExcludedFilesSettings,
} from "../../../workspace/settings";

const MOCK_WORKSPACE_FOLDER = {
  uri: vscode.Uri.file("/workspace"),
  name: "workspace",
  index: 0,
} as vscode.WorkspaceFolder;

/** Serves the given settings map through `workspace.getConfiguration`. */
function stubConfiguration(values: Record<string, unknown>): void {
  vscode.workspace.getConfiguration = () => ({
    get: (key: string) => values[key],
    update: () => Promise.resolve(),
    has: () => true,
    inspect: () => undefined,
  });
}

suite("settings accessors", () => {
  const originalGetConfiguration = vscode.workspace.getConfiguration;

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  // -------------------------------------------------------------------------
  // isStatusBarEnabled
  // -------------------------------------------------------------------------

  test("isStatusBarEnabled defaults to true when the setting is absent", () => {
    stubConfiguration({});
    assert.strictEqual(isStatusBarEnabled(MOCK_WORKSPACE_FOLDER), true);
  });

  test("isStatusBarEnabled returns the configured value", () => {
    stubConfiguration({ showConfigurationInStatusBar: false });
    assert.strictEqual(isStatusBarEnabled(MOCK_WORKSPACE_FOLDER), false);

    stubConfiguration({ showConfigurationInStatusBar: true });
    assert.strictEqual(isStatusBarEnabled(MOCK_WORKSPACE_FOLDER), true);
  });

  // -------------------------------------------------------------------------
  // readTaskExtraEnv
  // -------------------------------------------------------------------------

  test("readTaskExtraEnv returns an empty object when the setting is absent", () => {
    stubConfiguration({});
    assert.deepStrictEqual(readTaskExtraEnv(MOCK_WORKSPACE_FOLDER), {});
  });

  test("readTaskExtraEnv returns an empty object for non-object values", () => {
    stubConfiguration({ taskExtraEnv: ["NOT", "AN", "OBJECT"] });
    assert.deepStrictEqual(readTaskExtraEnv(MOCK_WORKSPACE_FOLDER), {});

    stubConfiguration({ taskExtraEnv: "PATH=/bin" });
    assert.deepStrictEqual(readTaskExtraEnv(MOCK_WORKSPACE_FOLDER), {});
  });

  test("readTaskExtraEnv keeps string entries and drops non-string values", () => {
    stubConfiguration({
      taskExtraEnv: {
        KEEP: "value",
        DROP_NUMBER: 42,
        DROP_BOOLEAN: true,
        DROP_OBJECT: { nested: "x" },
      },
    });
    assert.deepStrictEqual(readTaskExtraEnv(MOCK_WORKSPACE_FOLDER), { KEEP: "value" });
  });

  // -------------------------------------------------------------------------
  // readExcludedFilesSettings
  // -------------------------------------------------------------------------

  test("readExcludedFilesSettings returns contract defaults when settings are absent", () => {
    stubConfiguration({});
    assert.deepStrictEqual(readExcludedFilesSettings(MOCK_WORKSPACE_FOLDER), {
      grayInTree: true,
      showEditorOverlay: true,
      fileNamePatterns: ["*.c"],
      folderGlobs: ["core/embed/**", "core/vendor/**"],
    });
  });

  test("readExcludedFilesSettings returns the configured values", () => {
    stubConfiguration({
      "excludedFiles.grayInTree": false,
      "excludedFiles.showEditorOverlay": false,
      "excludedFiles.fileNamePatterns": ["*.h"],
      "excludedFiles.folderGlobs": ["legacy/**"],
    });
    assert.deepStrictEqual(readExcludedFilesSettings(MOCK_WORKSPACE_FOLDER), {
      grayInTree: false,
      showEditorOverlay: false,
      fileNamePatterns: ["*.h"],
      folderGlobs: ["legacy/**"],
    });
  });

  test("readExcludedFilesSettings expands variable references in globs", () => {
    stubConfiguration({
      "excludedFiles.folderGlobs": ["${workspaceFolder}/core/embed/**"],
    });
    const settings = readExcludedFilesSettings(MOCK_WORKSPACE_FOLDER);
    assert.deepStrictEqual(settings.folderGlobs, ["/workspace/core/embed/**"]);
  });
});
