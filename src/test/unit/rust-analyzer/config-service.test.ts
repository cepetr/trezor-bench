import * as assert from "assert";
import { RustAnalyzerConfigService } from "../../../rust-analyzer/config-service";
import { RustAnalyzerApi, RustAnalyzerExtension, RustAnalyzerRunner } from "../../../rust-analyzer/config-types";

const runner: RustAnalyzerRunner = {
  run: () => ({
    result: Promise.resolve({ stdout: "", stderr: "", exitCode: 0, cancelled: false }),
    cancel: () => {},
  }),
};

function createExtension(api: RustAnalyzerApi): RustAnalyzerExtension {
  return {
    isActive: true,
    exports: api,
    activate: async () => api,
  };
}

suite("RustAnalyzerConfigService", () => {
  test("generates hardware configuration with model, preset, and effective flags", async () => {
    const calls: string[][] = [];
    const registrations: Array<Readonly<Record<string, unknown>>> = [];
    const service = new RustAnalyzerConfigService({
      workspaceState: { get: <T>() => "model-specific" as T, update: async () => {} },
      runner: {
        run: (args) => {
          calls.push([...args]);
          return {
            result: Promise.resolve({
              stdout: "[cargo]\nfeatures = [\"model-t\"]\ntarget = \"thumb\"\n[check]\nextraArgs = [\"--target\", \"thumb\"]\n",
              stderr: "",
              exitCode: 0,
              cancelled: false,
            }),
            cancel: () => {},
          };
        },
      },
      getExtension: () => createExtension({
        addConfiguration: async (_id, configuration) => { registrations.push(configuration); },
      }),
    });

    service.restoreMode();
    service.setInputs({
      modelId: "T2T1",
      targetId: "hardware",
      emulator: false,
      presetId: "release",
      effectiveFlags: ["--features", "ui"],
    });
    await service.refresh();

    assert.deepStrictEqual(calls, [["-m", "T2T1", "-p", "release", "--features", "ui"]]);
    assert.deepStrictEqual(registrations[0], {
      "cargo.features": ["model-t"],
      "cargo.target": "thumb",
      "check.extraArgs": ["--target", "thumb"],
    });
  });

  test("does not invoke the generator in all-features mode", async () => {
    let calls = 0;
    const service = new RustAnalyzerConfigService({
      workspaceState: { get: <T>() => "all-features" as T, update: async () => {} },
      runner: { run: () => { calls += 1; return runner.run([]); } },
      getExtension: () => createExtension({ addConfiguration: async () => {} }),
    });
    service.restoreMode();
    service.setInputs({ modelId: "T2T1", targetId: "emu", emulator: true, targetFlag: "--emulator", presetId: "default", effectiveFlags: [] });
    await service.refresh();
    assert.strictEqual(calls, 0);
  });

  test("registers all-features configuration when build inputs are available", async () => {
    const registrations: Array<Readonly<Record<string, unknown>>> = [];
    const service = new RustAnalyzerConfigService({
      workspaceState: { get: <T>() => "all-features" as T, update: async () => {} },
      runner,
      getExtension: () => createExtension({
        addConfiguration: async (_id, configuration) => { registrations.push(configuration); },
      }),
    });

    service.restoreMode();
    service.setInputs({ modelId: "T2T1", targetId: "hardware", emulator: false, presetId: "default", effectiveFlags: [] });
    await service.refresh();

    assert.deepStrictEqual(registrations, [{ "cargo.features": "all" }]);
  });

  test("does not refresh all-features configuration when build inputs change", async () => {
    const registrations: Array<Readonly<Record<string, unknown>>> = [];
    const service = new RustAnalyzerConfigService({
      workspaceState: { get: <T>() => "all-features" as T, update: async () => {} },
      runner,
      getExtension: () => createExtension({
        addConfiguration: async (_id, configuration) => { registrations.push(configuration); },
      }),
    });

    service.restoreMode();
    await service.refresh();
    assert.strictEqual(service.setInputs({ modelId: "T2T1", targetId: "hardware", emulator: false, presetId: "default", effectiveFlags: [] }), false);
    assert.strictEqual(service.setInputs({ modelId: "T3T1", targetId: "emu", emulator: true, targetFlag: "--emulator", presetId: "release", effectiveFlags: ["--features", "ui"] }), false);

    assert.deepStrictEqual(registrations, [{ "cargo.features": "all" }]);
  });

  test("cancels obsolete generation and applies only the latest inputs", async () => {
    const runs: Array<{ resolve: (value: { stdout: string; stderr: string; exitCode: number; cancelled: boolean }) => void; cancelled: boolean }> = [];
    const registrations: Array<Readonly<Record<string, unknown>>> = [];
    const service = new RustAnalyzerConfigService({
      workspaceState: { get: <T>() => "model-specific" as T, update: async () => {} },
      runner: {
        run: () => {
          let resolve!: (value: { stdout: string; stderr: string; exitCode: number; cancelled: boolean }) => void;
          const run = { resolve, cancelled: false };
          const result = new Promise<{ stdout: string; stderr: string; exitCode: number; cancelled: boolean }>((next) => {
            run.resolve = next;
          });
          runs.push(run);
          return { result, cancel: () => { run.cancelled = true; } };
        },
      },
      getExtension: () => createExtension({
        addConfiguration: async (_id, configuration) => { registrations.push(configuration); },
      }),
    });
    const inputs = (modelId: string) => ({ modelId, targetId: "hardware", emulator: false, presetId: "default", effectiveFlags: [] });

    service.restoreMode();
    service.setInputs(inputs("first"));
    const first = service.refresh();
    await Promise.resolve();
    service.setInputs(inputs("second"));
    const second = service.refresh();
    await Promise.resolve();
    const stdout = "[cargo]\nfeatures = [\"model-t\"]\ntarget = \"thumb\"\n[check]\nextraArgs = [\"--target\", \"thumb\"]\n";
    runs[1].resolve({ stdout, stderr: "", exitCode: 0, cancelled: false });
    runs[0].resolve({ stdout, stderr: "", exitCode: 0, cancelled: false });
    await Promise.all([first, second]);

    assert.strictEqual(runs[0].cancelled, true);
    assert.strictEqual(registrations.length, 1);
  });

  test("defaults to all features, persists mode changes, and registers the complete configuration", async () => {
    const stored: Record<string, unknown> = {};
    const registrations: Array<Readonly<Record<string, unknown>>> = [];
    const service = new RustAnalyzerConfigService({
      workspaceState: {
        get: <T>(key: string) => stored[key] as T | undefined,
        update: async (key: string, value: unknown) => {
          stored[key] = value;
        },
      },
      runner,
      getExtension: () => createExtension({
        addConfiguration: async (_id, configuration) => {
          registrations.push(configuration);
        },
      }),
    });

    assert.strictEqual(service.restoreMode(), "all-features");
    await service.refresh();
    assert.deepStrictEqual(registrations, [{ "cargo.features": "all" }]);

    await service.selectMode("model-specific");
    assert.strictEqual(stored["rustAnalyzer.mode"], "model-specific");
    assert.strictEqual(service.mode, "model-specific");
  });

  test("restores a valid persisted mode and normalizes an invalid value", () => {
    const createService = (value: unknown) => new RustAnalyzerConfigService({
      workspaceState: { get: <T>() => value as T, update: async () => {} },
      runner,
      getExtension: () => undefined,
    });

    assert.strictEqual(createService("model-specific").restoreMode(), "model-specific");
    assert.strictEqual(createService("unknown").restoreMode(), "all-features");
  });

  test("waits for startup inputs before reporting an unavailable model-specific context", async () => {
    const failures: unknown[] = [];
    const service = new RustAnalyzerConfigService({
      workspaceState: { get: <T>() => "model-specific" as T, update: async () => {} },
      runner,
      getExtension: () => createExtension({ addConfiguration: async () => {} }),
      onFailure: (failure) => { failures.push(failure); },
    });

    service.restoreMode();
    service.setInputs(undefined, true);
    await service.refresh();
    assert.deepStrictEqual(failures, []);

    service.setInputs(undefined);
    await service.refresh();
    assert.deepStrictEqual(failures, [{
      stage: "context",
      message: "Active model and target are unavailable.",
    }]);
  });

  test("keeps the selected mode and prior successful configuration when registration fails", async () => {
    let fail = false;
    const registrations: Array<Readonly<Record<string, unknown>>> = [];
    const modes: string[] = [];
    const service = new RustAnalyzerConfigService({
      workspaceState: { get: <T>() => "all-features" as T, update: async () => {} },
      runner,
      onModeChange: (mode) => { modes.push(mode); },
      getExtension: () => createExtension({
        addConfiguration: async (_id, configuration) => {
          if (fail) {
            throw new Error("registration failed");
          }
          registrations.push(configuration);
        },
      }),
    });

    service.restoreMode();
    await service.refresh();
    fail = true;
    await service.refresh();

    assert.strictEqual(service.mode, "all-features");
    assert.deepStrictEqual(service.lastAppliedConfiguration, { "cargo.features": "all" });
    assert.deepStrictEqual(registrations, [{ "cargo.features": "all" }]);
    assert.deepStrictEqual(modes, ["all-features"]);
  });

  test("retains all explicit authored scopes for submitted managed keys", async () => {
    const service = new RustAnalyzerConfigService({
      workspaceState: { get: <T>() => "all-features" as T, update: async () => {} },
      runner,
      getExtension: () => createExtension({ addConfiguration: async () => {} }),
      inspectSetting: (key: string) => key === "cargo.features"
        ? { globalValue: ["user"], workspaceValue: ["workspace"], workspaceFolderValue: ["folder"] }
        : undefined,
    });

    service.restoreMode();
    await service.refresh();

    assert.deepStrictEqual(service.conflicts, [{
      key: "cargo.features",
      values: [
        { scope: "user", value: ["user"] },
        { scope: "workspace", value: ["workspace"] },
        { scope: "workspace-folder", value: ["folder"] },
      ],
    }]);
  });

  test("clears the managed configuration when disposed", async () => {
    const registrations: Array<Readonly<Record<string, unknown>>> = [];
    const service = new RustAnalyzerConfigService({
      workspaceState: { get: <T>() => "all-features" as T, update: async () => {} },
      runner,
      getExtension: () => createExtension({
        addConfiguration: async (_id, configuration) => { registrations.push(configuration); },
      }),
    });

    service.restoreMode();
    await service.refresh();
    await service.dispose();

    assert.deepStrictEqual(registrations, [{ "cargo.features": "all" }, {}]);
  });
});