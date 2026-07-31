/**
 * Unit tests for preset input path resolution.
 *
 * Both preset files live under <cargo-workspace>/xtask/tf-tools/, resolved
 * from the existing tfTools.cargoWorkspacePath setting — never from
 * tfTools.manifestPath (research Decision 2).
 */
import * as assert from "assert";
import * as vscode from "vscode";
import { resolvePresetUris } from "../../../workspace/settings";

const MOCK_WORKSPACE_FOLDER = {
  uri: vscode.Uri.file("/workspace"),
  name: "workspace",
  index: 0,
} as vscode.WorkspaceFolder;

suite("resolvePresetUris", () => {
  const originalGetConfiguration = vscode.workspace.getConfiguration;

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test("resolves both preset URIs under the default core/embed cargo workspace path", () => {
    vscode.workspace.getConfiguration = () =>
      ({
        get: (key: string) => (key === "cargoWorkspacePath" ? "core/embed" : undefined),
        update: () => Promise.resolve(),
        has: () => true,
        inspect: () => undefined,
      }) as unknown as vscode.WorkspaceConfiguration;

    const { shared, user } = resolvePresetUris(MOCK_WORKSPACE_FOLDER);
    assert.strictEqual(shared.fsPath, "/workspace/core/embed/xtask/tf-tools/presets.toml");
    assert.strictEqual(user.fsPath, "/workspace/core/embed/xtask/tf-tools/user-presets.toml");
  });

  test("re-resolves under a repointed tfTools.cargoWorkspacePath", () => {
    vscode.workspace.getConfiguration = () =>
      ({
        get: (key: string) => (key === "cargoWorkspacePath" ? "vendor/other-workspace" : undefined),
        update: () => Promise.resolve(),
        has: () => true,
        inspect: () => undefined,
      }) as unknown as vscode.WorkspaceConfiguration;

    const { shared, user } = resolvePresetUris(MOCK_WORKSPACE_FOLDER);
    assert.strictEqual(shared.fsPath, "/workspace/vendor/other-workspace/xtask/tf-tools/presets.toml");
    assert.strictEqual(user.fsPath, "/workspace/vendor/other-workspace/xtask/tf-tools/user-presets.toml");
  });

  test("falls back to the workspace root when cargoWorkspacePath is empty", () => {
    vscode.workspace.getConfiguration = () =>
      ({
        get: () => undefined,
        update: () => Promise.resolve(),
        has: () => true,
        inspect: () => undefined,
      }) as unknown as vscode.WorkspaceConfiguration;

    const { shared, user } = resolvePresetUris(MOCK_WORKSPACE_FOLDER);
    assert.strictEqual(shared.fsPath, "/workspace/xtask/tf-tools/presets.toml");
    assert.strictEqual(user.fsPath, "/workspace/xtask/tf-tools/user-presets.toml");
  });

  test("never derives preset paths from tfTools.manifestPath", () => {
    vscode.workspace.getConfiguration = () =>
      ({
        get: (key: string) => {
          if (key === "manifestPath") {
            return "some/other/manifest.yaml";
          }
          if (key === "cargoWorkspacePath") {
            return "core/embed";
          }
          return undefined;
        },
        update: () => Promise.resolve(),
        has: () => true,
        inspect: () => undefined,
      }) as unknown as vscode.WorkspaceConfiguration;

    const { shared, user } = resolvePresetUris(MOCK_WORKSPACE_FOLDER);
    assert.strictEqual(shared.fsPath, "/workspace/core/embed/xtask/tf-tools/presets.toml");
    assert.strictEqual(user.fsPath, "/workspace/core/embed/xtask/tf-tools/user-presets.toml");
  });
});
