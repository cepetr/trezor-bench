/**
 * Unit tests for ClangdProviderAdapter and clangd compile-database helpers.
 */

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  ClangdProviderAdapter,
  CLANGD_COMPILE_COMMANDS_DIR_NAME,
  CLANGD_COMPILE_COMMANDS_LINK_NAME,
  buildTbenchClangdConfig,
  getClangdCompileCommandsLinkPath,
  getWorkspaceClangdConfigPath,
} from "../../../intellisense/clangd-provider";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const vscodeMock = require("vscode");

function makeWorkspaceFolder(root: string): vscode.WorkspaceFolder {
  return {
    uri: vscodeMock.Uri.file(root),
    name: path.basename(root),
    index: 0,
  };
}

suite("clangd compile-database helpers", () => {
  test("buildTbenchClangdConfig points clangd at the tbench compile database dir", () => {
    const config = buildTbenchClangdConfig();
    assert.ok(config.includes("CompilationDatabase: .tbench"));
    assert.ok(config.includes("Trezor Bench"));
  });
});

suite("ClangdProviderAdapter", () => {
  let tmpRoot: string;
  let workspaceFolder: vscode.WorkspaceFolder;
  let artifactPath: string;
  let restartCount: number;

  setup(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-clangd-"));
    workspaceFolder = makeWorkspaceFolder(tmpRoot);
    artifactPath = path.join(tmpRoot, "artifacts", "model-t", "compile_commands_core.cc.json");
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, "[]", "utf-8");
    restartCount = 0;
  });

  teardown(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("applyArtifact creates a compile_commands.json symlink and restarts clangd", async () => {
    const adapter = new ClangdProviderAdapter(async () => {
      restartCount++;
    });

    await adapter.applyArtifact(workspaceFolder, artifactPath);

    const linkPath = getClangdCompileCommandsLinkPath(workspaceFolder);
    assert.ok(fs.lstatSync(linkPath).isSymbolicLink());
    assert.strictEqual(fs.readlinkSync(linkPath), path.relative(path.dirname(linkPath), artifactPath));
    assert.strictEqual(adapter.getLinkedArtifactPath(), artifactPath);
    assert.strictEqual(restartCount, 1);
    assert.strictEqual(
      fs.readFileSync(getWorkspaceClangdConfigPath(workspaceFolder), "utf-8"),
      buildTbenchClangdConfig()
    );
  });

  test("applyArtifact does not overwrite an existing user-owned .clangd file", async () => {
    const clangdPath = getWorkspaceClangdConfigPath(workspaceFolder);
    const userConfig = "CompileFlags:\n  Add: [-Wall]\n";
    fs.writeFileSync(clangdPath, userConfig, "utf-8");

    const adapter = new ClangdProviderAdapter(async () => {});
    await adapter.applyArtifact(workspaceFolder, artifactPath);

    assert.strictEqual(fs.readFileSync(clangdPath, "utf-8"), userConfig);
  });

  test("clear removes the symlink and restarts clangd", async () => {
    const adapter = new ClangdProviderAdapter(async () => {
      restartCount++;
    });

    await adapter.applyArtifact(workspaceFolder, artifactPath);
    await adapter.clear(workspaceFolder);

    const linkPath = getClangdCompileCommandsLinkPath(workspaceFolder);
    assert.throws(() => fs.lstatSync(linkPath));
    assert.strictEqual(adapter.getLinkedArtifactPath(), undefined);
    assert.strictEqual(restartCount, 2);
  });

  test("applyArtifact retargets the symlink when the active artifact changes", async () => {
    const adapter = new ClangdProviderAdapter(async () => {});
    const secondArtifactPath = path.join(
      tmpRoot,
      "artifacts",
      "model-t",
      "compile_commands_core_emu.cc.json"
    );
    fs.writeFileSync(secondArtifactPath, "[]", "utf-8");

    await adapter.applyArtifact(workspaceFolder, artifactPath);
    await adapter.applyArtifact(workspaceFolder, secondArtifactPath);

    const linkPath = getClangdCompileCommandsLinkPath(workspaceFolder);
    assert.strictEqual(
      path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath)),
      secondArtifactPath
    );
    assert.strictEqual(adapter.getLinkedArtifactPath(), secondArtifactPath);
  });

  test("managed compile database lives under .tbench/compile_commands.json", async () => {
    const adapter = new ClangdProviderAdapter(async () => {});
    await adapter.applyArtifact(workspaceFolder, artifactPath);

    const linkPath = getClangdCompileCommandsLinkPath(workspaceFolder);
    assert.ok(linkPath.endsWith(path.join(CLANGD_COMPILE_COMMANDS_DIR_NAME, CLANGD_COMPILE_COMMANDS_LINK_NAME)));
  });
});
