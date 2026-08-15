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

/**
 * Polls `predicate` until it returns true or `timeoutMs` elapses. Real
 * OS-level file-watch dispatch latency for a path outside any open
 * workspace folder (as in these tmpdir-based tests) varies far more than a
 * fixed sleep can safely account for; polling resolves as soon as the
 * watcher fires instead of guessing a duration.
 */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 50
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      return;
    }
    await wait(intervalMs);
  }
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

  test("preset-missing-shared publishes 'unavailable'", async () => {
    const { shared, user } = fixtureUris("preset-missing-shared");
    const service = new PresetService(shared, user);
    const state = await service.start();
    service.dispose();

    assert.strictEqual(state.status, "unavailable");
    if (state.status === "unavailable") {
      assert.strictEqual(state.shared.present, false);
      // Absence itself carries no issue — the state, not a diagnostic, is the
      // signal, since there is no file content to attribute one to.
      assert.strictEqual(state.shared.issues.length, 0);
      assert.strictEqual(state.validationIssues.length, 0);
      // The user file is still read; it simply contributes no choices while
      // the shared input is unavailable.
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

suite("PresetService – watching and reload", function () {
  // These tests wait on real watcher events, debounce windows, and poller
  // ticks; multi-second durations are expected here, not a regression.
  this.slow(5000);

  let tmpDir: string;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tbench-preset-service-"));
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
    await waitUntil(() => states.length > 0, 8000);
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
    await waitUntil(() => states.length > 0, 8000);
    assert.ok(states.length > 0, "expected a republish after user-presets.toml changes");
    last = states[states.length - 1];
    if (last.status === "loaded") {
      assert.deepStrictEqual(last.user.names, ["other"]);
    }

    // Delete
    states.length = 0;
    await fs.rm(userPath);
    await waitUntil(() => states.length > 0, 8000);
    assert.ok(states.length > 0, "expected a republish after user-presets.toml is deleted");
    last = states[states.length - 1];
    assert.strictEqual(last.status, "loaded");
    if (last.status === "loaded") {
      assert.strictEqual(last.user.present, false);
    }

    service.dispose();
  });

  test("deleting and recreating presets.toml moves the state loaded → unavailable → loaded, no window reload", async () => {
    const sharedPath = path.join(tmpDir, "presets.toml");
    const userPath = path.join(tmpDir, "user-presets.toml");
    await fs.writeFile(sharedPath, "[[test]]\nfrozen = true\n", "utf-8");

    const service = new PresetService(vscode.Uri.file(sharedPath), vscode.Uri.file(userPath));
    const initial = await service.start();
    assert.strictEqual(initial.status, "loaded");

    const states: PresetState[] = [];
    service.onDidChangeState((s) => states.push(s));

    await fs.rm(sharedPath);
    await waitUntil(() => states.some((s) => s.status === "unavailable"), 8000);
    let last = states[states.length - 1];
    assert.strictEqual(last.status, "unavailable", "deleting presets.toml must publish unavailable");
    assert.strictEqual(last.shared.present, false);

    states.length = 0;
    await fs.writeFile(sharedPath, "[[test]]\nfrozen = false\n", "utf-8");
    await waitUntil(() => states.some((s) => s.status === "loaded"), 8000);
    last = states[states.length - 1];
    assert.strictEqual(last.status, "loaded", "restoring presets.toml must publish loaded again");
    if (last.status === "loaded") {
      assert.deepStrictEqual(last.shared.names, ["test"]);
    }

    service.dispose();
  });

  test("an absent shared file outranks an invalid user file", async () => {
    const sharedPath = path.join(tmpDir, "presets.toml");
    const userPath = path.join(tmpDir, "user-presets.toml");
    // No presets.toml at all, and a user file that would otherwise be a
    // file-level error: the more fundamental condition is reported.
    await fs.writeFile(userPath, "[[local]] frozen = = true\n", "utf-8");

    const service = new PresetService(vscode.Uri.file(sharedPath), vscode.Uri.file(userPath));
    const state = await service.start();
    service.dispose();

    assert.strictEqual(state.status, "unavailable");
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
    tmpDirA = await fs.mkdtemp(path.join(os.tmpdir(), "tbench-preset-cwp-a-"));
    tmpDirB = await fs.mkdtemp(path.join(os.tmpdir(), "tbench-preset-cwp-b-"));
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
