/**
 * Unit tests for PresetContext derivation and AvailablePreset listing.
 *
 * Pure functions over PresetState (shared/user PresetFile) plus the active
 * build context. specs/009-build-preset-support/data-model.md §2.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import { derivePresetContext, samePresetContext, listAvailablePresets } from "../../../presets/preset-resolution";
import { PresetFile, PresetFragment } from "../../../presets/preset-types";
import { ManifestStateLoaded } from "../../../manifest/manifest-types";
import { ActiveConfig } from "../../../configuration/active-config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function manifest(targets: ManifestStateLoaded["targets"]): ManifestStateLoaded {
  return {
    status: "loaded",
    manifestUri: vscode.Uri.file("/workspace/tf-tools-manifest.yaml"),
    models: [{ kind: "model", id: "T2T1", name: "Trezor Model T" }],
    targets,
    components: [{ kind: "component", id: "firmware", name: "Firmware" }],
    buildOptions: [],
    hasWorkflowBlockingIssues: false,
    hasDebugBlockingIssues: false,
    validationIssues: [],
    loadedAt: new Date(),
  };
}

function config(overrides?: Partial<ActiveConfig>): ActiveConfig {
  return {
    modelId: "T2T1",
    targetId: "hw",
    componentId: "firmware",
    persistedAt: new Date().toISOString(),
    ...overrides,
  };
}

function fragment(overrides: Partial<PresetFragment> & Pick<PresetFragment, "name" | "source">): PresetFragment {
  return {
    order: 0,
    filter: {},
    values: {},
    ...overrides,
  };
}

function presetFile(overrides: Partial<PresetFile> & Pick<PresetFile, "source">): PresetFile {
  return {
    uri: vscode.Uri.file(`/workspace/xtask/tf-tools/${overrides.source === "user" ? "user-presets.toml" : "presets.toml"}`),
    present: true,
    names: [],
    fragments: [],
    issues: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PresetContext derivation (research Decision 3)
// ---------------------------------------------------------------------------

suite("derivePresetContext", () => {
  test("emulator is true for a target whose flag is --emulator", () => {
    const m = manifest([{ kind: "target", id: "emu", name: "Emulator", flag: "--emulator" }]);
    const ctx = derivePresetContext(m, config({ targetId: "emu" }));
    assert.strictEqual(ctx.emulator, true);
    assert.strictEqual(ctx.modelId, "T2T1");
    assert.strictEqual(ctx.projectId, "firmware");
  });

  test("emulator is true for a target whose flag is -e", () => {
    const m = manifest([{ kind: "target", id: "emu", name: "Emulator", flag: "-e" }]);
    const ctx = derivePresetContext(m, config({ targetId: "emu" }));
    assert.strictEqual(ctx.emulator, true);
  });

  test("emulator is false for a hardware target with no emulator flag", () => {
    const m = manifest([{ kind: "target", id: "hw", name: "Hardware", flag: null }]);
    const ctx = derivePresetContext(m, config({ targetId: "hw" }));
    assert.strictEqual(ctx.emulator, false);
  });

  test("derives emulator correctly when the manifest renames target ids", () => {
    const m = manifest([
      { kind: "target", id: "renamed-emulator-target", name: "Emu", flag: "--emulator" },
      { kind: "target", id: "renamed-hw-target", name: "HW", flag: null },
    ]);
    const emuCtx = derivePresetContext(m, config({ targetId: "renamed-emulator-target" }));
    const hwCtx = derivePresetContext(m, config({ targetId: "renamed-hw-target" }));
    assert.strictEqual(emuCtx.emulator, true);
    assert.strictEqual(hwCtx.emulator, false);
  });

  test("projectId comes from the active component id", () => {
    const m = manifest([{ kind: "target", id: "hw", name: "Hardware", flag: null }]);
    const ctx = derivePresetContext(m, config({ componentId: "firmware" }));
    assert.strictEqual(ctx.projectId, "firmware");
  });
});

// ---------------------------------------------------------------------------
// PresetContext comparison — the override-discard predicate (FR-017)
// ---------------------------------------------------------------------------

suite("samePresetContext", () => {
  const base = { modelId: "T2T1", projectId: "firmware", emulator: false };

  test("two contexts with the same three fields are the same context", () => {
    assert.strictEqual(samePresetContext(base, { ...base }), true);
  });

  test("a different model is a different context", () => {
    assert.strictEqual(samePresetContext(base, { ...base, modelId: "T3W1" }), false);
  });

  test("a different project is a different context", () => {
    assert.strictEqual(samePresetContext(base, { ...base, projectId: "bootloader" }), false);
  });

  test("a different emulator flag is a different context", () => {
    assert.strictEqual(samePresetContext(base, { ...base, emulator: true }), false);
  });

  test("switching between two hardware targets is not a preset-context change", () => {
    // Only `emulator` reaches a `when` filter, so a target id change that does
    // not cross the emulator boundary must not retire build-option overrides.
    const m = manifest([
      { kind: "target", id: "hw", name: "Hardware", flag: null },
      { kind: "target", id: "hw-alt", name: "Hardware (alt)", flag: "--alt" },
    ]);
    const before = derivePresetContext(m, config({ targetId: "hw" }));
    const after = derivePresetContext(m, config({ targetId: "hw-alt" }));
    assert.strictEqual(samePresetContext(before, after), true);
  });

  test("switching from a hardware target to the emulator is a preset-context change", () => {
    const m = manifest([
      { kind: "target", id: "hw", name: "Hardware", flag: null },
      { kind: "target", id: "emu", name: "Emulator", flag: "--emulator" },
    ]);
    const before = derivePresetContext(m, config({ targetId: "hw" }));
    const after = derivePresetContext(m, config({ targetId: "emu" }));
    assert.strictEqual(samePresetContext(before, after), false);
  });
});

// ---------------------------------------------------------------------------
// AvailablePreset listing
// ---------------------------------------------------------------------------

suite("listAvailablePresets", () => {
  const ctx = { modelId: "T2T1", projectId: "firmware", emulator: false };

  test("Default is always first and always present, even with no [[defaults]] fragment", () => {
    const shared = presetFile({ source: "shared" });
    const user = presetFile({ source: "user" });
    const result = listAvailablePresets(shared, user, ctx);
    assert.strictEqual(result[0].id, "default");
    assert.strictEqual(result[0].label, "Default");
    assert.strictEqual(result[0].isDefault, true);
  });

  test("each named preset is listed once at its first declaration, shared then user", () => {
    const shared = presetFile({
      source: "shared",
      names: ["test"],
      fragments: [fragment({ name: "test", source: "shared" })],
    });
    const user = presetFile({
      source: "user",
      names: ["test", "local"],
      fragments: [
        fragment({ name: "test", source: "user" }),
        fragment({ name: "local", source: "user" }),
      ],
    });
    const result = listAvailablePresets(shared, user, ctx);
    assert.deepStrictEqual(
      result.map((p) => p.id),
      ["default", "test", "local"]
    );
  });

  test("a named preset is listed only when at least one fragment matches the context", () => {
    const shared = presetFile({
      source: "shared",
      names: ["dev"],
      fragments: [
        fragment({ name: "dev", source: "shared", filter: { projects: ["bootloader"] } }),
      ],
    });
    const user = presetFile({ source: "user" });
    const result = listAvailablePresets(shared, user, ctx);
    assert.ok(!result.some((p) => p.id === "dev"), "dev should not be listed: no fragment matches firmware");
  });

  test("a named preset is listed when a matching fragment exists in either file", () => {
    const shared = presetFile({
      source: "shared",
      names: ["dev"],
      fragments: [
        fragment({ name: "dev", source: "shared", filter: { projects: ["bootloader"] } }),
      ],
    });
    const user = presetFile({
      source: "user",
      names: ["dev"],
      fragments: [
        fragment({ name: "dev", source: "user", filter: { projects: ["firmware"] } }),
      ],
    });
    const result = listAvailablePresets(shared, user, ctx);
    assert.ok(result.some((p) => p.id === "dev"), "dev should be listed: the user fragment matches");
  });

  test("defaults is never listed as a named preset", () => {
    const shared = presetFile({
      source: "shared",
      names: [],
      fragments: [fragment({ name: "defaults", source: "shared" })],
    });
    const user = presetFile({ source: "user" });
    const result = listAvailablePresets(shared, user, ctx);
    assert.ok(!result.some((p) => p.id === "defaults"));
  });

  test("a literal [[default]] group is never listed (research Decision 7)", () => {
    const shared = presetFile({
      source: "shared",
      names: [], // parsePresetFile already excludes "default" from names
      fragments: [fragment({ name: "default", source: "shared" })],
    });
    const user = presetFile({ source: "user" });
    const result = listAvailablePresets(shared, user, ctx);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, "default");
  });
});
