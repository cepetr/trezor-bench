/**
 * Unit tests for the PresetOptionsCoordinator refresh seam: blocked-flag
 * derivation, selection restore/publish through the deps surface, and the
 * preset-change override pruning.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import {
  PresetOptionsCoordinator,
  PresetOptionsDeps,
} from "../../../presets/preset-options-coordinator";
import { PresetChoice } from "../../../presets/preset-resolution";
import {
  PresetFile,
  PresetFragment,
  PresetState,
  PresetStateLoaded,
} from "../../../presets/preset-types";
import {
  ManifestState,
  ManifestStateLoaded,
  BuildContext,
} from "../../../manifest/manifest-types";
import { ACTIVE_CONFIG_KEY, BuildSelection } from "../../../build/build-selection";
import {
  BUILD_OPTIONS_KEY,
  BuildOptionsState,
  ResolvedOption,
} from "../../../build/build-options";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHARED_URI = vscode.Uri.file("/workspace/xtask/tf-tools/presets.toml");
const USER_URI = vscode.Uri.file("/workspace/xtask/tf-tools/user-presets.toml");

function presetFile(overrides: Partial<PresetFile> & Pick<PresetFile, "source">): PresetFile {
  return {
    uri: overrides.source === "user" ? USER_URI : SHARED_URI,
    present: true,
    names: [],
    fragments: [],
    issues: [],
    ...overrides,
  };
}

function fragment(
  overrides: Partial<PresetFragment> & Pick<PresetFragment, "name" | "source">
): PresetFragment {
  return { order: 0, filter: {}, values: {}, ...overrides };
}

/** A manifest with one model/target/component and two checkbox options. */
function loadedManifestFixture(): ManifestStateLoaded {
  return {
    status: "loaded",
    manifestUri: vscode.Uri.file("/workspace/manifest.yaml"),
    models: [{ kind: "model", id: "T2T1", name: "Model T" }],
    targets: [{ kind: "target", id: "hw", name: "Hardware" }],
    components: [{ kind: "component", id: "firmware", name: "Firmware" }],
    buildOptions: [
      { key: "frozen", id: "frozen", label: "Frozen", flag: "--frozen", kind: "checkbox" },
      { key: "verbose", id: "verbose", label: "Verbose", flag: "--verbose", kind: "checkbox" },
    ],
    hasWorkflowBlockingIssues: false,
    hasDebugBlockingIssues: false,
    validationIssues: [],
    loadedAt: new Date(),
  };
}

/** A loaded preset state declaring one named preset `dev` that sets `frozen`. */
function loadedPresetsFixture(): PresetStateLoaded {
  return {
    status: "loaded",
    shared: presetFile({
      source: "shared",
      names: ["dev"],
      fragments: [fragment({ name: "dev", source: "shared", values: { frozen: true } })],
    }),
    user: presetFile({ source: "user" }),
    loadedAt: new Date(),
    validationIssues: [],
  };
}

function fakeExtensionContext(): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  return {
    workspaceState: {
      get: <T>(key: string): T | undefined => store.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        store.set(key, value);
      },
    },
  } as unknown as vscode.ExtensionContext;
}

interface Harness {
  coordinator: PresetOptionsCoordinator;
  context: vscode.ExtensionContext;
  getSelection(): BuildSelection | undefined;
  updateTreeCalls: Array<{
    state: ManifestState;
    buildContext: BuildContext | undefined;
    resolvedOptions: ReadonlyArray<ResolvedOption>;
  }>;
  updatePresetsCalls: Array<{
    state: PresetState | undefined;
    activePresetId: string | undefined;
    choices: ReadonlyArray<PresetChoice>;
  }>;
}

/** Wires a coordinator to mutable stand-ins for the composition-root state. */
function makeHarness(
  manifestState: ManifestState | undefined,
  presetState: PresetState | undefined
): Harness {
  let buildSelection: BuildSelection | undefined;
  const updateTreeCalls: Harness["updateTreeCalls"] = [];
  const updatePresetsCalls: Harness["updatePresetsCalls"] = [];
  const deps: PresetOptionsDeps = {
    getManifestState: () => manifestState,
    getPresetState: () => presetState,
    getBuildSelection: () => buildSelection,
    setBuildSelection: (selection) => {
      buildSelection = selection;
    },
    updateTree: (state, buildContext, resolvedOptions) => {
      updateTreeCalls.push({ state, buildContext, resolvedOptions });
    },
    updatePresets: (state, activePresetId, choices) => {
      updatePresetsCalls.push({ state, activePresetId, choices });
    },
  };
  return {
    coordinator: new PresetOptionsCoordinator(deps),
    context: fakeExtensionContext(),
    getSelection: () => buildSelection,
    updateTreeCalls,
    updatePresetsCalls,
  };
}

