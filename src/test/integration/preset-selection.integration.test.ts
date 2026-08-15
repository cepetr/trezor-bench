/**
 * Integration tests for User Story 1: selecting a preset.
 * Runs inside the VS Code extension host via @vscode/test-electron.
 *
 * Exercises the real preset-valid/preset-no-defaults fixtures through
 * PresetService + preset-resolution, together with build-selection
 * persistence and the Configuration tree.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { PresetService } from "../../presets/preset-service";
import {
  derivePresetContext,
  listPresetChoices,
  computePresetEffectiveValues,
  PresetChoice,
} from "../../presets/preset-resolution";
import { PresetState } from "../../presets/preset-types";
import { BuildOption } from "../../manifest/manifest-types";
import {
  BuildSelection,
  DEFAULT_PRESET_ID,
  activePresetId,
  selectPreset,
  restoreBuildSelection,
  writeBuildSelection,
  readBuildSelection,
} from "../../build/build-selection";
import { normalizePresetId } from "../../build/normalize-selection";
import { ManifestStateLoaded } from "../../manifest/manifest-types";
import {
  ConfigurationTreeModel,
  SelectorHeaderItem,
} from "../../ui/configuration-tree";
import { formatStatusBarText } from "../../ui/status-bar";
import { deriveWorkflowArguments, formatTaskLabel } from "../../commands/build-workflow";

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
    manifestUri: vscode.Uri.file("/workspace/tbench-manifest.yaml"),
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

function buildSelection(overrides: Partial<BuildSelection> = {}): BuildSelection {
  return {
    modelId: "T2T1",
    targetId: "hw",
    componentId: "firmware",
    persistedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildContextChildren(treeModel: ConfigurationTreeModel): SelectorHeaderItem[] {
  return treeModel.paneRootChildren("build-selection") as SelectorHeaderItem[];
}

// ---------------------------------------------------------------------------
// preset-valid — four-selector order and the declared preset list
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
    const config = buildSelection();
    const available = listPresetChoices(state.shared, state.user);

    assert.deepStrictEqual(
      available.map((p) => p.id),
      ["default", "test", "dev", "local"]
    );

    const treeModel = new ConfigurationTreeModel();
    treeModel.update(manifest, config, []);
    treeModel.updatePresets(state, activePresetId(config), available);
    const children = buildContextChildren(treeModel);
    treeModel.dispose();

    assert.strictEqual(children.length, 4);
    assert.deepStrictEqual(
      children.map((c) => c.selectorKind),
      ["model", "target", "component", "preset"]
    );
    assert.strictEqual(children[3].description, "Default");
  });
});

// ---------------------------------------------------------------------------
// preset-no-defaults — Default still offered
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

    const available = listPresetChoices(state.shared, state.user);
    assert.ok(available.some((p) => p.id === "default" && p.isDefault));
  });
});

// ---------------------------------------------------------------------------
// Selection persists into tbench.buildSelection
// ---------------------------------------------------------------------------

suite("Preset selection – select and persist", () => {
  test("selectPreset persists presetId and the tree description reflects it", async () => {
    const context = createFakeContext();
    const manifest = makeManifest();
    await writeBuildSelection(context, { modelId: "T2T1", targetId: "hw", componentId: "firmware" });

    const updated = await selectPreset(context, "test", manifest);
    assert.strictEqual(updated.presetId, "test");
    assert.strictEqual(readBuildSelection(context)?.presetId, "test");

    const available: PresetChoice[] = [
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

    const treeModel = new ConfigurationTreeModel();
    treeModel.update(manifest, updated, []);
    treeModel.updatePresets(loadedState, "test", available);
    const children = buildContextChildren(treeModel);
    treeModel.dispose();

    assert.strictEqual(children[3].description, "test");
  });
});

// ---------------------------------------------------------------------------
// Legacy record migration
// ---------------------------------------------------------------------------

suite("Preset selection – legacy record migration", () => {
  test("a legacy activeConfig record without presetId restores as default and is not rewritten merely for that", async () => {
    const context = createFakeContext();
    const manifest = makeManifest();
    await writeBuildSelection(context, { modelId: "T2T1", targetId: "hw", componentId: "firmware" });
    const legacy = readBuildSelection(context);
    assert.strictEqual(legacy?.presetId, undefined);

    const availableIds = new Set(["default", "test"]);
    const restored = await restoreBuildSelection(context, manifest, availableIds);

    assert.strictEqual(activePresetId(restored), DEFAULT_PRESET_ID);
    assert.strictEqual(
      restored.persistedAt,
      legacy!.persistedAt,
      "restoring must not rewrite the record merely to migrate a legacy presetId"
    );
  });
});

// ---------------------------------------------------------------------------
// The listed presets and the active preset survive a build-context change
//
// ---------------------------------------------------------------------------

/**
 * The one option `[[dev]]` moves, enough to show what a non-matching preset
 * calculates. Mirrors `test-fixtures/workspaces/preset-valid/tbench-manifest.yaml`.
 */
