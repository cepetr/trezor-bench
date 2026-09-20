import * as assert from "assert";
import * as vscode from "vscode";
import { RustAnalyzerConfigService } from "../../rust-analyzer/config-service";
import { RustAnalyzerExtension } from "../../rust-analyzer/config-types";
import { refreshRustAnalyzerConfiguration } from "../../rust-analyzer/config-wiring";

interface CommandContribution {
  readonly command: string;
  readonly title: string;
  readonly category?: string;
}

interface MenuContribution {
  readonly command: string;
  readonly when?: string;
  readonly group?: string;
  readonly toggled?: string;
}

function contribution(): Record<string, unknown> {
  const extension = vscode.extensions.getExtension("cepetr.tbench");
  assert.ok(extension, "cepetr.tbench extension must be present");
  return extension.packageJSON.contributes as Record<string, unknown>;
}

suite("Rust Analyzer mode contributions", () => {
  test("contributes both mode commands in the Configuration view overflow without C/C++ conditions", () => {
    const commands = contribution().commands as CommandContribution[];
    const menus = contribution().menus as Record<string, MenuContribution[]>;
    const modeCommands = commands.filter((entry) => entry.command.startsWith("tbench.rustAnalyzer."));
    const menuEntries = (menus["view/title"] ?? []).filter((entry) => entry.command.startsWith("tbench.rustAnalyzer."));

    assert.deepStrictEqual(modeCommands, [
      { command: "tbench.rustAnalyzer.modelSpecific", title: "Rust Analyzer: Model Specific", category: "Trezor Bench" },
      { command: "tbench.rustAnalyzer.allFeatures", title: "Rust Analyzer: All Features", category: "Trezor Bench" },
    ]);
    assert.strictEqual(menuEntries.length, 2);
    for (const entry of menuEntries) {
      assert.ok(entry.when?.includes("view == tbench.configuration"));
      assert.ok(!entry.when?.includes("intelliSense"));
      assert.ok(!entry.when?.includes("cpptools"));
      assert.strictEqual(entry.group, "rust-analyzer@1");
    }
  });

  test("uses independent exclusive context keys so workspace restore remains visible after refresh failure", () => {
    const menus = contribution().menus as Record<string, MenuContribution[]>;
    const menuEntries = (menus["view/title"] ?? []).filter((entry) => entry.command.startsWith("tbench.rustAnalyzer."));

    assert.deepStrictEqual(menuEntries.map((entry) => entry.toggled), [
      "tbench.rustAnalyzerModelSpecific",
      "tbench.rustAnalyzerAllFeatures",
    ]);
  });
});

suite("Rust Analyzer configuration replacement", () => {
  test("schedules refreshes for model, target, preset, and effective build-option changes", () => {
    const snapshots: unknown[] = [];
    let refreshes = 0;
    const service = {
      setInputs: (inputs: unknown) => {
        snapshots.push(inputs);
        return true;
      },
      refresh: async () => { refreshes += 1; },
    };
    const manifest = {
      status: "loaded",
      models: [],
      targets: [
        { kind: "target", id: "hardware", name: "Hardware" },
        { kind: "target", id: "emulator", name: "Emulator", flag: "--emulator" },
      ],
      components: [],
      buildOptions: [],
    } as never;
    const selection = (modelId: string, targetId: string, presetId: string) => ({
      modelId,
      targetId,
      componentId: "core",
      presetId,
      persistedAt: "2026-09-20T00:00:00.000Z",
    });

    refreshRustAnalyzerConfiguration(service as never, manifest, selection("T2T1", "hardware", "default"), []);
    refreshRustAnalyzerConfiguration(service as never, manifest, selection("T3T1", "hardware", "default"), []);
    refreshRustAnalyzerConfiguration(service as never, manifest, selection("T3T1", "emulator", "release"), []);
    refreshRustAnalyzerConfiguration(service as never, manifest, selection("T3T1", "emulator", "release"), [{
      option: { key: "usb", label: "USB", flag: "--usb", kind: "checkbox" },
      available: true,
      value: true,
      presetState: "resolved",
      isOverride: false,
    }]);

    assert.strictEqual(snapshots.length, 4);
    assert.strictEqual(refreshes, 4);
  });

  test("submits the complete managed object despite an authored setting conflict", async () => {
    const registrations: Array<Readonly<Record<string, unknown>>> = [];
    const extension: RustAnalyzerExtension = {
      isActive: true,
      exports: { addConfiguration: async (_id: string, configuration: Readonly<Record<string, unknown>>) => { registrations.push(configuration); } },
      activate: async () => extension.exports,
    };
    const service = new RustAnalyzerConfigService({
      workspaceState: { get: <T>() => "all-features" as T, update: async () => {} },
      runner: { run: () => { throw new Error("all-features mode must not invoke the generator"); } },
      getExtension: () => extension,
      inspectSetting: () => ({ workspaceValue: ["authored"] }),
    });

    service.restoreMode();
    await service.refresh();

    assert.deepStrictEqual(registrations, [{ "cargo.features": "all" }]);
    assert.deepStrictEqual(service.conflicts[0]?.values, [{ scope: "workspace", value: ["authored"] }]);
  });

  test("replaces hardware-only keys when the target changes to emulator", async () => {
    const registrations: Array<Readonly<Record<string, unknown>>> = [];
    const outputs = [
      "[cargo]\nfeatures = [\"hardware\"]\ntarget = \"thumb\"\n[check]\nextraArgs = [\"--target\", \"thumb\"]\n",
      "[cargo]\nfeatures = [\"emulator\"]\n",
    ];
    const extension: RustAnalyzerExtension = {
      isActive: true,
      exports: { addConfiguration: async (_id: string, configuration: Readonly<Record<string, unknown>>) => { registrations.push(configuration); } },
      activate: async () => extension.exports,
    };
    const service = new RustAnalyzerConfigService({
      workspaceState: { get: <T>() => "model-specific" as T, update: async () => {} },
      runner: {
        run: () => ({
          result: Promise.resolve({ stdout: outputs.shift() ?? "", stderr: "", exitCode: 0, cancelled: false }),
          cancel: () => {},
        }),
      },
      getExtension: () => extension,
    });

    service.restoreMode();
    service.setInputs({ modelId: "T2T1", targetId: "hw", emulator: false, presetId: "default", effectiveFlags: [] });
    await service.refresh();
    service.setInputs({ modelId: "T2T1", targetId: "emu", emulator: true, targetFlag: "--emulator", presetId: "default", effectiveFlags: [] });
    await service.refresh();

    assert.deepStrictEqual(registrations, [
      { "cargo.features": ["hardware"], "cargo.target": "thumb", "check.extraArgs": ["--target", "thumb"] },
      { "cargo.features": ["emulator"] },
    ]);
  });
});