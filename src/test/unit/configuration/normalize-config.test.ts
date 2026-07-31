import * as assert from "assert";
import { normalizeActiveConfig, normalizePresetId } from "../../../configuration/normalize-config";
import { ManifestStateLoaded } from "../../../manifest/manifest-types";
import { ActiveConfig } from "../../../configuration/active-config";
import { DEFAULT_PRESET_ID } from "../../../presets/preset-types";
import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides?: Partial<ManifestStateLoaded>): ManifestStateLoaded {
  return {
    status: "loaded",
    manifestUri: vscode.Uri.file("/workspace/tf-tools.yaml"),
    models: [
      { kind: "model", id: "T2T1", name: "Trezor Model T" },
      { kind: "model", id: "T3W1", name: "Trezor Model T3" },
    ],
    targets: [
      { kind: "target", id: "hw", name: "Hardware", shortName: "HW" },
      { kind: "target", id: "emu", name: "Emulator" },
    ],
    components: [
      { kind: "component", id: "core", name: "Core" },
      { kind: "component", id: "prodtest", name: "Prodtest" },
    ],
    buildOptions: [],
    hasWorkflowBlockingIssues: false,
    debugProfiles: [],
    hasDebugBlockingIssues: false,
    validationIssues: [],
    loadedAt: new Date(),
    ...overrides,
  } as ManifestStateLoaded;
}

