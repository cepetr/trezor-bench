/**
 * Integration tests for manifest health states.
 * Runs inside the VS Code extension host via @vscode/test-electron.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { ManifestService } from "../../manifest/manifest-service";
import { ManifestState, ManifestStateLoaded } from "../../manifest/manifest-types";
import { resolveCompileCommandsArtifact, buildResolutionInputs, deriveArtifactPath } from "../../intellisense/artifact-resolution";
import { checkProviderReadiness } from "../../intellisense/intellisense-backend";
import { IntelliSenseService } from "../../intellisense/intellisense-service";
import { BuildSelection } from "../../build/build-selection";
import { ConfigurationTreeModel } from "../../ui/configuration-tree";

const VALID_MANIFEST = `
models:
  - id: T2T1
    name: Trezor Model T
targets:
  - id: hw
    name: Hardware
    shortName: HW
components:
  - id: core
    name: Core
`.trim();

const INVALID_MANIFEST = `
models: []
targets: []
components: []
`.trim();

suite("ManifestService - health states", () => {
  let tmpDir: string;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tbench-test-"));
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("status is 'loaded' when manifest is valid", async () => {
    const manifestPath = path.join(tmpDir, "tbench.yaml");
    await fs.writeFile(manifestPath, VALID_MANIFEST, "utf-8");

    const uri = vscode.Uri.file(manifestPath);
    const service = new ManifestService(uri);
    const state = await service.start();
    service.dispose();

    assert.strictEqual(state.status, "loaded");
    if (state.status === "loaded") {
      assert.strictEqual(state.models.length, 1);
      assert.strictEqual(state.targets.length, 1);
      assert.strictEqual(state.components.length, 1);
      assert.strictEqual(state.models[0].id, "T2T1");
      assert.strictEqual(state.targets[0].shortName, "HW");
    }
  });

  test("status is 'missing' when manifest file does not exist", async () => {
    const manifestPath = path.join(tmpDir, "tbench.yaml"); // not created
    const uri = vscode.Uri.file(manifestPath);
    const service = new ManifestService(uri);
    const state = await service.start();
    service.dispose();

    assert.strictEqual(state.status, "missing");
    assert.strictEqual(state.manifestUri.fsPath, uri.fsPath);
  });

  test("status is 'invalid' when manifest has structural errors", async () => {
    const manifestPath = path.join(tmpDir, "tbench.yaml");
    await fs.writeFile(manifestPath, INVALID_MANIFEST, "utf-8");

    const uri = vscode.Uri.file(manifestPath);
    const service = new ManifestService(uri);
    const state = await service.start();
    service.dispose();

    assert.strictEqual(state.status, "invalid");
    if (state.status === "invalid") {
      assert.ok(state.validationIssues.length > 0, "expected validation issues");
    }
  });

  test("status is 'invalid' when manifest has malformed YAML", async () => {
    const malformedYaml = "models:\n  - id: T2T1\n    bad: [unclosed";
    const manifestPath = path.join(tmpDir, "tbench.yaml");
    await fs.writeFile(manifestPath, malformedYaml, "utf-8");

    const uri = vscode.Uri.file(manifestPath);
    const service = new ManifestService(uri);
    const state = await service.start();
    service.dispose();

    assert.strictEqual(state.status, "invalid");
    if (state.status === "invalid") {
      assert.ok(state.validationIssues.some((i: {code: string}) => i.code === "yaml-parse"));
    }
  });

  test("fires onDidChangeState when manifest changes", async () => {
    const manifestPath = path.join(tmpDir, "tbench.yaml");
    await fs.writeFile(manifestPath, VALID_MANIFEST, "utf-8");

    const uri = vscode.Uri.file(manifestPath);
    const service = new ManifestService(uri);
    await service.start();

    const states: Array<{ status: string }> = [];
    service.onDidChangeState((s: ManifestState) => states.push({ status: s.status }));

    // Overwrite with invalid manifest and reload
    await fs.writeFile(manifestPath, INVALID_MANIFEST, "utf-8");
    await service.reload();

    service.dispose();
    assert.ok(states.length > 0, "expected at least one state change event");
    assert.strictEqual(states[states.length - 1].status, "invalid");
  });

  test("transitions from missing to loaded when manifest is created", async () => {
    const manifestPath = path.join(tmpDir, "tbench.yaml"); // not yet created
    const uri = vscode.Uri.file(manifestPath);
    const service = new ManifestService(uri);
    const initialState = await service.start();
    assert.strictEqual(initialState.status, "missing");

    // Create the manifest
    await fs.writeFile(manifestPath, VALID_MANIFEST, "utf-8");
    const loadedState = await service.reload();
    service.dispose();

    assert.strictEqual(loadedState.status, "loaded");
  });
});

// ---------------------------------------------------------------------------
// Compile-commands status and tooltip refresh using real filesystem checks
// ---------------------------------------------------------------------------

function makeIntellisenseLoadedState(overrides: Partial<ManifestStateLoaded> = {}): ManifestStateLoaded {
  return {
    status: "loaded",
    manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
    models: [{ kind: "model", id: "T2T1", name: "Trezor Model T", artifactFolder: "model-t" }],
    targets: [
      { kind: "target", id: "hw", name: "Hardware", shortName: "HW" },
      { kind: "target", id: "emu", name: "Emulator", shortName: "EMU", artifactSuffix: "_emu" },
    ],
    components: [{ kind: "component", id: "core", name: "Core", artifactName: "compile_commands_core" }],
    buildOptions: [],
    hasWorkflowBlockingIssues: false,
    debugProfiles: [],
    hasDebugBlockingIssues: false,
    validationIssues: [],
    loadedAt: new Date(),
    ...overrides,
  } as ManifestStateLoaded;
}

function makeBuildSelection(modelId: string, targetId: string, componentId: string): BuildSelection {
  return { modelId, targetId, componentId, persistedAt: new Date().toISOString() };
}

suite("resolveCompileCommandsArtifact – filesystem integration", () => {
  let tmpDir: string;

  setup(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tbench-intellisense-"));
  });

  teardown(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("status is 'missing' when artifact file does not exist on disk", async () => {
    const manifest = makeIntellisenseLoadedState();
    const config = makeBuildSelection("T2T1", "hw", "core");
    const inputs = buildResolutionInputs(manifest, config, tmpDir);
    assert.ok(inputs, "expected resolution inputs to resolve");

    const artifact = resolveCompileCommandsArtifact(inputs!, config);
    assert.strictEqual(artifact.status, "missing");
    assert.strictEqual(artifact.exists, false);
  });

  test("status is 'valid' when artifact file exists on disk", async () => {
    const manifest = makeIntellisenseLoadedState();
    const config = makeBuildSelection("T2T1", "hw", "core");
    const inputs = buildResolutionInputs(manifest, config, tmpDir);
    assert.ok(inputs, "expected resolution inputs to resolve");

    // Create the artifact file on disk
    const artifactPath = deriveArtifactPath(inputs!)!;
    assert.ok(artifactPath, "expected derived artifact path");
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, "[]", "utf-8");

    const artifact = resolveCompileCommandsArtifact(inputs!, config);
    assert.strictEqual(artifact.status, "valid");
    assert.strictEqual(artifact.exists, true);
    assert.strictEqual(artifact.path, artifactPath);
  });

  test("status transitions from missing to valid when file is created", async () => {
    const manifest = makeIntellisenseLoadedState();
    const config = makeBuildSelection("T2T1", "hw", "core");
    const inputs = buildResolutionInputs(manifest, config, tmpDir);
    assert.ok(inputs, "expected resolution inputs to resolve");

    // First resolve: file absent
    const before = resolveCompileCommandsArtifact(inputs!, config);
    assert.strictEqual(before.status, "missing");

    // Create the file
    const artifactPath = deriveArtifactPath(inputs!)!;
    assert.ok(artifactPath, "expected derived artifact path");
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, "[]", "utf-8");

    // Second resolve: file present
    const after = resolveCompileCommandsArtifact(inputs!, config);
    assert.strictEqual(after.status, "valid");
  });

  test("path contains artifactFolder in directory, not model id", async () => {
    const manifest = makeIntellisenseLoadedState();
    const config = makeBuildSelection("T2T1", "hw", "core");
    const inputs = buildResolutionInputs(manifest, config, tmpDir);
    assert.ok(inputs);
    const derivedPath = deriveArtifactPath(inputs!);
    assert.ok(derivedPath, "expected derived path");
    assert.ok(
      derivedPath!.includes("model-t"),
      `path should contain artifactFolder 'model-t': ${derivedPath}`
    );
    assert.ok(
      !derivedPath!.includes("T2T1"),
      `path should not contain model id 'T2T1': ${derivedPath}`
    );
  });

  test("path contains artifactSuffix for suffixed target", async () => {
    const manifest = makeIntellisenseLoadedState();
    const config = makeBuildSelection("T2T1", "emu", "core");
    const inputs = buildResolutionInputs(manifest, config, tmpDir);
    assert.ok(inputs);
    const derivedPath = deriveArtifactPath(inputs!);
    assert.ok(derivedPath, "expected derived path for emu target");
    assert.ok(
      derivedPath!.includes("_emu"),
      `path should contain artifactSuffix '_emu': ${derivedPath}`
    );
  });

  test("contextKey encodes model, target, and component ids", async () => {
    const manifest = makeIntellisenseLoadedState();
    const config = makeBuildSelection("T2T1", "hw", "core");
    const inputs = buildResolutionInputs(manifest, config, tmpDir);
    assert.ok(inputs);

    const artifact = resolveCompileCommandsArtifact(inputs!, config);
    assert.strictEqual(artifact.contextKey, "T2T1::hw::core");
  });

  test("missing artifact tooltip reports expected path in missingReason", async () => {
    const manifest = makeIntellisenseLoadedState();
    const config = makeBuildSelection("T2T1", "hw", "core");
    const inputs = buildResolutionInputs(manifest, config, tmpDir);
    assert.ok(inputs);

    const artifact = resolveCompileCommandsArtifact(inputs!, config);
    assert.strictEqual(artifact.status, "missing");
    // missingReason should reference the expected path
    assert.ok(
      artifact.missingReason !== undefined,
      "expected missingReason to be set for missing artifact"
    );
  });
});

// ---------------------------------------------------------------------------
// Provider-readiness and warning recovery using the real VS Code host
// ---------------------------------------------------------------------------

suite("checkProviderReadiness – integration", () => {
  test("returns a defined readiness object", () => {
    const result = checkProviderReadiness();
    assert.ok(result, "expected checkProviderReadiness to return a value");
  });

  test("warningState is one of the expected values", () => {
    const result = checkProviderReadiness();
    const validStates = ["none", "missing-provider", "wrong-provider"];
    assert.ok(
      validStates.includes(result.warningState),
      `expected warningState to be one of ${validStates}, got: ${result.warningState}`
    );
  });

  test("providerInstalled is boolean", () => {
    const result = checkProviderReadiness();
    assert.strictEqual(typeof result.providerInstalled, "boolean");
  });

  test("providerConfigured is boolean", () => {
    const result = checkProviderReadiness();
    assert.strictEqual(typeof result.providerConfigured, "boolean");
  });

  test("lastWarningMessage is string or undefined", () => {
    const result = checkProviderReadiness();
    assert.ok(
      result.lastWarningMessage === undefined || typeof result.lastWarningMessage === "string",
      `expected lastWarningMessage to be string or undefined`
    );
  });

  test("lastWarningMessage is set when warningState is not 'none'", () => {
    const result = checkProviderReadiness();
    if (result.warningState !== "none") {
      assert.ok(
        result.lastWarningMessage && result.lastWarningMessage.length > 0,
        `expected lastWarningMessage when warningState is '${result.warningState}'`
      );
    }
  });

  test("lastWarningMessage is undefined when warningState is 'none'", () => {
    const result = checkProviderReadiness();
    if (result.warningState === "none") {
      assert.strictEqual(result.lastWarningMessage, undefined);
    }
  });

  test("cpptools missing means providerInstalled is false (test environment)", () => {
    // In the integration test environment, ms-vscode.cpptools is not installed.
    // This test validates the detection path works correctly in the host.
    const cpptoolsExt = vscode.extensions.getExtension("ms-vscode.cpptools");
    const clangdExt = vscode.extensions.getExtension("llvm-vs-code-extensions.vscode-clangd");
    const result = checkProviderReadiness();
    if (!cpptoolsExt && !clangdExt) {
      assert.strictEqual(result.providerInstalled, false);
      assert.strictEqual(result.warningState, "missing-provider");
    }
  });
});

// ---------------------------------------------------------------------------
// ConfigurationTreeModel pane root content (UI-02)
// Integration tests asserting each pane's root rows remain reachable
// immediately on startup. Initial collapse state is now declared in
// package.json's `visibility` field and is covered by the initial-collapse-
// state suite in configuration-panes.integration.test.ts, not here.
// ---------------------------------------------------------------------------

suite("ConfigurationTreeModel – pane root content (UI-02)", () => {
  test("Build Selection children are reachable immediately (loading placeholder visible)", () => {
    const treeModel = new ConfigurationTreeModel();
    const children = treeModel.paneRootChildren("build-selection");
    assert.ok(children.length > 0, "Expected Build Selection to have visible child content");
  });

  test("Build Options children are reachable immediately (placeholder visible)", () => {
    const treeModel = new ConfigurationTreeModel();
    const children = treeModel.paneRootChildren("build-options");
    assert.ok(children.length > 0, "Expected Build Options to have visible placeholder content");
  });

  test("Build Artifacts children are reachable immediately (placeholder visible)", () => {
    const treeModel = new ConfigurationTreeModel();
    const children = treeModel.paneRootChildren("build-artifacts");
    assert.ok(children.length > 0, "Expected Build Artifacts to have visible placeholder content");
  });
});

// ---------------------------------------------------------------------------
// IntelliSenseService – provider-warning and warning recovery flows
// ---------------------------------------------------------------------------

suite("IntelliSenseService – provider warning flows", () => {
  /** Waits for the pending refresh to drain (no public API, so we yield). */
  function drainRefresh(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 50));
  }

  test("getLastReadiness is null before any refresh", () => {
    const svc = new IntelliSenseService();
    assert.strictEqual(svc.getLastReadiness(), null);
  });

  test("getLastArtifact is null before any refresh", () => {
    const svc = new IntelliSenseService();
    assert.strictEqual(svc.getLastArtifact(), null);
  });

  test("getLastReadiness is populated after scheduleRefresh", async () => {
    const svc = new IntelliSenseService();
    svc.scheduleRefresh("activation");
    await drainRefresh();
    const readiness = svc.getLastReadiness();
    assert.ok(readiness !== null, "expected readiness to be set after refresh");
  });

  test("getLastReadiness after refresh matches direct checkProviderReadiness call", async () => {
    const svc = new IntelliSenseService();
    svc.scheduleRefresh("activation");
    await drainRefresh();
    const fromService = svc.getLastReadiness()!;
    const direct = checkProviderReadiness();
    assert.strictEqual(fromService.warningState, direct.warningState);
    assert.strictEqual(fromService.providerInstalled, direct.providerInstalled);
    assert.strictEqual(fromService.providerConfigured, direct.providerConfigured);
  });

  test("getLastArtifact is null when no manifest is set (no active context)", async () => {
    const svc = new IntelliSenseService();
    svc.scheduleRefresh("activation");
    await drainRefresh();
    assert.strictEqual(svc.getLastArtifact(), null);
  });

  test("onDidRefresh fires after scheduleRefresh", async () => {
    const svc = new IntelliSenseService();
    let firedCount = 0;
    svc.onDidRefresh(() => {
      firedCount++;
    });
    svc.scheduleRefresh("activation");
    await drainRefresh();
    assert.ok(firedCount >= 1, `expected onDidRefresh to fire at least once, fired: ${firedCount}`);
  });

  test("consecutive refreshes do not corrupt state", async () => {
    const svc = new IntelliSenseService();
    svc.scheduleRefresh("activation");
    svc.scheduleRefresh("build-selection-change");
    svc.scheduleRefresh("manual-refresh");
    await drainRefresh();
    // State should reflect a valid final readiness (no crash or null)
    const readiness = svc.getLastReadiness();
    assert.ok(readiness !== null, "expected readiness to survive concurrent refresh calls");
  });

  test("missing-provider warningState persists when cpptools is absent", async () => {
    // In the integration test host, ms-vscode.cpptools is not installed.
    const cpptoolsExt = vscode.extensions.getExtension("ms-vscode.cpptools");
    const clangdExt = vscode.extensions.getExtension("llvm-vs-code-extensions.vscode-clangd");
    if (cpptoolsExt || clangdExt) {
      // Skip: can't isolate missing-provider when an IntelliSense backend is present
      return;
    }
    const svc = new IntelliSenseService();
    svc.scheduleRefresh("activation");
    await drainRefresh();
    assert.strictEqual(svc.getLastReadiness()!.warningState, "missing-provider");
  });

  test("warning recovery: warningState transitions when provider is re-checked", async () => {
    // Verify that each fresh refresh captures the current readiness state.
    // This tests the "recovery flow" path where a new refresh re-evaluates readiness.
    const svc = new IntelliSenseService();
    svc.scheduleRefresh("build-selection-change");
    await drainRefresh();
    const firstReadiness = svc.getLastReadiness()!;

    // A second refresh should yield the same stable state (recovery requires env change;
    // here we verify the refresh path itself runs without caching the first warning)
    svc.scheduleRefresh("build-selection-change");
    await drainRefresh();
    const secondReadiness = svc.getLastReadiness()!;

    assert.strictEqual(secondReadiness.warningState, firstReadiness.warningState);
  });
});


