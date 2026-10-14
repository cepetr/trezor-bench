import * as assert from "assert";
import {
  deriveRustAnalyzerInputs,
  refreshRustAnalyzerConfiguration,
  startRustAnalyzerConfiguration,
} from "../../rust-analyzer/config-wiring";

suite("Rust Analyzer refresh inputs", () => {
  test("restores the persisted mode before scheduling the initial refresh", () => {
    const calls: string[] = [];
    const service = {
      restoreMode: () => { calls.push("restore"); },
      refresh: async () => { calls.push("refresh"); },
    };

    startRustAnalyzerConfiguration(service as never);

    assert.deepStrictEqual(calls, ["restore", "refresh"]);
  });

  test("does not refresh when the derived inputs are unchanged", () => {
    let refreshes = 0;
    const service = {
      setInputs: () => false,
      refresh: async () => { refreshes += 1; },
    };

    refreshRustAnalyzerConfiguration(
      service as never,
      {
        status: "loaded",
        models: [],
        targets: [{ kind: "target", id: "hw", name: "Hardware" }],
        components: [],
        buildOptions: [],
      } as never,
      { modelId: "T2T1", targetId: "hw", componentId: "core", presetId: "default", persistedAt: "2026-09-20T00:00:00.000Z" },
      []
    );

    assert.strictEqual(refreshes, 0);
  });

  test("derives emulator identity and omits the default preset argument", () => {
    const inputs = deriveRustAnalyzerInputs(
      {
        status: "loaded",
        models: [],
        targets: [{ kind: "target", id: "emu", name: "Emulator", flag: "--emulator" }],
        components: [],
        buildOptions: [],
      } as never,
      { modelId: "T2T1", targetId: "emu", componentId: "core", presetId: "default", persistedAt: "2026-09-20T00:00:00.000Z" },
      []
    );

    assert.deepStrictEqual(inputs, {
      modelId: "T2T1",
      targetId: "emu",
      emulator: true,
      targetFlag: "--emulator",
      presetId: "default",
      effectiveFlags: [],
    });
  });
});