const PYOPT_OPTION: BuildOption = {
  key: "pyopt",
  id: "pyopt",
  label: "Python Optimization",
  flag: "--pyopt",
  kind: "checkbox",
};

suite("Preset selection – build-context change keeps every preset", () => {
  test("the same choices are listed for firmware and bootloader, and a non-matching preset stays selected", async () => {
    const { shared, user } = fixtureUris("preset-valid");
    const service = new PresetService(shared, user);
    const state = await service.start();
    service.dispose();
    assert.strictEqual(state.status, "loaded");
    if (state.status !== "loaded") {
      return;
    }

    const manifest = makeManifest();

    // `[[dev]]` filters to `project = ["firmware"]`, so bootloader is the
    // context where no fragment of it applies.
    const available = listPresetChoices(state.shared, state.user);
    assert.deepStrictEqual(
      available.map((p) => p.id),
      ["default", "test", "dev", "local"],
      "the list is a function of the two files, not of the build context"
    );

    // Nothing normalizes it away: the id is still declared.
    const knownIds = new Set(available.map((p) => p.id));
    assert.strictEqual(normalizePresetId("dev", knownIds), "dev");

    // Under firmware, `[[dev]]` applies and turns pyopt off against the
    // `[[defaults]]` layer's `true`.
    const firmwareCtx = derivePresetContext(manifest, buildSelection({ componentId: "firmware" }));
    const firmwareValues = computePresetEffectiveValues(
      [PYOPT_OPTION],
      state.shared,
      state.user,
      "dev",
      firmwareCtx
    );
    assert.strictEqual(firmwareValues.get("pyopt")?.value, false);

    // Under bootloader it applies to nothing, so the `[[defaults]]` layer
    // alone calculates the option — exactly what `Default` would produce.
    const bootloaderCtx = derivePresetContext(manifest, buildSelection({ componentId: "bootloader" }));
    const bootloaderValues = computePresetEffectiveValues(
      [PYOPT_OPTION],
      state.shared,
      state.user,
      "dev",
      bootloaderCtx
    );
    const defaultValues = computePresetEffectiveValues(
      [PYOPT_OPTION],
      state.shared,
      state.user,
      DEFAULT_PRESET_ID,
      bootloaderCtx
    );
    assert.strictEqual(bootloaderValues.get("pyopt")?.value, true);
    assert.strictEqual(defaultValues.get("pyopt")?.value, true);
  });

  test("a preset no fragment of which applies is still passed to the launched command", () => {
    const args = deriveWorkflowArguments(
      "Build",
      { modelId: "T2T1", targetId: "hw", componentId: "bootloader", targetFlag: null },
      [],
      "dev"
    );
    assert.deepStrictEqual(args, ["bootloader", "-m", "T2T1", "-p", "dev"]);
  });
});

// ---------------------------------------------------------------------------
// Invalidity preserves the saved id unresolved; recovery restores or normalizes
// ---------------------------------------------------------------------------

suite("Preset selection – invalidity preserves and later resolves the saved id", () => {
  test("saved preset id survives invalidity unresolved, then restores if still declared, else normalizes to default", async () => {
    const context = createFakeContext();
    const manifest = makeManifest();
    await selectPreset(context, "test", manifest);

    // Preset state invalid: knownPresetIds is undefined -> preserved unresolved.
    const whileInvalid = await restoreBuildSelection(context, manifest, undefined);
    assert.strictEqual(activePresetId(whileInvalid), "test");

    // Valid again, the files still declare "test" -> restored.
    const whenAvailable = await restoreBuildSelection(context, manifest, new Set(["default", "test"]));
    assert.strictEqual(activePresetId(whenAvailable), "test");

    // Valid again, no file declares "test" any more -> normalized to default.
    const whenUnavailable = await restoreBuildSelection(context, manifest, new Set(["default"]));
    assert.strictEqual(activePresetId(whenUnavailable), DEFAULT_PRESET_ID);
  });
});

// ---------------------------------------------------------------------------
// The active preset never appears in build-context display surfaces
// ---------------------------------------------------------------------------

suite("Preset selection – excluded from display surfaces", () => {
  test("status bar text and task labels never include the preset name", () => {
    const manifest = makeManifest();
    const config = buildSelection({ presetId: "test" });

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