// ---------------------------------------------------------------------------
// refresh
// ---------------------------------------------------------------------------

suite("PresetOptionsCoordinator.refresh", () => {
  test("unloaded manifest clears blocked flags and publishes an empty preset list", async () => {
    const h = makeHarness(undefined, loadedPresetsFixture());

    await h.coordinator.refresh(h.context);

    assert.strictEqual(h.coordinator.presetBlocked, false);
    assert.strictEqual(h.coordinator.presetsUnavailable, false);
    assert.strictEqual(h.coordinator.resolvedOptions.length, 0);
    assert.strictEqual(h.getSelection(), undefined);
    assert.strictEqual(h.updateTreeCalls.length, 0);
    assert.strictEqual(h.updatePresetsCalls.length, 1);
    assert.strictEqual(h.updatePresetsCalls[0].activePresetId, undefined);
    assert.deepStrictEqual(h.updatePresetsCalls[0].choices, []);
  });

  test("loaded manifest and presets publish selection, choices, and resolved options", async () => {
    const h = makeHarness(loadedManifestFixture(), loadedPresetsFixture());

    await h.coordinator.refresh(h.context);

    const selection = h.getSelection();
    assert.ok(selection);
    assert.strictEqual(selection.modelId, "T2T1");
    assert.strictEqual(selection.targetId, "hw");
    assert.strictEqual(selection.componentId, "firmware");
    assert.strictEqual(selection.presetId, "default");

    assert.strictEqual(h.coordinator.presetBlocked, false);
    assert.strictEqual(h.coordinator.resolvedOptions.length, 2);

    assert.strictEqual(h.updateTreeCalls.length, 1);
    assert.strictEqual(h.updatePresetsCalls.length, 1);
    assert.strictEqual(h.updatePresetsCalls[0].activePresetId, "default");
    assert.deepStrictEqual(
      h.updatePresetsCalls[0].choices.map((c) => c.id),
      ["default", "dev"]
    );
  });

  test("unavailable preset state sets both blocked flags", async () => {
    const presets = loadedPresetsFixture();
    const unavailable: PresetState = { ...presets, status: "unavailable" };
    const h = makeHarness(loadedManifestFixture(), unavailable);

    await h.coordinator.refresh(h.context);

    assert.strictEqual(h.coordinator.presetBlocked, true);
    assert.strictEqual(h.coordinator.presetsUnavailable, true);
  });

  test("preset change drops exactly the overrides whose calculated value moved", async () => {
    const h = makeHarness(loadedManifestFixture(), loadedPresetsFixture());

    // Session with the `dev` preset active (frozen calculates to true there).
    await h.context.workspaceState.update(ACTIVE_CONFIG_KEY, {
      modelId: "T2T1",
      targetId: "hw",
      componentId: "firmware",
      presetId: "dev",
      persistedAt: new Date().toISOString(),
    } satisfies BuildSelection);
    await h.coordinator.refresh(h.context);
    assert.strictEqual(h.getSelection()?.presetId, "dev");

    // Overrides authored under `dev`: `frozen` (calculated) and `verbose`
    // (never preset-set, so its baseline cannot move).
    await h.context.workspaceState.update(BUILD_OPTIONS_KEY, {
      values: { frozen: false, verbose: true },
      persistedAt: new Date().toISOString(),
    } satisfies BuildOptionsState);

    // Switch to the Default preset, where `frozen` calculates to nothing.
    const saved = h.context.workspaceState.get<BuildSelection>(ACTIVE_CONFIG_KEY)!;
    await h.context.workspaceState.update(ACTIVE_CONFIG_KEY, { ...saved, presetId: "default" });
    await h.coordinator.refresh(h.context);

    assert.strictEqual(h.getSelection()?.presetId, "default");
    const stored = h.context.workspaceState.get<BuildOptionsState>(BUILD_OPTIONS_KEY);
    assert.deepStrictEqual(stored?.values, { verbose: true });
  });
});