function makeConfig(overrides?: Partial<ActiveConfig>): ActiveConfig {
  return {
    modelId: "T2T1",
    targetId: "hw",
    componentId: "core",
    persistedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// No saved config — fresh start
// ---------------------------------------------------------------------------

suite("normalizeActiveConfig – no saved config", () => {
  test("returns first model, target, and component when no saved config is provided", () => {
    const result = normalizeActiveConfig(makeManifest());
    assert.strictEqual(result.modelId, "T2T1");
    assert.strictEqual(result.targetId, "hw");
    assert.strictEqual(result.componentId, "core");
  });

  test("handles single-entry collections", () => {
    const manifest = makeManifest({
      models: [{ kind: "model", id: "ONLY", name: "Only Model" }],
      targets: [{ kind: "target", id: "emu", name: "Emulator" }],
      components: [{ kind: "component", id: "core", name: "Core" }],
    });
    const result = normalizeActiveConfig(manifest);
    assert.strictEqual(result.modelId, "ONLY");
    assert.strictEqual(result.targetId, "emu");
    assert.strictEqual(result.componentId, "core");
  });
});

// ---------------------------------------------------------------------------
// Saved config still valid
// ---------------------------------------------------------------------------

suite("normalizeActiveConfig – saved config still valid", () => {
  test("returns saved ids unchanged when all ids are present in the manifest", () => {
    const saved = makeConfig({ modelId: "T3W1", targetId: "emu", componentId: "prodtest" });
    const result = normalizeActiveConfig(makeManifest(), saved);
    assert.strictEqual(result.modelId, "T3W1");
    assert.strictEqual(result.targetId, "emu");
    assert.strictEqual(result.componentId, "prodtest");
  });

  test("preserves all three ids when saved config refers to second entries", () => {
    const saved = makeConfig({ modelId: "T3W1", targetId: "hw", componentId: "prodtest" });
    const result = normalizeActiveConfig(makeManifest(), saved);
    assert.strictEqual(result.modelId, "T3W1");
    assert.strictEqual(result.targetId, "hw");
    assert.strictEqual(result.componentId, "prodtest");
  });
});

// ---------------------------------------------------------------------------
// Saved config partially stale
// ---------------------------------------------------------------------------

suite("normalizeActiveConfig – saved config partially stale", () => {
  test("replaces stale modelId with first model, keeps valid targetId and componentId", () => {
    const saved = makeConfig({ modelId: "DELETED", targetId: "emu", componentId: "prodtest" });
    const result = normalizeActiveConfig(makeManifest(), saved);
    assert.strictEqual(result.modelId, "T2T1");
    assert.strictEqual(result.targetId, "emu");
    assert.strictEqual(result.componentId, "prodtest");
  });

  test("replaces stale targetId with first target, keeps valid modelId and componentId", () => {
    const saved = makeConfig({ modelId: "T3W1", targetId: "DELETED", componentId: "prodtest" });
    const result = normalizeActiveConfig(makeManifest(), saved);
    assert.strictEqual(result.modelId, "T3W1");
    assert.strictEqual(result.targetId, "hw");
    assert.strictEqual(result.componentId, "prodtest");
  });

  test("replaces stale componentId with first component, keeps valid modelId and targetId", () => {
    const saved = makeConfig({ modelId: "T3W1", targetId: "emu", componentId: "DELETED" });
    const result = normalizeActiveConfig(makeManifest(), saved);
    assert.strictEqual(result.modelId, "T3W1");
    assert.strictEqual(result.targetId, "emu");
    assert.strictEqual(result.componentId, "core");
  });
});

// ---------------------------------------------------------------------------
// Saved config fully stale
// ---------------------------------------------------------------------------

suite("normalizeActiveConfig – saved config fully stale", () => {
  test("replaces all three ids with first-entry defaults when all saved ids are stale", () => {
    const saved = makeConfig({ modelId: "OLD_M", targetId: "OLD_T", componentId: "OLD_C" });
    const result = normalizeActiveConfig(makeManifest(), saved);
    assert.strictEqual(result.modelId, "T2T1");
    assert.strictEqual(result.targetId, "hw");
    assert.strictEqual(result.componentId, "core");
  });

  test("normalizeActiveConfig behavior for the manifest axes is unaffected by presetId (unchanged)", () => {
    const saved = makeConfig({ modelId: "T3W1", targetId: "emu", componentId: "prodtest" });
    const result = normalizeActiveConfig(makeManifest(), saved);
    assert.strictEqual(result.modelId, "T3W1");
    assert.strictEqual(result.targetId, "emu");
    assert.strictEqual(result.componentId, "prodtest");
    assert.ok(!("presetId" in result), "normalizeActiveConfig must not touch presetId");
  });
});

// ---------------------------------------------------------------------------
// normalizePresetId (feature 009)
// ---------------------------------------------------------------------------

suite("normalizePresetId", () => {
  test("returns the saved id unchanged when knownPresetIds is undefined (preset state invalid, FR-031)", () => {
    assert.strictEqual(normalizePresetId("test", undefined), "test");
    assert.strictEqual(normalizePresetId(DEFAULT_PRESET_ID, undefined), DEFAULT_PRESET_ID);
  });

  test("keeps a saved id the preset files still declare (FR-008, Scenario 1.6)", () => {
    const knownPresetIds = new Set(["default", "test", "dev"]);
    assert.strictEqual(normalizePresetId("dev", knownPresetIds), "dev");
  });

  test("normalizes a saved id no preset file declares to DEFAULT_PRESET_ID (FR-008, Scenario 1.7)", () => {
    const knownPresetIds = new Set(["default", "test"]);
    assert.strictEqual(normalizePresetId("removed-preset", knownPresetIds), DEFAULT_PRESET_ID);
  });

  test("keeps DEFAULT_PRESET_ID when it is itself the saved id and declared", () => {
    const knownPresetIds = new Set(["default", "test"]);
    assert.strictEqual(normalizePresetId(DEFAULT_PRESET_ID, knownPresetIds), DEFAULT_PRESET_ID);
  });

  test("the declared set does not depend on the build context, so a preset with no matching fragment is kept (FR-006, Scenario 1.4)", () => {
    // `listPresetChoices` derives this set from the two files alone: a preset
    // whose fragments all filter to another model/component/emulator state is
    // still declared, so a context change never normalizes it away.
    const knownPresetIds = new Set(["default", "test", "dev"]);
    assert.strictEqual(normalizePresetId("dev", knownPresetIds), "dev");
  });
});
