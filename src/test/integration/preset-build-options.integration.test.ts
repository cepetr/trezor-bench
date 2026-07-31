/**
 * Integration tests for User Story 2: preset-relative Build Options.
 * Runs inside the VS Code extension host via @vscode/test-electron.
 *
 * Exercises the real preset-valid/preset-value-mismatch fixtures through
 * PresetService + preset-resolution + build-options + the Configuration tree.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { PresetService } from "../../presets/preset-service";
import {
  derivePresetContext,
  samePresetContext,
  computePresetEffectiveValues,
} from "../../presets/preset-resolution";
import {
  normalizeBuildOptions,
  readBuildOptions,
  writeBuildOption,
  discardBuildOptionOverrides,
  ResolvedOption,
} from "../../configuration/build-options";
import { BuildOption } from "../../manifest/manifest-types";
import {
  ConfigurationTreeProvider,
  SectionItem,
  BuildOptionCheckboxItem,
  BuildOptionMultistateHeaderItem,
} from "../../ui/configuration-tree";
import { ActiveConfig } from "../../configuration/active-config";
import { ManifestStateLoaded } from "../../manifest/manifest-types";

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

// Mirrors test-fixtures/workspaces/preset-valid/tf-tools-manifest.yaml.
const BUILD_OPTIONS: BuildOption[] = [
  { key: "frozen", id: "frozen", label: "Frozen", flag: "--frozen", kind: "checkbox" },
  { key: "btc_only", id: "btc-only", label: "BTC Only", flag: "--btc-only", kind: "checkbox" },
  {
    key: "dbg_console",
    id: "dbg-console",
    label: "Debug Console",
    flag: "--dbg-console",
    kind: "multistate",
    states: [
      { id: "null", label: "Default", flag: "" },
      { id: "swo", label: "SWO", flag: "--dbg-console=swo" },
      { id: "vcp", label: "VCP", flag: "--dbg-console=vcp" },
    ],
  },
  {
    key: "pyopt",
    id: "pyopt",
    label: "Python Optimization",
    flag: "--pyopt",
    kind: "multistate",
    states: [
      { id: "null", label: "Default", flag: "" },
      { id: "true", label: "Enabled", flag: "--pyopt=true" },
      { id: "false", label: "Disabled", flag: "--pyopt=false" },
    ],
  },
];

function manifest(): ManifestStateLoaded {
  return {
    status: "loaded",
    manifestUri: vscode.Uri.file("/workspace/tf-tools-manifest.yaml"),
    models: [
      { kind: "model", id: "T2T1", name: "Trezor Model T" },
      { kind: "model", id: "T3W1", name: "Trezor Model T3" },
    ],
    targets: [
      { kind: "target", id: "hw", name: "Hardware", shortName: "HW", flag: null },
      { kind: "target", id: "emu", name: "Emulator", shortName: "EMU", flag: "--emulator" },
    ],
    components: [
      { kind: "component", id: "firmware", name: "Firmware" },
      { kind: "component", id: "bootloader", name: "Bootloader" },
    ],
    buildOptions: BUILD_OPTIONS,
    hasWorkflowBlockingIssues: false,
    hasDebugBlockingIssues: false,
    validationIssues: [],
    loadedAt: new Date(),
  };
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

async function resolveFor(
  fixtureName: string,
  activePresetId: string,
  context: vscode.ExtensionContext,
  config: ActiveConfig = activeConfig()
): Promise<ResolvedOption[]> {
  const { shared, user } = fixtureUris(fixtureName);
  const service = new PresetService(shared, user);
  const state = await service.start();
  service.dispose();
  assert.strictEqual(state.status, "loaded");
  if (state.status !== "loaded") {
    return [];
  }
  const presetCtx = derivePresetContext(manifest(), config);
  const effective = computePresetEffectiveValues(BUILD_OPTIONS, state.shared, state.user, activePresetId, presetCtx);
  // normalizeBuildOptions's BuildContext shape (modelId/targetId/componentId) —
  // distinct from PresetContext (modelId/projectId/emulator).
  const buildCtx = {
    modelId: config.modelId,
    targetId: config.targetId,
    componentId: config.componentId,
  };
  return normalizeBuildOptions(BUILD_OPTIONS, readBuildOptions(context), buildCtx, effective);
}

function findResolved(resolved: ResolvedOption[], key: string): ResolvedOption {
  const found = resolved.find((r) => r.option.key === key);
  assert.ok(found, `expected a resolved option for ${key}`);
  return found!;
}

// ---------------------------------------------------------------------------
// Default preset — values come from matching [[defaults]] fragments
// ---------------------------------------------------------------------------

suite("Preset-relative Build Options – Default (preset-valid fixture)", () => {
  test("displayed values under Default come from matching [[defaults]] fragments with nothing emphasized", async () => {
    const context = createFakeContext();
    const resolved = await resolveFor("preset-valid", "default", context);

    assert.strictEqual(findResolved(resolved, "frozen").value, true);
    assert.strictEqual(findResolved(resolved, "pyopt").value, "true");
    assert.strictEqual(findResolved(resolved, "dbg_console").value, "null");
    assert.strictEqual(findResolved(resolved, "btc_only").value, false);

    for (const r of resolved) {
      assert.strictEqual(r.isOverride, false, `${r.option.key} should not be emphasized under Default`);
    }
  });
});

// ---------------------------------------------------------------------------
// Switching presets changes displayed values without writing a selection
// ---------------------------------------------------------------------------

suite("Preset-relative Build Options – switching presets (Scenario 2.2)", () => {
  test("switching to dev changes dbg-console and pyopt with no stored selection written", async () => {
    const context = createFakeContext();
    const beforeSwitch = readBuildOptions(context);
    assert.strictEqual(beforeSwitch, undefined);

    const resolved = await resolveFor("preset-valid", "dev", context);
    assert.strictEqual(findResolved(resolved, "dbg_console").value, "swo");
    assert.strictEqual(findResolved(resolved, "pyopt").value, "false");
    assert.strictEqual(findResolved(resolved, "frozen").value, true);

    assert.strictEqual(readBuildOptions(context), undefined, "no stored selection should be written by resolution alone");
  });
});

// ---------------------------------------------------------------------------
// Overriding emphasizes the row; matching the preset again clears it (Scenario 2.4, 2.6)
// ---------------------------------------------------------------------------

suite("Preset-relative Build Options – override emphasis round-trip", () => {
  test("an override is emphasized under the preset it was authored against, and clears once it matches", async () => {
    const context = createFakeContext();

    // Default's effective frozen is true; override it to false.
    await writeBuildOption(context, "frozen", false);
    const underDefault = await resolveFor("preset-valid", "default", context);
    assert.strictEqual(findResolved(underDefault, "frozen").value, false);
    assert.strictEqual(findResolved(underDefault, "frozen").isOverride, true);

    // Resolution against a preset that also resolves frozen to false (the user
    // fragment overrides the shared one) clears the emphasis by comparison
    // alone; resolution itself never writes.
    const underTest = await resolveFor("preset-valid", "test", context);
    assert.strictEqual(findResolved(underTest, "frozen").value, false);
    assert.strictEqual(findResolved(underTest, "frozen").isOverride, false, "matches test's effective value");
    assert.strictEqual(readBuildOptions(context)?.values.frozen, false, "resolution does not rewrite the map");
  });

  test("changing the active preset discards the override, so the new preset's values show with nothing emphasized (FR-017)", async () => {
    const context = createFakeContext();

    // Default's effective frozen is true; override it to false and confirm it
    // shadows the [[defaults]] value.
    await writeBuildOption(context, "frozen", false);
    const beforeSwitch = await resolveFor("preset-valid", "default", context);
    assert.strictEqual(findResolved(beforeSwitch, "frozen").isOverride, true);

    // The refresh seam runs this whenever the active preset id changes.
    const cleared = await discardBuildOptionOverrides(context);
    assert.deepStrictEqual(cleared, ["frozen"]);
    assert.deepStrictEqual(readBuildOptions(context)?.values, {}, "the persisted map is emptied");

    const afterSwitch = await resolveFor("preset-valid", "dev", context);
    assert.strictEqual(findResolved(afterSwitch, "frozen").value, true, "follows dev's calculated value");
    for (const r of afterSwitch) {
      assert.strictEqual(r.isOverride, false, `${r.option.key} should not be emphasized after a preset change`);
    }

    // Switching back does not resurrect it.
    const backToDefault = await resolveFor("preset-valid", "default", context);
    assert.strictEqual(findResolved(backToDefault, "frozen").value, true);
    assert.strictEqual(findResolved(backToDefault, "frozen").isOverride, false);
  });

  test("a stale pre-feature checkbox false stops shadowing its [[defaults]] value after one preset change", async () => {
    // The reported defect, end to end: a workspace whose build-option record
    // predates presets stores `false` for an option that [[defaults]] sets to
    // true, which reads as an override no checkbox interaction can undo.
    const context = createFakeContext();
    await writeBuildOption(context, "frozen", false);

    const onLoad = await resolveFor("preset-valid", "default", context);
    assert.strictEqual(findResolved(onLoad, "frozen").value, false);
    assert.strictEqual(findResolved(onLoad, "frozen").isOverride, true, "stale value shadows [[defaults]]");

    await discardBuildOptionOverrides(context);
    const afterFirstSwitch = await resolveFor("preset-valid", "default", context);
    assert.strictEqual(findResolved(afterFirstSwitch, "frozen").value, true, "the [[defaults]] value is visible again");
    assert.strictEqual(findResolved(afterFirstSwitch, "frozen").isOverride, false);
  });

  test("the tree row and its rendering reflect the override state", async () => {
    const context = createFakeContext();
    await writeBuildOption(context, "frozen", false);
    const resolved = await resolveFor("preset-valid", "default", context);

    const provider = new ConfigurationTreeProvider();
    provider.update(manifest(), activeConfig(), resolved);
    const top = provider.getChildren() as vscode.TreeItem[];
    const optionsSection = top.find(
      (i) => i instanceof SectionItem && (i as SectionItem).sectionId === "build-options"
    ) as SectionItem;
    const children = provider.getChildren(optionsSection) as vscode.TreeItem[];
    provider.dispose();

    const frozenItem = children.find((c) => c instanceof BuildOptionCheckboxItem) as BuildOptionCheckboxItem;
    assert.ok(frozenItem, "expected a checkbox row for frozen");
    assert.deepStrictEqual(frozenItem.label, { label: "Frozen", highlights: [[0, 6]] });
  });
});

// ---------------------------------------------------------------------------
// A preset-context change retires overrides too (FR-017)
//
// preset-valid/presets.toml conditions its [[defaults]] fragments on
// `emulator`, so the same option calculates differently across contexts even
// with the preset id fixed — which is exactly why an override cannot survive
// the change.
// ---------------------------------------------------------------------------

suite("Preset-relative Build Options – preset-context change discards overrides", () => {
  const HW = activeConfig({ targetId: "hw" });
  const EMU = activeConfig({ targetId: "emu" });

  test("the [[defaults]] layer calculates different values for the hardware and emulator contexts", async () => {
    const context = createFakeContext();

    const onHw = await resolveFor("preset-valid", "default", context, HW);
    assert.strictEqual(findResolved(onHw, "frozen").value, true, "when = { emulator = false } applies");
    assert.strictEqual(findResolved(onHw, "dbg_console").value, "null");

    const onEmu = await resolveFor("preset-valid", "default", context, EMU);
    assert.strictEqual(findResolved(onEmu, "dbg_console").value, "swo", "when = { emulator = true } applies");
    assert.strictEqual(findResolved(onEmu, "frozen").value, false, "the hardware-only fragment no longer applies");
  });

  test("an override authored under the hardware context is discarded when the target becomes the emulator", async () => {
    const context = createFakeContext();

    // Hardware context calculates dbg-console to its null state; override it.
    await writeBuildOption(context, "dbg_console", "vcp");
    const beforeSwitch = await resolveFor("preset-valid", "default", context, HW);
    assert.strictEqual(findResolved(beforeSwitch, "dbg_console").value, "vcp");
    assert.strictEqual(findResolved(beforeSwitch, "dbg_console").isOverride, true);

    // The refresh seam sees a changed preset context and clears the map.
    assert.strictEqual(
      samePresetContext(derivePresetContext(manifest(), HW), derivePresetContext(manifest(), EMU)),
      false,
      "crossing the emulator boundary is a preset-context change"
    );
    const cleared = await discardBuildOptionOverrides(context);
    assert.deepStrictEqual(cleared, ["dbg_console"]);

    const afterSwitch = await resolveFor("preset-valid", "default", context, EMU);
    assert.strictEqual(findResolved(afterSwitch, "dbg_console").value, "swo", "follows the emulator [[defaults]] value");
    for (const r of afterSwitch) {
      assert.strictEqual(r.isOverride, false, `${r.option.key} should not be emphasized after a context change`);
    }

    // Switching back does not resurrect it.
    const backToHw = await resolveFor("preset-valid", "default", context, HW);
    assert.strictEqual(findResolved(backToHw, "dbg_console").value, "null");
    assert.strictEqual(findResolved(backToHw, "dbg_console").isOverride, false);
  });

  test("a model or component change is a preset-context change even when the calculated values are identical", async () => {
    // The discard is unconditional on the pair changing, not scoped to the
    // options whose value moved: overrides are held workspace-wide, so a
    // context they were not authored under must not inherit them.
    const context = createFakeContext();
    const base = derivePresetContext(manifest(), HW);

    assert.strictEqual(
      samePresetContext(base, derivePresetContext(manifest(), activeConfig({ modelId: "T3W1" }))),
      false
    );
    assert.strictEqual(
      samePresetContext(base, derivePresetContext(manifest(), activeConfig({ componentId: "bootloader" }))),
      false
    );

    await writeBuildOption(context, "frozen", false);
    const onOtherModel = await resolveFor("preset-valid", "default", context, activeConfig({ modelId: "T3W1" }));
    assert.strictEqual(
      findResolved(onOtherModel, "frozen").presetValue,
      true,
      "no fragment restricts on model, so the calculated value is unchanged"
    );

    assert.deepStrictEqual(await discardBuildOptionOverrides(context), ["frozen"]);
    const afterDiscard = await resolveFor("preset-valid", "default", context, activeConfig({ modelId: "T3W1" }));
    assert.strictEqual(findResolved(afterDiscard, "frozen").value, true);
    assert.strictEqual(findResolved(afterDiscard, "frozen").isOverride, false);
  });
});

// ---------------------------------------------------------------------------
// Multistate inference with no manifest-authored default (Scenario 2.5)
// ---------------------------------------------------------------------------

suite("Preset-relative Build Options – multistate inference without a manifest default", () => {
  test("dbg-console has no explicit override and infers its state from the preset-effective value", async () => {
    const context = createFakeContext();
    const resolved = await resolveFor("preset-valid", "dev", context);
    assert.strictEqual(findResolved(resolved, "dbg_console").value, "swo");
    assert.strictEqual(findResolved(resolved, "dbg_console").isOverride, false);
  });

  test("selecting the null-valued state clears the override", async () => {
    const context = createFakeContext();
    await writeBuildOption(context, "dbg_console", "null");
    const resolved = await resolveFor("preset-valid", "dev", context);
    assert.strictEqual(findResolved(resolved, "dbg_console").value, "swo", "follows dev's preset-effective value");
    assert.strictEqual(findResolved(resolved, "dbg_console").isOverride, false);
  });
});

// ---------------------------------------------------------------------------
// Option-level mismatch (preset-value-mismatch fixture)
// ---------------------------------------------------------------------------

suite("Preset-relative Build Options – option-level mismatch", () => {
  test("preset-value-mismatch reports the affected row as a mismatch, blocking neither other options nor availability", async () => {
    const context = createFakeContext();
    const resolved = await resolveFor("preset-value-mismatch", "default", context);
    const dbgConsole = findResolved(resolved, "dbg_console");
    assert.strictEqual(dbgConsole.presetState, "mismatch");
    assert.strictEqual(dbgConsole.isOverride, false);

    const provider = new ConfigurationTreeProvider();
    provider.update(manifest(), activeConfig(), resolved);
    const top = provider.getChildren() as vscode.TreeItem[];
    const optionsSection = top.find(
      (i) => i instanceof SectionItem && (i as SectionItem).sectionId === "build-options"
    ) as SectionItem;
    const children = provider.getChildren(optionsSection) as vscode.TreeItem[];
    provider.dispose();

    const dbgConsoleItem = children.find(
      (c) => c instanceof BuildOptionMultistateHeaderItem && c.optionKey === "dbg_console"
    ) as BuildOptionMultistateHeaderItem;
    assert.ok(dbgConsoleItem, "expected the dbg-console row to render");
    assert.strictEqual((dbgConsoleItem.iconPath as vscode.ThemeIcon).id, "warning");
  });
});
