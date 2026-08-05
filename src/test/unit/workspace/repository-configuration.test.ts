import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { loadRepositoryConfiguration } from "../../../workspace/repository-configuration";

function workspaceFolder(workspacePath: string): vscode.WorkspaceFolder {
  return {
    uri: vscode.Uri.file(workspacePath),
    name: "workspace",
    index: 0,
  };
}

suite("Repository configuration", () => {
  let workspacePath: string;

  setup(async () => {
    workspacePath = vscode.Uri.file(
      await fs.mkdtemp(path.join(os.tmpdir(), "tf-tools-repository-configuration-"))
    ).fsPath;
  });

  teardown(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  test("resolves every supported path from a valid TOML file", async () => {
    const absoluteTemplatesPath = path.join(os.tmpdir(), "tf-tools-debug-templates");
    await fs.writeFile(
      path.join(workspacePath, "tf-tools.toml"),
      `[paths]
cargo-workspace = "firmware/workspace"
debug-templates = "${absoluteTemplatesPath}"
build-artifacts = "firmware/artifacts"
manifest = "firmware/config/manifest.yaml"
xtask-presets = "firmware/presets"
unused-future-entry = "ignored"
`,
      "utf-8"
    );

    const state = await loadRepositoryConfiguration(workspaceFolder(workspacePath));

    assert.strictEqual(state.status, "loaded");
    if (state.status !== "loaded") {
      return;
    }

    assert.strictEqual(state.configuration.cargoWorkspacePath, path.join(workspacePath, "firmware/workspace"));
    assert.strictEqual(state.configuration.debugTemplatesPath, absoluteTemplatesPath);
    assert.strictEqual(state.configuration.artifactsPath, path.join(workspacePath, "firmware/artifacts"));
    assert.strictEqual(state.configuration.manifestUri.fsPath, path.join(workspacePath, "firmware/config/manifest.yaml"));
    assert.strictEqual(state.configuration.presetUris.shared.fsPath, path.join(workspacePath, "firmware/presets/presets.toml"));
    assert.strictEqual(state.configuration.presetUris.user.fsPath, path.join(workspacePath, "firmware/presets/user-presets.toml"));
  });

  test("retains VS Code variable text as a literal relative path", async () => {
    await fs.writeFile(
      path.join(workspacePath, "tf-tools.toml"),
      '[paths]\nmanifest = "${workspaceFolder}/manifest.yaml"\n',
      "utf-8"
    );

    const state = await loadRepositoryConfiguration(workspaceFolder(workspacePath));

    assert.strictEqual(state.status, "loaded");
    if (state.status === "loaded") {
      assert.strictEqual(
        state.configuration.manifestUri.fsPath,
        path.join(workspacePath, "${workspaceFolder}/manifest.yaml")
      );
    }
  });

  test("uses every built-in default when the repository configuration is absent", async () => {
    const state = await loadRepositoryConfiguration(workspaceFolder(workspacePath));

    assert.strictEqual(state.status, "absent");
    if (state.status !== "absent") {
      return;
    }

    assert.strictEqual(state.configuration.cargoWorkspacePath, path.join(workspacePath, "core/embed"));
    assert.strictEqual(state.configuration.debugTemplatesPath, path.join(workspacePath, "core/embed/xtask/tf-tools/debug"));
    assert.strictEqual(state.configuration.artifactsPath, path.join(workspacePath, "core/build-xtask/artifacts"));
    assert.strictEqual(state.configuration.manifestUri.fsPath, path.join(workspacePath, "core/embed/xtask/tf-tools/manifest.yaml"));
    assert.strictEqual(state.configuration.presetUris.shared.fsPath, path.join(workspacePath, "core/embed/xtask/presets.toml"));
    assert.strictEqual(state.configuration.presetUris.user.fsPath, path.join(workspacePath, "core/embed/xtask/user-presets.toml"));
  });

  test("applies partial entries and explicit empty-value rules independently", async () => {
    await fs.writeFile(
      path.join(workspacePath, "tf-tools.toml"),
      `[paths]
cargo-workspace = ""
debug-templates = ""
build-artifacts = ""
manifest = ""
xtask-presets = ""
`,
      "utf-8"
    );

    const state = await loadRepositoryConfiguration(workspaceFolder(workspacePath));

    assert.strictEqual(state.status, "loaded");
    if (state.status !== "loaded") {
      return;
    }

    assert.strictEqual(state.configuration.cargoWorkspacePath, workspacePath);
    assert.strictEqual(state.configuration.debugTemplatesPath, path.join(workspacePath, "core/embed/xtask/tf-tools/debug"));
    assert.strictEqual(state.configuration.artifactsPath, "");
    assert.strictEqual(state.configuration.manifestUri.fsPath, path.join(workspacePath, "core/embed/xtask/tf-tools/manifest.yaml"));
    assert.strictEqual(state.configuration.presetUris.shared.fsPath, path.join(workspacePath, "core/embed/xtask/presets.toml"));
    assert.strictEqual(state.configuration.presetUris.user.fsPath, path.join(workspacePath, "core/embed/xtask/user-presets.toml"));
  });

  test("returns a blocking invalid state for malformed TOML", async () => {
    await fs.writeFile(path.join(workspacePath, "tf-tools.toml"), "[paths\nmanifest = 'x'", "utf-8");

    const state = await loadRepositoryConfiguration(workspaceFolder(workspacePath));

    assert.strictEqual(state.status, "invalid");
    if (state.status === "invalid") {
      assert.strictEqual(state.validationIssues[0]?.code, "toml-parse");
      assert.ok(state.validationIssues[0]?.range, "expected malformed TOML to provide an anchored issue");
    }
  });

  test("returns a blocking invalid state when paths is not a table", async () => {
    await fs.writeFile(path.join(workspacePath, "tf-tools.toml"), 'paths = "invalid"', "utf-8");

    const state = await loadRepositoryConfiguration(workspaceFolder(workspacePath));

    assert.strictEqual(state.status, "invalid");
    if (state.status === "invalid") {
      assert.strictEqual(state.validationIssues[0]?.code, "invalid-paths");
    }
  });

  test("returns a blocking invalid state for a non-string supported path", async () => {
    await fs.writeFile(path.join(workspacePath, "tf-tools.toml"), "[paths]\nmanifest = 42", "utf-8");

    const state = await loadRepositoryConfiguration(workspaceFolder(workspacePath));

    assert.strictEqual(state.status, "invalid");
    if (state.status === "invalid") {
      assert.strictEqual(state.validationIssues[0]?.code, "invalid-path");
      assert.match(state.validationIssues[0]?.message ?? "", /paths\.manifest/);
    }
  });
});