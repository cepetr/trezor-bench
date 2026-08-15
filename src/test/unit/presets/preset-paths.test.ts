/**
 * Unit tests for preset input path resolution.
 *
 * Both preset files are resolved directly from `[paths].presets` in the
 * repository configuration.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import { resolvePresetUris } from "../../../workspace/settings";
import { setRepositoryConfig } from "../../../workspace/repository-config";

const MOCK_WORKSPACE_FOLDER = {
  uri: vscode.Uri.file("/workspace"),
  name: "workspace",
  index: 0,
} as vscode.WorkspaceFolder;

suite("resolvePresetUris", () => {
  teardown(() => {
    setRepositoryConfig(MOCK_WORKSPACE_FOLDER, undefined);
  });

  test("resolves both preset URIs from the default repository configuration", () => {
    const { shared, user } = resolvePresetUris(MOCK_WORKSPACE_FOLDER);
    assert.strictEqual(shared.fsPath, "/workspace/core/embed/xtask/presets.toml");
    assert.strictEqual(user.fsPath, "/workspace/core/embed/xtask/user-presets.toml");
  });

  test("uses a repository snapshot's direct preset URIs", () => {
    setRepositoryConfig(MOCK_WORKSPACE_FOLDER, {
      configUri: vscode.Uri.file("/workspace/tbench.toml"),
      cargoWorkspacePath: "/workspace/core/embed",
      debugTemplatesPath: "/workspace/core/embed/xtask/tf-tools/debug",
      artifactsPath: "/workspace/core/build-xtask/artifacts",
      manifestUri: vscode.Uri.file("/workspace/core/embed/xtask/tf-tools/manifest.yaml"),
      presetUris: {
        shared: vscode.Uri.file("/workspace/vendor/presets/shared.toml"),
        user: vscode.Uri.file("/workspace/vendor/presets/user.toml"),
      },
    });

    const { shared, user } = resolvePresetUris(MOCK_WORKSPACE_FOLDER);
    assert.strictEqual(shared.fsPath, "/workspace/vendor/presets/shared.toml");
    assert.strictEqual(user.fsPath, "/workspace/vendor/presets/user.toml");
  });
});
