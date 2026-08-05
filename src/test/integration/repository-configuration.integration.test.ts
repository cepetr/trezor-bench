import * as assert from "assert";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ManifestService } from "../../manifest/manifest-service";
import { PresetService } from "../../presets/preset-service";
import { createCargoTaskExecution } from "../../tasks/xtask-execution";
import {
  loadRepositoryConfiguration,
  RepositoryConfigurationService,
  setRepositoryConfiguration,
} from "../../workspace/repository-configuration";

const MANIFEST = `
models:
  - id: T2T1
    name: Trezor Model T
targets:
  - id: hw
    name: Hardware
components:
  - id: core
    name: Core
`.trim();

function workspaceFolder(workspacePath: string): vscode.WorkspaceFolder {
  return {
    uri: vscode.Uri.file(workspacePath),
    name: "workspace",
    index: 0,
  };
}

async function waitForState(
  service: RepositoryConfigurationService,
  expectedStatus: "absent" | "loaded" | "invalid"
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      subscription.dispose();
      reject(new Error(`Timed out waiting for repository configuration state ${expectedStatus}.`));
    }, 3000);
    const subscription = service.onDidChangeState((state) => {
      if (state.status === expectedStatus) {
        clearTimeout(timeout);
        subscription.dispose();
        resolve();
      }
    });
  });
}

suite("Repository configuration integration", () => {
  let workspacePath: string;

  setup(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "tf-tools-repository-configuration-"));
  });

  teardown(async () => {
    setRepositoryConfiguration(workspaceFolder(workspacePath), undefined);
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  test("supplies configured manifest, presets, artifacts, debug templates, and workflow cwd", async () => {
    await fs.mkdir(path.join(workspacePath, "firmware/config"), { recursive: true });
    await fs.mkdir(path.join(workspacePath, "firmware/presets"), { recursive: true });
    await fs.writeFile(path.join(workspacePath, "firmware/config/manifest.yaml"), MANIFEST, "utf-8");
    await fs.writeFile(path.join(workspacePath, "firmware/presets/presets.toml"), "[[test]]\nfrozen = true\n", "utf-8");
    await fs.writeFile(
      path.join(workspacePath, "tf-tools.toml"),
      `[paths]
cargo-workspace = "firmware/workspace"
debug-templates = "firmware/debug/templates"
build-artifacts = "firmware/artifacts"
manifest = "firmware/config/manifest.yaml"
xtask-presets = "firmware/presets"
`,
      "utf-8"
    );

    const folder = workspaceFolder(workspacePath);
    const state = await loadRepositoryConfiguration(folder);
    assert.strictEqual(state.status, "loaded");
    if (state.status !== "loaded") {
      return;
    }
    setRepositoryConfiguration(folder, state.configuration);

    const manifestService = new ManifestService(state.configuration.manifestUri);
    const manifestState = await manifestService.start();
    manifestService.dispose();
    assert.strictEqual(manifestState.status, "loaded");

    const presetService = new PresetService(
      state.configuration.presetUris.shared,
      state.configuration.presetUris.user
    );
    const presetState = await presetService.start();
    presetService.dispose();
    assert.strictEqual(presetState.status, "loaded");

    assert.strictEqual(state.configuration.artifactsPath, path.join(workspacePath, "firmware/artifacts"));
    assert.strictEqual(state.configuration.debugTemplatesPath, path.join(workspacePath, "firmware/debug/templates"));

    const execution = createCargoTaskExecution("build", [], folder);
    assert.strictEqual(execution.options?.cwd, state.configuration.cargoWorkspacePath);
  });

  test("supplies default consumer paths when the configuration file is absent", async () => {
    await fs.mkdir(path.join(workspacePath, "core/embed/xtask"), { recursive: true });
    const folder = workspaceFolder(workspacePath);
    const state = await loadRepositoryConfiguration(folder);
    assert.strictEqual(state.status, "absent");
    if (state.status !== "absent") {
      return;
    }

    setRepositoryConfiguration(folder, state.configuration);
    assert.strictEqual(
      state.configuration.manifestUri.fsPath,
      path.join(workspacePath, "core/embed/xtask/tf-tools/manifest.yaml")
    );
    assert.strictEqual(
      state.configuration.presetUris.shared.fsPath,
      path.join(workspacePath, "core/embed/xtask/presets.toml")
    );
    assert.strictEqual(
      createCargoTaskExecution("build", [], folder).options?.cwd,
      path.join(workspacePath, "core/embed")
    );
  });

  test("uses empty cargo and artifacts paths while defaulting omitted entries", async () => {
    await fs.writeFile(
      path.join(workspacePath, "tf-tools.toml"),
      '[paths]\ncargo-workspace = ""\nbuild-artifacts = ""\n',
      "utf-8"
    );
    const folder = workspaceFolder(workspacePath);
    const state = await loadRepositoryConfiguration(folder);
    assert.strictEqual(state.status, "loaded");
    if (state.status !== "loaded") {
      return;
    }

    setRepositoryConfiguration(folder, state.configuration);
    assert.strictEqual(state.configuration.artifactsPath, "");
    assert.strictEqual(
      state.configuration.debugTemplatesPath,
      path.join(workspacePath, "core/embed/xtask/tf-tools/debug")
    );
    assert.strictEqual(createCargoTaskExecution("build", [], folder).options?.cwd, workspacePath);
  });

  test("watches create, invalid change, valid replacement, and deletion", async () => {
    const folder = workspaceFolder(workspacePath);
    const service = new RepositoryConfigurationService(folder);
    const initial = await service.start();
    assert.strictEqual(initial.status, "absent");

    const configurationPath = path.join(workspacePath, "tf-tools.toml");
    const created = waitForState(service, "loaded");
    await fs.writeFile(configurationPath, '[paths]\nmanifest = "firmware/manifest.yaml"', "utf-8");
    await created;

    const invalid = waitForState(service, "invalid");
    await fs.writeFile(configurationPath, "[paths", "utf-8");
    await invalid;
    assert.ok(service.state, "expected the service to retain the latest state");
    assert.strictEqual(service.state?.status, "invalid");

    const recovered = waitForState(service, "loaded");
    await fs.writeFile(configurationPath, '[paths]\ncargo-workspace = "firmware"', "utf-8");
    await recovered;

    const deleted = waitForState(service, "absent");
    await fs.rm(configurationPath);
    await deleted;
    service.dispose();
  });
});