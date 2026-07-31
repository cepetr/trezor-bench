/**
 * Integration tests for PresetService: loading, absence handling, invalidity,
 * and file-watcher republishing. Runs inside the VS Code extension host.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { PresetService } from "../../presets/preset-service";
import { PresetState } from "../../presets/preset-types";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fixtureUris(fixtureName: string): { shared: vscode.Uri; user: vscode.Uri } {
  const base = path.resolve(__dirname, "../../../test-fixtures/workspaces", fixtureName, "xtask/tf-tools");
  return {
    shared: vscode.Uri.file(path.join(base, "presets.toml")),
    user: vscode.Uri.file(path.join(base, "user-presets.toml")),
  };
}

suite("PresetService – load states", () => {
  test("preset-valid loads a 'loaded' state from both files", async () => {
    const { shared, user } = fixtureUris("preset-valid");
    const service = new PresetService(shared, user);
    const state = await service.start();
    service.dispose();

    assert.strictEqual(state.status, "loaded");
    if (state.status === "loaded") {
      assert.strictEqual(state.shared.present, true);
      assert.strictEqual(state.user.present, true);
      assert.deepStrictEqual(state.shared.names, ["test", "dev"]);
      assert.deepStrictEqual(state.user.names, ["local", "test"]);
    }
  });

  test("preset-missing-shared loads without any missing-file signal (FR-027)", async () => {
    const { shared, user } = fixtureUris("preset-missing-shared");
    const service = new PresetService(shared, user);
    const state = await service.start();
    service.dispose();

    assert.strictEqual(state.status, "loaded");
    if (state.status === "loaded") {
      assert.strictEqual(state.shared.present, false);
      assert.strictEqual(state.shared.issues.length, 0);
      assert.strictEqual(state.user.present, true);
    }
  });

  test("preset-malformed-shared publishes 'invalid' with an issue on presets.toml", async () => {
    const { shared, user } = fixtureUris("preset-malformed-shared");
    const service = new PresetService(shared, user);
    const state = await service.start();
    service.dispose();

    assert.strictEqual(state.status, "invalid");
    if (state.status === "invalid") {
      assert.ok(state.shared.issues.some((i) => i.severity === "error"));
      assert.ok(state.validationIssues.some((i) => i.severity === "error"));
    }
  });

  test("preset-invalid-user publishes 'invalid' with an issue on user-presets.toml", async () => {
    const { shared, user } = fixtureUris("preset-invalid-user");
    const service = new PresetService(shared, user);
    const state = await service.start();
    service.dispose();

    assert.strictEqual(state.status, "invalid");
    if (state.status === "invalid") {
      assert.ok(state.user.issues.some((i) => i.severity === "error"));
      assert.strictEqual(state.shared.issues.filter((i) => i.severity === "error").length, 0);
    }
  });
});

suite("PresetService – watching and reload", () => {
  let tmpDir: string;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tf-tools-preset-service-"));
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("create/change/delete of user-presets.toml republishes state within the debounce window, no window reload", async () => {
    const sharedPath = path.join(tmpDir, "presets.toml");
    const userPath = path.join(tmpDir, "user-presets.toml");
    await fs.writeFile(sharedPath, "[[test]]\nfrozen = true\n", "utf-8");

    const service = new PresetService(vscode.Uri.file(sharedPath), vscode.Uri.file(userPath));
    const initial = await service.start();
    assert.strictEqual(initial.status, "loaded");
    if (initial.status === "loaded") {
      assert.strictEqual(initial.user.present, false);
    }

    const states: PresetState[] = [];
    service.onDidChangeState((s) => states.push(s));

    // Create
    await fs.writeFile(userPath, "[[local]]\nfrozen = false\n", "utf-8");
    await wait(1500);
    assert.ok(states.length > 0, "expected a republish after user-presets.toml is created");
    let last = states[states.length - 1];
    assert.strictEqual(last.status, "loaded");
    if (last.status === "loaded") {
      assert.strictEqual(last.user.present, true);
      assert.deepStrictEqual(last.user.names, ["local"]);
    }

    // Change
    states.length = 0;
    await fs.writeFile(userPath, "[[other]]\nfrozen = true\n", "utf-8");
    await wait(1500);
    assert.ok(states.length > 0, "expected a republish after user-presets.toml changes");
    last = states[states.length - 1];
    if (last.status === "loaded") {
      assert.deepStrictEqual(last.user.names, ["other"]);
    }

    // Delete
    states.length = 0;
    await fs.rm(userPath);
    await wait(1500);
    assert.ok(states.length > 0, "expected a republish after user-presets.toml is deleted");
    last = states[states.length - 1];
    assert.strictEqual(last.status, "loaded");
    if (last.status === "loaded") {
      assert.strictEqual(last.user.present, false);
    }

    service.dispose();
  });

  test("reload() forces an immediate re-read from disk", async () => {
    const sharedPath = path.join(tmpDir, "presets.toml");
    const userPath = path.join(tmpDir, "user-presets.toml");
    await fs.writeFile(sharedPath, "[[test]]\nfrozen = true\n", "utf-8");

    const service = new PresetService(vscode.Uri.file(sharedPath), vscode.Uri.file(userPath));
    await service.start();

    await fs.writeFile(sharedPath, "[[test]]\nfrozen = false\n\n[[dev]]\nfrozen = true\n", "utf-8");
    const reloaded = await service.reload();
    service.dispose();

    assert.strictEqual(reloaded.status, "loaded");
    if (reloaded.status === "loaded") {
      assert.deepStrictEqual(reloaded.shared.names, ["test", "dev"]);
    }
  });
});

suite("PresetService – cargoWorkspacePath re-resolution", () => {
  let tmpDirA: string;
  let tmpDirB: string;

  setup(async () => {
    tmpDirA = await fs.mkdtemp(path.join(os.tmpdir(), "tf-tools-preset-cwp-a-"));
    tmpDirB = await fs.mkdtemp(path.join(os.tmpdir(), "tf-tools-preset-cwp-b-"));
  });

  teardown(async () => {
    await fs.rm(tmpDirA, { recursive: true, force: true });
    await fs.rm(tmpDirB, { recursive: true, force: true });
  });

  test("a differently-resolved cargo workspace path loads distinct preset content", async () => {
    await fs.writeFile(path.join(tmpDirA, "presets.toml"), "[[a]]\nfrozen = true\n", "utf-8");
    await fs.writeFile(path.join(tmpDirB, "presets.toml"), "[[b]]\nfrozen = false\n", "utf-8");

    const serviceA = new PresetService(
      vscode.Uri.file(path.join(tmpDirA, "presets.toml")),
      vscode.Uri.file(path.join(tmpDirA, "user-presets.toml"))
    );
    const serviceB = new PresetService(
      vscode.Uri.file(path.join(tmpDirB, "presets.toml")),
      vscode.Uri.file(path.join(tmpDirB, "user-presets.toml"))
    );

    const stateA = await serviceA.start();
    const stateB = await serviceB.start();
    serviceA.dispose();
    serviceB.dispose();

    assert.strictEqual(stateA.status, "loaded");
    assert.strictEqual(stateB.status, "loaded");
    if (stateA.status === "loaded" && stateB.status === "loaded") {
      assert.deepStrictEqual(stateA.shared.names, ["a"]);
      assert.deepStrictEqual(stateB.shared.names, ["b"]);
    }
  });
});
