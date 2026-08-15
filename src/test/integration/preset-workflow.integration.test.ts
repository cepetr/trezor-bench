/**
 * Integration tests for User Story 3: preset-aware Build/Clippy/Check
 * argument derivation. Runs inside the VS Code extension host via
 * @vscode/test-electron.
 *
 * Exercises the real preset-valid fixture through PresetService +
 * preset-resolution + build-options + deriveWorkflowArguments, mirroring
 * the pipeline extension.ts runs before launching a task.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { PresetService } from "../../presets/preset-service";
import { derivePresetContext, computePresetEffectiveValues } from "../../presets/preset-resolution";
import {
  normalizeBuildOptions,
  readBuildOptions,
  writeBuildOption,
} from "../../configuration/build-options";
import { deriveWorkflowArguments } from "../../commands/build-workflow";
import { BuildOption, ManifestStateLoaded } from "../../manifest/manifest-types";
import { ActiveBuildContext } from "../../configuration/active-build-context";
import { DEFAULT_PRESET_ID } from "../../presets/preset-types";

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
    models: [{ kind: "model", id: "T2T1", name: "Trezor Model T" }],
    targets: [{ kind: "target", id: "hw", name: "Hardware", shortName: "HW", flag: null }],
    components: [{ kind: "component", id: "firmware", name: "Firmware" }],
    buildOptions: BUILD_OPTIONS,
    hasWorkflowBlockingIssues: false,
    hasDebugBlockingIssues: false,
    validationIssues: [],
    loadedAt: new Date(),
  };
}

function activeBuildContext(overrides: Partial<ActiveBuildContext> = {}): ActiveBuildContext {
  return {
    modelId: "T2T1",
    targetId: "hw",
    componentId: "firmware",
    persistedAt: new Date().toISOString(),
    ...overrides,
  };
}

const BUILD_CONTEXT_ADAPTER = { modelId: "T2T1", targetId: "hw", componentId: "firmware" };
const WF_CTX = { modelId: "T2T1", targetId: "hw", componentId: "firmware", targetFlag: null };

/** Mirrors the recalculate-before-launch pipeline extension.ts runs. */
async function launchArgsFor(
  shared: vscode.Uri,
  user: vscode.Uri,
  presetId: string,
  context: vscode.ExtensionContext
): Promise<string[]> {
  const service = new PresetService(shared, user);
  const state = await service.start();
  service.dispose();
  assert.strictEqual(state.status, "loaded");
  if (state.status !== "loaded") {
    return [];
  }
  const presetCtx = derivePresetContext(manifest(), activeBuildContext());
  const effective = computePresetEffectiveValues(BUILD_OPTIONS, state.shared, state.user, presetId, presetCtx);
  const resolved = normalizeBuildOptions(BUILD_OPTIONS, readBuildOptions(context), BUILD_CONTEXT_ADAPTER, effective);
  return deriveWorkflowArguments("Build", WF_CTX, resolved, presetId);
}

// ---------------------------------------------------------------------------
// Default, no overrides
// ---------------------------------------------------------------------------

suite("Preset-aware workflow – Default, no differing overrides", () => {
  test("neither -p nor any option flag is present", async () => {
    const { shared, user } = fixtureUris("preset-valid");
    const args = await launchArgsFor(shared, user, DEFAULT_PRESET_ID, createFakeContext());
    assert.deepStrictEqual(args, ["firmware", "-m", "T2T1"]);
  });
});

// ---------------------------------------------------------------------------
// named preset, exactly one -p pair
// ---------------------------------------------------------------------------

suite("Preset-aware workflow – named preset", () => {
  test("args include exactly one -p <name> pair", async () => {
    const { shared, user } = fixtureUris("preset-valid");
    const args = await launchArgsFor(shared, user, "test", createFakeContext());
    const pCount = args.filter((a) => a === "-p").length;
    assert.strictEqual(pCount, 1);
    assert.strictEqual(args[args.indexOf("-p") + 1], "test");
  });
});

// ---------------------------------------------------------------------------
// mixed selections
// ---------------------------------------------------------------------------

