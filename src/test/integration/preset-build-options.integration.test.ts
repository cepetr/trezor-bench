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
  shiftedPresetOptionKeys,
} from "../../presets/preset-resolution";
import { PresetStateLoaded } from "../../presets/preset-types";
import {
  normalizeBuildOptions,
  readBuildOptions,
  writeBuildOption,
  dropBuildOptionOverrides,
  ResolvedOption,
} from "../../configuration/build-options";
import { BuildOption } from "../../manifest/manifest-types";
import {
  ConfigurationTreeModel,
  BuildOptionCheckboxItem,
  BuildOptionMultistateHeaderItem,
} from "../../ui/configuration-tree";
import { BuildSelection } from "../../configuration/build-selection";
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

// Mirrors test-fixtures/workspaces/preset-valid/tbench-manifest.yaml.
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
    manifestUri: vscode.Uri.file("/workspace/tbench-manifest.yaml"),
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

function buildSelection(overrides: Partial<BuildSelection> = {}): BuildSelection {
  return {
    modelId: "T2T1",
    targetId: "hw",
    componentId: "firmware",
    persistedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function loadPresets(fixtureName: string): Promise<PresetStateLoaded> {
  const { shared, user } = fixtureUris(fixtureName);
  const service = new PresetService(shared, user);
  const state = await service.start();
  service.dispose();
  assert.strictEqual(state.status, "loaded", `${fixtureName} should load`);
  return state as PresetStateLoaded;
}

/**
 * The option keys whose calculated value moves between two `(preset, context)`
 * pairs — what the refresh seam feeds to `dropBuildOptionOverrides`.
 */
async function shiftedFor(
  fixtureName: string,
  fromPresetId: string,
  toPresetId: string,
  fromConfig: BuildSelection = buildSelection(),
  toConfig: BuildSelection = fromConfig
): Promise<string[]> {
  const state = await loadPresets(fixtureName);
  const effective = (presetId: string, config: BuildSelection) =>
    computePresetEffectiveValues(
      BUILD_OPTIONS,
      state.shared,
      state.user,
      presetId,
      derivePresetContext(manifest(), config)
    );
  return shiftedPresetOptionKeys(effective(fromPresetId, fromConfig), effective(toPresetId, toConfig));
}

async function resolveFor(
  fixtureName: string,
  activePresetId: string,
  context: vscode.ExtensionContext,
  config: BuildSelection = buildSelection()
): Promise<ResolvedOption[]> {
  const state = await loadPresets(fixtureName);
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

suite("Preset-relative Build Options – switching presets", () => {
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
// Overriding emphasizes the row; matching the preset again clears it
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

  test("changing the active preset drops only the overrides whose calculated value moved", async () => {
    const context = createFakeContext();

    // Under Default: frozen calculates true and pyopt calculates "true".
    // Override both. Switching to dev moves pyopt (to "false") but leaves
    // frozen where the [[defaults]] layer put it.
    await writeBuildOption(context, "frozen", false);
    await writeBuildOption(context, "pyopt", "false");
    const beforeSwitch = await resolveFor("preset-valid", "default", context);
    assert.strictEqual(findResolved(beforeSwitch, "frozen").isOverride, true);
    assert.strictEqual(findResolved(beforeSwitch, "pyopt").isOverride, true);

    const shifted = await shiftedFor("preset-valid", "default", "dev");
    assert.deepStrictEqual(shifted, ["dbg_console", "pyopt"], "only these calculate differently under dev");
    const dropped = await dropBuildOptionOverrides(context, shifted);
    assert.deepStrictEqual(dropped, ["pyopt"], "only the stored override whose baseline moved");
    assert.deepStrictEqual(readBuildOptions(context)?.values, { frozen: false }, "the rest of the map survives");

    const afterSwitch = await resolveFor("preset-valid", "dev", context);
    assert.strictEqual(findResolved(afterSwitch, "pyopt").value, "false", "follows dev's calculated value");
    assert.strictEqual(findResolved(afterSwitch, "pyopt").isOverride, false, "and is no longer emphasized");
    assert.strictEqual(findResolved(afterSwitch, "frozen").value, false, "the preserved override still applies");
    assert.strictEqual(findResolved(afterSwitch, "frozen").isOverride, true, "and is still emphasized");
  });

  test("a preset change that moves nothing preserves every override", async () => {
    // [[local]] only sets btc-only = false, which is already the calculated
    // value, so no option's baseline moves and nothing is pruned.
    const context = createFakeContext();
    await writeBuildOption(context, "frozen", false);
    await writeBuildOption(context, "dbg_console", "vcp");

    const shifted = await shiftedFor("preset-valid", "default", "local");
    assert.deepStrictEqual(shifted, [], "local calculates the same values as Default here");
    assert.deepStrictEqual(await dropBuildOptionOverrides(context, shifted), []);
    assert.deepStrictEqual(readBuildOptions(context)?.values, { frozen: false, dbg_console: "vcp" });

    const afterSwitch = await resolveFor("preset-valid", "local", context);
    assert.strictEqual(findResolved(afterSwitch, "frozen").isOverride, true);
    assert.strictEqual(findResolved(afterSwitch, "dbg_console").value, "vcp");
    assert.strictEqual(findResolved(afterSwitch, "dbg_console").isOverride, true);
  });

  test("a stale pre-feature checkbox false stops shadowing its [[defaults]] value after one preset change", async () => {
    // The Phase 7 defect, end to end: a workspace whose build-option record
    // predates presets stores `false` for an option that [[defaults]] sets to
    // true, which reads as an override no checkbox interaction can undo. The
    // per-option prune still clears it, because a stored value can only shadow
    // a newly calculated value when that value moved.
    const context = createFakeContext();
    await writeBuildOption(context, "pyopt", "false");

    const onLoad = await resolveFor("preset-valid", "default", context);
    assert.strictEqual(findResolved(onLoad, "pyopt").value, "false");
    assert.strictEqual(findResolved(onLoad, "pyopt").isOverride, true, "stale value shadows [[defaults]]");

    const shifted = await shiftedFor("preset-valid", "default", "dev");
    assert.deepStrictEqual(await dropBuildOptionOverrides(context, shifted), ["pyopt"]);
    const afterFirstSwitch = await resolveFor("preset-valid", "dev", context);
    assert.strictEqual(findResolved(afterFirstSwitch, "pyopt").value, "false", "dev's calculated value is visible");
    assert.strictEqual(findResolved(afterFirstSwitch, "pyopt").isOverride, false);
  });

  test("the tree row and its rendering reflect the override state", async () => {
    const context = createFakeContext();
    await writeBuildOption(context, "frozen", false);
    const resolved = await resolveFor("preset-valid", "default", context);

    const treeModel = new ConfigurationTreeModel();
    treeModel.update(manifest(), buildSelection(), resolved);
    const children = treeModel.paneRootChildren("build-options") as vscode.TreeItem[];
    treeModel.dispose();

    const frozenItem = children.find((c) => c instanceof BuildOptionCheckboxItem) as BuildOptionCheckboxItem;
    assert.ok(frozenItem, "expected a checkbox row for frozen");
    assert.deepStrictEqual(frozenItem.label, { label: "Frozen", highlights: [[0, 6]] });
  });
});

// ---------------------------------------------------------------------------
// A preset-context change prunes overrides per option too
//
// preset-valid/presets.toml conditions its [[defaults]] fragments on
// `emulator`, so the same option calculates differently across contexts even
// with the preset id fixed — which is exactly why an override over a moved
// value cannot survive the change, while one over an unmoved value can.
// ---------------------------------------------------------------------------

suite("Preset-relative Build Options – preset-context change prunes overrides", () => {
  const HW = buildSelection({ targetId: "hw" });
  const EMU = buildSelection({ targetId: "emu" });
  const OTHER_MODEL = buildSelection({ modelId: "T3W1" });

  test("the [[defaults]] layer calculates different values for the hardware and emulator contexts", async () => {
    const context = createFakeContext();

    const onHw = await resolveFor("preset-valid", "default", context, HW);
    assert.strictEqual(findResolved(onHw, "frozen").value, true, "when = { emulator = false } applies");
    assert.strictEqual(findResolved(onHw, "dbg_console").value, "null");

    const onEmu = await resolveFor("preset-valid", "default", context, EMU);
    assert.strictEqual(findResolved(onEmu, "dbg_console").value, "swo", "when = { emulator = true } applies");
    assert.strictEqual(findResolved(onEmu, "frozen").value, false, "the hardware-only fragment no longer applies");
  });

  test("crossing the emulator boundary drops the overrides it moved and keeps the rest", async () => {
    const context = createFakeContext();

    // Hardware calculates dbg-console to its null state and btc-only to false;
    // override both. Only dbg-console's value moves in the emulator context.
    await writeBuildOption(context, "dbg_console", "vcp");
    await writeBuildOption(context, "btc_only", true);
    const beforeSwitch = await resolveFor("preset-valid", "default", context, HW);
    assert.strictEqual(findResolved(beforeSwitch, "dbg_console").isOverride, true);
    assert.strictEqual(findResolved(beforeSwitch, "btc_only").isOverride, true);

    // The refresh seam sees a changed preset context and prunes per option.
    assert.strictEqual(
      samePresetContext(derivePresetContext(manifest(), HW), derivePresetContext(manifest(), EMU)),
      false,
      "crossing the emulator boundary is a preset-context change"
    );
    const shifted = await shiftedFor("preset-valid", "default", "default", HW, EMU);
    assert.deepStrictEqual(shifted, ["frozen", "dbg_console", "pyopt"]);
    assert.deepStrictEqual(await dropBuildOptionOverrides(context, shifted), ["dbg_console"]);
    assert.deepStrictEqual(readBuildOptions(context)?.values, { btc_only: true });

    const afterSwitch = await resolveFor("preset-valid", "default", context, EMU);
    assert.strictEqual(findResolved(afterSwitch, "dbg_console").value, "swo", "follows the emulator [[defaults]] value");
    assert.strictEqual(findResolved(afterSwitch, "dbg_console").isOverride, false);
    assert.strictEqual(findResolved(afterSwitch, "btc_only").value, true, "the unmoved override is preserved");
    assert.strictEqual(findResolved(afterSwitch, "btc_only").isOverride, true);

    // Switching back does not resurrect the dropped one.
    const backToHw = await resolveFor("preset-valid", "default", context, HW);
    assert.strictEqual(findResolved(backToHw, "dbg_console").value, "null");
    assert.strictEqual(findResolved(backToHw, "dbg_console").isOverride, false);
  });

  test("a model or component change preserves every override when no fragment filters on it", async () => {
    // The prune is per option, not per pair change: a context change that moves
    // no calculated value leaves the whole map in place.
    const context = createFakeContext();
    const base = derivePresetContext(manifest(), HW);

    assert.strictEqual(samePresetContext(base, derivePresetContext(manifest(), OTHER_MODEL)), false);
    assert.strictEqual(
      samePresetContext(base, derivePresetContext(manifest(), buildSelection({ componentId: "bootloader" }))),
      false
    );

    await writeBuildOption(context, "frozen", false);
    const onOtherModel = await resolveFor("preset-valid", "default", context, OTHER_MODEL);
    assert.strictEqual(
      findResolved(onOtherModel, "frozen").presetValue,
      true,
      "no fragment restricts on model, so the calculated value is unchanged"
    );

    const shifted = await shiftedFor("preset-valid", "default", "default", HW, OTHER_MODEL);
    assert.deepStrictEqual(shifted, [], "nothing moved, so nothing is pruned");
    assert.deepStrictEqual(await dropBuildOptionOverrides(context, shifted), []);

    const afterPrune = await resolveFor("preset-valid", "default", context, OTHER_MODEL);
    assert.strictEqual(findResolved(afterPrune, "frozen").value, false, "the override survives the model change");
    assert.strictEqual(findResolved(afterPrune, "frozen").isOverride, true);
  });

  test("a component change that moves a value still drops that option's override", async () => {
    // [[dev]] is restricted to project = ["firmware"], so switching Component
    // to bootloader moves dbg-console and pyopt back to the [[defaults]] layer —
    // and normalizes the active preset to `default`, since dev is no longer
    // available there.
    const context = createFakeContext();
    const bootloader = buildSelection({ componentId: "bootloader" });

    await writeBuildOption(context, "dbg_console", "vcp");
    const shifted = await shiftedFor("preset-valid", "dev", "default", HW, bootloader);
    assert.deepStrictEqual(shifted, ["dbg_console", "pyopt"]);
    assert.deepStrictEqual(await dropBuildOptionOverrides(context, shifted), ["dbg_console"]);

    const afterSwitch = await resolveFor("preset-valid", "default", context, bootloader);
    assert.strictEqual(findResolved(afterSwitch, "dbg_console").value, "null", "the [[dev]] fragment no longer applies");
    assert.strictEqual(findResolved(afterSwitch, "dbg_console").isOverride, false);
  });
});

// ---------------------------------------------------------------------------
// Multistate inference with no manifest-authored default
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

    const treeModel = new ConfigurationTreeModel();
    treeModel.update(manifest(), buildSelection(), resolved);
    const children = treeModel.paneRootChildren("build-options") as vscode.TreeItem[];
    treeModel.dispose();

    const dbgConsoleItem = children.find(
      (c) => c instanceof BuildOptionMultistateHeaderItem && c.optionKey === "dbg_console"
    ) as BuildOptionMultistateHeaderItem;
    assert.ok(dbgConsoleItem, "expected the dbg-console row to render");
    assert.strictEqual((dbgConsoleItem.iconPath as vscode.ThemeIcon).id, "warning");
  });
});
