/**
 * Integration tests for build-selectionuration persistence and status-bar behavior.
 * Runs inside the VS Code extension host via @vscode/test-electron.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import { StatusBarPresenter, formatStatusBarText } from "../../ui/status-bar";
import {
  readBuildSelection,
  writeBuildSelection,
  selectModel,
  selectTarget,
  selectComponent,
} from "../../configuration/build-selection";
import { normalizeBuildSelection } from "../../configuration/normalize-selection";
import { ManifestStateLoaded } from "../../manifest/manifest-types";

// ---------------------------------------------------------------------------
// Helper: fake ExtensionContext backed by a Map
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

function makeLoadedState(
  overrides: Partial<ManifestStateLoaded> = {}
): ManifestStateLoaded {
  return {
    status: "loaded",
    manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
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

// ---------------------------------------------------------------------------
// Suite: Active-configuration persistence round-trip
// ---------------------------------------------------------------------------

suite("build-selection persistence", () => {
  test("writeBuildSelection persists all three ids and persistedAt", async () => {
    const ctx = createFakeContext();
    const saved = await writeBuildSelection(ctx, {
      modelId: "T3W1",
      targetId: "emu",
      componentId: "prodtest",
    });
    assert.strictEqual(saved.modelId, "T3W1");
    assert.strictEqual(saved.targetId, "emu");
    assert.strictEqual(saved.componentId, "prodtest");
    assert.ok(saved.persistedAt, "expected persistedAt timestamp");
  });

  test("readBuildSelection returns undefined when nothing has been saved", () => {
    const ctx = createFakeContext();
    assert.strictEqual(readBuildSelection(ctx), undefined);
  });

  test("readBuildSelection returns the last written config", async () => {
    const ctx = createFakeContext();
    await writeBuildSelection(ctx, { modelId: "T2T1", targetId: "hw", componentId: "core" });
    const read = readBuildSelection(ctx);
    assert.ok(read, "expected readBuildSelection to return a config");
    assert.strictEqual(read!.modelId, "T2T1");
    assert.strictEqual(read!.targetId, "hw");
    assert.strictEqual(read!.componentId, "core");
  });
});

// ---------------------------------------------------------------------------
// Suite: Selector mutation helpers
// ---------------------------------------------------------------------------

suite("selector mutation helpers", () => {
  test("selectModel updates only the modelId; existing valid target+component are preserved", async () => {
    const ctx = createFakeContext();
    const manifest = makeLoadedState();
    await writeBuildSelection(ctx, { modelId: "T2T1", targetId: "emu", componentId: "prodtest" });

    const updated = await selectModel(ctx, "T3W1", manifest);
    assert.strictEqual(updated.modelId, "T3W1");
    assert.strictEqual(updated.targetId, "emu");
    assert.strictEqual(updated.componentId, "prodtest");
  });

  test("selectTarget updates only the targetId; existing valid model+component are preserved", async () => {
    const ctx = createFakeContext();
    const manifest = makeLoadedState();
    await writeBuildSelection(ctx, { modelId: "T3W1", targetId: "hw", componentId: "prodtest" });

    const updated = await selectTarget(ctx, "emu", manifest);
    assert.strictEqual(updated.modelId, "T3W1");
    assert.strictEqual(updated.targetId, "emu");
    assert.strictEqual(updated.componentId, "prodtest");
  });

  test("selectComponent updates only the componentId; existing valid model+target are preserved", async () => {
    const ctx = createFakeContext();
    const manifest = makeLoadedState();
    await writeBuildSelection(ctx, { modelId: "T3W1", targetId: "emu", componentId: "core" });

    const updated = await selectComponent(ctx, "prodtest", manifest);
    assert.strictEqual(updated.modelId, "T3W1");
    assert.strictEqual(updated.targetId, "emu");
    assert.strictEqual(updated.componentId, "prodtest");
  });
});

// ---------------------------------------------------------------------------
// Suite: Restore-on-reload normalization
// ---------------------------------------------------------------------------

suite("restore-on-reload normalization", () => {
  test("stale modelId is replaced with first model on reload", async () => {
    const ctx = createFakeContext();
    // Persist a config with a stale modelId
    await writeBuildSelection(ctx, { modelId: "OLD_MODEL", targetId: "hw", componentId: "core" });
    const saved = readBuildSelection(ctx);
    const manifest = makeLoadedState();
    const normalized = normalizeBuildSelection(manifest, saved);
    assert.strictEqual(normalized.modelId, "T2T1");
    assert.strictEqual(normalized.targetId, "hw");
    assert.strictEqual(normalized.componentId, "core");
  });

  test("valid persisted config is unchanged after normalization on reload", async () => {
    const ctx = createFakeContext();
    await writeBuildSelection(ctx, { modelId: "T3W1", targetId: "emu", componentId: "prodtest" });
    const saved = readBuildSelection(ctx);
    const manifest = makeLoadedState();
    const normalized = normalizeBuildSelection(manifest, saved);
    assert.strictEqual(normalized.modelId, "T3W1");
    assert.strictEqual(normalized.targetId, "emu");
    assert.strictEqual(normalized.componentId, "prodtest");
  });

  test("absent saved config results in first-entry defaults after normalization", () => {
    const manifest = makeLoadedState();
    const normalized = normalizeBuildSelection(manifest, undefined);
    assert.strictEqual(normalized.modelId, "T2T1");
    assert.strictEqual(normalized.targetId, "hw");
    assert.strictEqual(normalized.componentId, "core");
  });
});

// ---------------------------------------------------------------------------
// Suite: StatusBarPresenter rendering
// ---------------------------------------------------------------------------

suite("StatusBarPresenter rendering", () => {
  let presenter: StatusBarPresenter;

  setup(() => {
    presenter = new StatusBarPresenter();
  });

  teardown(() => {
    presenter.dispose();
  });

  test("formatStatusBarText returns correct string for first entries", () => {
    const manifest = makeLoadedState();
    const config = { modelId: "T2T1", targetId: "hw", componentId: "core", persistedAt: new Date().toISOString() };
    const text = formatStatusBarText(manifest, config);
    assert.strictEqual(text, "Trezor Model T | HW | Core");
  });

  test("formatStatusBarText uses shortName for target when present", () => {
    const manifest = makeLoadedState();
    const config = { modelId: "T2T1", targetId: "hw", componentId: "core", persistedAt: new Date().toISOString() };
    const text = formatStatusBarText(manifest, config);
    assert.ok(text?.includes("HW"), "expected shortName HW in status bar text");
  });

  test("formatStatusBarText uses name when shortName is absent", () => {
    const manifest = makeLoadedState();
    const config = { modelId: "T2T1", targetId: "emu", componentId: "core", persistedAt: new Date().toISOString() };
    const text = formatStatusBarText(manifest, config);
    assert.ok(text?.includes("Emulator"), "expected target name Emulator when no shortName");
  });

  test("update with missing state and no config does not throw", () => {
    // Should not throw — just hide the item
    assert.doesNotThrow(() => {
      presenter.update(
        { status: "missing", manifestUri: vscode.Uri.file("/workspace/tbench.yaml") },
        undefined,
        true
      );
    });
  });

  test("update with loaded state, valid config, and enabled=false does not throw", () => {
    const manifest = makeLoadedState();
    const config = { modelId: "T2T1", targetId: "hw", componentId: "core", persistedAt: new Date().toISOString() };
    assert.doesNotThrow(() => {
      presenter.update(manifest, config, false);
    });
  });
});