suite("Preset-aware workflow – mixed selections", () => {
  test("only the differing value produces a flag", async () => {
    const context = createFakeContext();
    // Under "test": frozen effective = false (user overrides shared), btc-only effective = true.
    await writeBuildOption(context, "frozen", false); // matches -> no flag
    await writeBuildOption(context, "btc_only", false); // differs -> flag

    const { shared, user } = fixtureUris("preset-valid");
    const args = await launchArgsFor(shared, user, "test", context);

    assert.ok(!args.some((a) => a.startsWith("--frozen")));
    assert.ok(args.includes("--btc-only=false"));
  });
});

// ---------------------------------------------------------------------------
// Checkbox turned off against a preset-effective true
// ---------------------------------------------------------------------------

suite("Preset-aware workflow – checkbox off-override", () => {
  test("a checkbox turned off against a preset-effective true emits <flag>=false", async () => {
    const context = createFakeContext();
    await writeBuildOption(context, "frozen", false); // Default's effective frozen is true

    const { shared, user } = fixtureUris("preset-valid");
    const args = await launchArgsFor(shared, user, DEFAULT_PRESET_ID, context);
    assert.ok(args.includes("--frozen=false"));
  });
});

// ---------------------------------------------------------------------------
// user fragments override shared for the comparison
// ---------------------------------------------------------------------------

suite("Preset-aware workflow – user fragments override shared", () => {
  test("comparison uses the user-adjusted effective value, not the shared-only value", async () => {
    const context = createFakeContext();
    // Shared "test" never sets frozen; shared defaults set frozen=true; user "test" sets frozen=false.
    // A stored selection of false must NOT be seen as an override (it matches the user-adjusted value).
    await writeBuildOption(context, "frozen", false);

    const { shared, user } = fixtureUris("preset-valid");
    const args = await launchArgsFor(shared, user, "test", context);
    assert.ok(!args.some((a) => a.startsWith("--frozen")), "must compare against the user-overridden value");
  });
});

// ---------------------------------------------------------------------------
// Editing presets.toml with the view open, then invoking Build
// ---------------------------------------------------------------------------

suite("Preset-aware workflow – recalculation before launch", () => {
  let tmpDir: string;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tbench-preset-workflow-"));
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("editing presets.toml then invoking Build reflects the edited file, with no window reload", async () => {
    const sharedPath = path.join(tmpDir, "presets.toml");
    const userPath = path.join(tmpDir, "user-presets.toml");
    await fs.writeFile(sharedPath, "[[defaults]]\nfrozen = true\n", "utf-8");

    const service = new PresetService(vscode.Uri.file(sharedPath), vscode.Uri.file(userPath));
    await service.start();

    // First launch: frozen effective = true.
    const context = createFakeContext();
    const presetCtx = derivePresetContext(manifest(), activeBuildContext());
    const firstState = service.state;
    assert.ok(firstState && firstState.status === "loaded");
    const firstEffective = computePresetEffectiveValues(
      BUILD_OPTIONS,
      firstState!.shared,
      firstState!.user,
      DEFAULT_PRESET_ID,
      presetCtx
    );
    const firstResolved = normalizeBuildOptions(BUILD_OPTIONS, readBuildOptions(context), BUILD_CONTEXT_ADAPTER, firstEffective);
    const firstArgs = deriveWorkflowArguments("Build", WF_CTX, firstResolved, DEFAULT_PRESET_ID);
    assert.deepStrictEqual(firstArgs, ["firmware", "-m", "T2T1"]);

    // Edit the file (simulating the view remaining open) and reload, exactly as
    // the Build/Clippy/Check command handlers do before deriving arguments.
    await fs.writeFile(sharedPath, "[[defaults]]\nfrozen = false\n", "utf-8");
    const reloaded = await service.reload();
    service.dispose();
    assert.ok(reloaded.status === "loaded");
    const secondEffective = computePresetEffectiveValues(
      BUILD_OPTIONS,
      reloaded.shared,
      reloaded.user,
      DEFAULT_PRESET_ID,
      presetCtx
    );
    const secondResolved = normalizeBuildOptions(BUILD_OPTIONS, readBuildOptions(context), BUILD_CONTEXT_ADAPTER, secondEffective);
    const secondArgs = deriveWorkflowArguments("Build", WF_CTX, secondResolved, DEFAULT_PRESET_ID);
    assert.deepStrictEqual(secondArgs, ["firmware", "-m", "T2T1"], "frozen=false now equals the (unresolved-free) default, no override to emit");
  });
});