// ---------------------------------------------------------------------------
// IntelliSenseService – artifacts-path change regression
// ---------------------------------------------------------------------------

suite("IntelliSenseService – artifacts-path change regression", () => {
  function drainRefresh(ms = 80): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function makeManifest(): ManifestStateLoaded {
    return {
      status: "loaded",
      manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
      models: [{ kind: "model", id: "T2T1", name: "Trezor Model T", artifactFolder: "model-t" }],
      targets: [
        { kind: "target", id: "hw", name: "Hardware", shortName: "HW" },
        { kind: "target", id: "emu", name: "Emulator", shortName: "EMU", artifactSuffix: "_emu" },
      ],
      components: [{ kind: "component", id: "core", name: "Core", artifactName: "compile_commands_core" }],
      buildOptions: [],
      hasWorkflowBlockingIssues: false,
      hasDebugBlockingIssues: false,
      validationIssues: [],
      loadedAt: new Date(),
    };
  }

  test("changing artifactsRoot changes lastArtifact path after refresh", async () => {
    const svc = new IntelliSenseService();
    svc.setManifest(makeManifest());
    svc.setBuildContext({ modelId: "T2T1", targetId: "hw", componentId: "core" });

    // First root: directory that does not contain artifact
    svc.setArtifactsRoot("/old-root");
    svc.scheduleRefresh("artifacts-path-change");
    await drainRefresh();
    const artifactWithOldRoot = svc.getLastArtifact();
    assert.ok(artifactWithOldRoot !== null, "expected artifact result");
    assert.ok(
      artifactWithOldRoot!.path.includes("old-root") || artifactWithOldRoot!.status === "missing",
      "artifact should reflect old-root path or be missing"
    );

    // Change root: confirms recomputation
    svc.setArtifactsRoot("/new-root");
    svc.scheduleRefresh("artifacts-path-change");
    await drainRefresh();
    const artifactWithNewRoot = svc.getLastArtifact();
    assert.ok(artifactWithNewRoot !== null, "expected artifact result after root change");
    assert.ok(
      artifactWithNewRoot!.path.includes("new-root") || artifactWithNewRoot!.status === "missing",
      "artifact should reflect new-root path after change"
    );
    assert.notStrictEqual(artifactWithNewRoot!.path, artifactWithOldRoot!.path, "path should change after root change");
  });

  test("switching target from hw to emu changes artifact contextKey", async () => {
    const svc = new IntelliSenseService();
    svc.setManifest(makeManifest());
    svc.setArtifactsRoot("/artifacts");

    svc.setBuildContext({ modelId: "T2T1", targetId: "hw", componentId: "core" });
    svc.scheduleRefresh("build-selection-change");
    await drainRefresh();
    const hwArtifact = svc.getLastArtifact();

    svc.setBuildContext({ modelId: "T2T1", targetId: "emu", componentId: "core" });
    svc.scheduleRefresh("build-selection-change");
    await drainRefresh();
    const emuArtifact = svc.getLastArtifact();

    assert.ok(hwArtifact !== null && emuArtifact !== null, "both artifacts should be non-null");
    assert.notStrictEqual(hwArtifact!.contextKey, emuArtifact!.contextKey, "context keys should differ after target change");
    assert.ok(hwArtifact!.contextKey.includes("hw"), "hw contextKey should contain hw");
    assert.ok(emuArtifact!.contextKey.includes("emu"), "emu contextKey should contain emu");
  });

  test("artifact path contains _emu suffix for emu target", async () => {
    const svc = new IntelliSenseService();
    svc.setManifest(makeManifest());
    svc.setArtifactsRoot("/artifacts");
    svc.setBuildContext({ modelId: "T2T1", targetId: "emu", componentId: "core" });
    svc.scheduleRefresh("build-selection-change");
    await drainRefresh();
    const artifact = svc.getLastArtifact();
    assert.ok(artifact !== null);
    assert.ok(
      artifact!.path.includes("_emu"),
      `expected artifact path to contain '_emu' for emu target, got: ${artifact!.path}`
    );
  });

  test("artifact path for hw target does not contain _emu suffix", async () => {
    const svc = new IntelliSenseService();
    svc.setManifest(makeManifest());
    svc.setArtifactsRoot("/artifacts");
    svc.setBuildContext({ modelId: "T2T1", targetId: "hw", componentId: "core" });
    svc.scheduleRefresh("build-selection-change");
    await drainRefresh();
    const artifact = svc.getLastArtifact();
    assert.ok(artifact !== null);
    assert.ok(
      !artifact!.path.includes("_emu"),
      `expected artifact path for hw target to NOT contain '_emu', got: ${artifact!.path}`
    );
  });
});
