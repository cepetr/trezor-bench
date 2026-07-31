/**
 * Integration tests for User Story 1: selecting an available preset.
 * Runs inside the VS Code extension host via @vscode/test-electron.
 *
 * Exercises the real preset-valid/preset-no-defaults fixtures through
 * PresetService + preset-resolution, together with active-config
 * persistence and the Configuration tree.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { PresetService } from "../../presets/preset-service";
import { derivePresetContext, listAvailablePresets, AvailablePreset } from "../../presets/preset-resolution";
import { PresetState } from "../../presets/preset-types";
import {
  ActiveConfig,
  DEFAULT_PRESET_ID,
  activePresetId,
  selectPreset,
  restoreActiveConfig,
  writeActiveConfig,
  readActiveConfig,
} from "../../configuration/active-config";
import { normalizePresetId } from "../../configuration/normalize-config";
import { ManifestStateLoaded } from "../../manifest/manifest-types";
import {
  ConfigurationTreeProvider,
  SectionItem,
  SelectorHeaderItem,
} from "../../ui/configuration-tree";
import { formatStatusBarText } from "../../ui/status-bar";
import { formatTaskLabel } from "../../commands/build-workflow";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFakeContext(): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  return {
    workspaceState: {
      get: <T>(key: string): T | undefined => store.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        store.set(key, value);
      },
      keys: (): readonly string[] => [...store.keys()],
    },
  } as unknown as vscode.ExtensionContext;
}

function fixtureUris(fixtureName: string): { shared: vscode.Uri; user: vscode.Uri } {
  const base = path.resolve(__dirname, "../../../test-fixtures/workspaces", fixtureName, "xtask/tf-tools");
  return {
    shared: vscode.Uri.file(path.join(base, "presets.toml")),
    user: vscode.Uri.file(path.join(base, "user-presets.toml")),
  };
}

function makeManifest(overrides: Partial<ManifestStateLoaded> = {}): ManifestStateLoaded {
  return {
    status: "loaded",
    manifestUri: vscode.Uri.file("/workspace/tf-tools-manifest.yaml"),
    models: [{ kind: "model", id: "T2T1", name: "Trezor Model T" }],
    targets: [
      { kind: "target", id: "hw", name: "Hardware", shortName: "HW", flag: null },
      { kind: "target", id: "emu", name: "Emulator", shortName: "EMU", flag: "--emulator" },
    ],
    components: [
      { kind: "component", id: "firmware", name: "Firmware" },
      { kind: "component", id: "bootloader", name: "Bootloader" },
    ],
    buildOptions: [],
    hasWorkflowBlockingIssues: false,
    hasDebugBlockingIssues: false,
    validationIssues: [],
    loadedAt: new Date(),
    ...overrides,
  } as ManifestStateLoaded;
}

function activeConfig(overrides: Partial<ActiveConfig> = {}): ActiveConfig {
  return {
    modelId: "T2T1",
    targetId: "hw",
    componentId: "firmware",
    persistedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildContextChildren(provider: ConfigurationTreeProvider): SelectorHeaderItem[] {
  const top = provider.getChildren() as vscode.TreeItem[];
  const contextSection = top.find(
    (i) => i instanceof SectionItem && (i as SectionItem).sectionId === "build-context"
  ) as SectionItem;
  assert.ok(contextSection, "build-context section not found");
  return provider.getChildren(contextSection) as SelectorHeaderItem[];
}

// ---------------------------------------------------------------------------
// preset-valid — four-selector order and availability
// ---------------------------------------------------------------------------

suite("Preset selection – preset-valid fixture", () => {
  test("four selectors render in order, and named presets list Default + shared-then-user names", async () => {
    const { shared, user } = fixtureUris("preset-valid");
    const service = new PresetService(shared, user);
    const state = await service.start();
    service.dispose();
    assert.strictEqual(state.status, "loaded");
    if (state.status !== "loaded") {
      return;
    }

    const manifest = makeManifest();
    const config = activeConfig();
    const ctx = derivePresetContext(manifest, config);
    const available = listAvailablePresets(state.shared, state.user, ctx);

    assert.deepStrictEqual(
      available.map((p) => p.id),
      ["default", "test", "dev", "local"]
    );

    const provider = new ConfigurationTreeProvider();
    provider.update(manifest, config, []);
    provider.updatePresets(state, activePresetId(config), available);
    const children = buildContextChildren(provider);
    provider.dispose();

    assert.strictEqual(children.length, 4);
    assert.deepStrictEqual(
      children.map((c) => c.selectorKind),
      ["model", "target", "component", "preset"]
    );
    assert.strictEqual(children[3].description, "Default");
  });
});

// ---------------------------------------------------------------------------
// preset-no-defaults — Default still offered (Scenario 1.2)
// ---------------------------------------------------------------------------

suite("Preset selection – preset-no-defaults fixture", () => {
  test("Default is still offered even with no [[defaults]] fragment", async () => {
    const { shared, user } = fixtureUris("preset-no-defaults");
    const service = new PresetService(shared, user);
    const state = await service.start();
    service.dispose();
    assert.strictEqual(state.status, "loaded");
    if (state.status !== "loaded") {
      return;
    }

    const manifest = makeManifest();
    const config = activeConfig();
    const ctx = derivePresetContext(manifest, config);
    const available = listAvailablePresets(state.shared, state.user, ctx);
    assert.ok(available.some((p) => p.id === "default" && p.isDefault));
  });
});

// ---------------------------------------------------------------------------
// Selection persists into tfTools.activeConfig
// ---------------------------------------------------------------------------

suite("Preset selection – select and persist", () => {
  test("selectPreset persists presetId and the tree description reflects it", async () => {
    const context = createFakeContext();
    const manifest = makeManifest();
    await writeActiveConfig(context, { modelId: "T2T1", targetId: "hw", componentId: "firmware" });

    const updated = await selectPreset(context, "test", manifest);
    assert.strictEqual(updated.presetId, "test");
    assert.strictEqual(readActiveConfig(context)?.presetId, "test");

    const available: AvailablePreset[] = [
      { id: "default", label: "Default", isDefault: true },
      { id: "test", label: "test", isDefault: false },
    ];
    const loadedState: PresetState = {
      status: "loaded",
      shared: {
        source: "shared",
        uri: vscode.Uri.file("/workspace/xtask/tf-tools/presets.toml"),
        present: true,
        names: ["test"],
        fragments: [],
        issues: [],
      },
      user: {
        source: "user",
        uri: vscode.Uri.file("/workspace/xtask/tf-tools/user-presets.toml"),
        present: false,
        names: [],
        fragments: [],
        issues: [],
      },
      loadedAt: new Date(),
      validationIssues: [],
    };

    const provider = new ConfigurationTreeProvider();
    provider.update(manifest, updated, []);
    provider.updatePresets(loadedState, "test", available);
    const children = buildContextChildren(provider);
    provider.dispose();

    assert.strictEqual(children[3].description, "test");
  });
});

// ---------------------------------------------------------------------------
// Legacy record migration (data-model §3, §7)
// ---------------------------------------------------------------------------

suite("Preset selection – legacy record migration", () => {
  test("a legacy activeConfig record without presetId restores as default and is not rewritten merely for that", async () => {
    const context = createFakeContext();
    const manifest = makeManifest();
    await writeActiveConfig(context, { modelId: "T2T1", targetId: "hw", componentId: "firmware" });
    const legacy = readActiveConfig(context);
    assert.strictEqual(legacy?.presetId, undefined);

    const availableIds = new Set(["default", "test"]);
    const restored = await restoreActiveConfig(context, manifest, availableIds);

    assert.strictEqual(activePresetId(restored), DEFAULT_PRESET_ID);
    assert.strictEqual(
      restored.persistedAt,
      legacy!.persistedAt,
      "restoring must not rewrite the record merely to migrate a legacy presetId"
    );
  });
});

// ---------------------------------------------------------------------------
// Normalization when the active build context changes (Scenario 1.4)
// ---------------------------------------------------------------------------

suite("Preset selection – normalization on build-context change", () => {
  test("changing Component to one no fragment matches normalizes the active preset to default", async () => {
    const { shared, user } = fixtureUris("preset-valid");
    const service = new PresetService(shared, user);
    const state = await service.start();
    service.dispose();
    assert.strictEqual(state.status, "loaded");
    if (state.status !== "loaded") {
      return;
    }

    const manifest = makeManifest();

    const firmwareCtx = derivePresetContext(manifest, activeConfig({ componentId: "firmware" }));
    const firmwareAvailable = listAvailablePresets(state.shared, state.user, firmwareCtx);
    assert.ok(firmwareAvailable.some((p) => p.id === "dev"), "dev should be available for firmware");

    const bootloaderCtx = derivePresetContext(manifest, activeConfig({ componentId: "bootloader" }));
    const bootloaderAvailable = listAvailablePresets(state.shared, state.user, bootloaderCtx);
    const bootloaderIds = new Set(bootloaderAvailable.map((p) => p.id));
    assert.ok(!bootloaderIds.has("dev"), "dev must not be available for bootloader");

    assert.strictEqual(normalizePresetId("dev", bootloaderIds), DEFAULT_PRESET_ID);
  });
});

// ---------------------------------------------------------------------------
// Invalidity preserves the saved id unresolved; recovery restores or normalizes (FR-031, Scenario 1.6)
// ---------------------------------------------------------------------------

suite("Preset selection – invalidity preserves and later resolves the saved id", () => {
  test("saved preset id survives invalidity unresolved, then restores if available, else normalizes to default", async () => {
    const context = createFakeContext();
    const manifest = makeManifest();
    await selectPreset(context, "test", manifest);

    // Preset state invalid: availablePresetIds is undefined -> preserved unresolved.
    const whileInvalid = await restoreActiveConfig(context, manifest, undefined);
    assert.strictEqual(activePresetId(whileInvalid), "test");

    // Valid again, "test" still available -> restored.
    const whenAvailable = await restoreActiveConfig(context, manifest, new Set(["default", "test"]));
    assert.strictEqual(activePresetId(whenAvailable), "test");

    // Valid again, "test" no longer available -> normalized to default.
    const whenUnavailable = await restoreActiveConfig(context, manifest, new Set(["default"]));
    assert.strictEqual(activePresetId(whenUnavailable), DEFAULT_PRESET_ID);
  });
});

// ---------------------------------------------------------------------------
// The active preset never appears in build-context display surfaces (FR-024, Scenario 1.5)
// ---------------------------------------------------------------------------

suite("Preset selection – excluded from display surfaces", () => {
  test("status bar text and task labels never include the preset name", () => {
    const manifest = makeManifest();
    const config = activeConfig({ presetId: "test" });

    const statusText = formatStatusBarText(manifest, config);
    assert.ok(statusText, "expected status bar text to resolve");
    assert.ok(!statusText!.includes("test"));

    const wfCtx = {
      modelId: config.modelId,
      modelName: "Trezor Model T",
      targetId: config.targetId,
      targetDisplay: "HW",
      componentId: config.componentId,
      componentName: "Firmware",
      targetFlag: null,
    };
    const buildLabel = formatTaskLabel("Build", wfCtx);
    assert.ok(!buildLabel.includes("test"));
  });
});
