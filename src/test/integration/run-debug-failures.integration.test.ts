/**
 * Integration tests for blocked availability and provider-launched failure paths.
 *
 * Covers (User Story 3):
 *  - provideDebugConfigurations returns [] when hasDebugBlockingIssues is true.
 *  - provideDebugConfigurations returns [] when no profiles match the active config.
 *  - provideDebugConfigurations returns [] when the executable artifact is missing.
 *  - resolveDebugConfiguration returns undefined for a proxy config whose
 *    tbenchContextKey is stale (no longer matches the current active config).
 *  - resolveDebugConfiguration returns undefined when the debug template is missing.
 *  - resolveDebugConfiguration returns undefined when the debug template is invalid.
 *  - resolveDebugConfiguration returns undefined when the template path escapes root.
 *  - resolveDebugConfiguration returns undefined when the resolved profile is no
 *    longer present in the manifest.
 */

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  RunDebugConfigProvider,
  TBENCH_DEBUG_TYPE,
  generateDebugConfigurations,
} from "../../debug/run-debug-provider";
import {
  makeComponentDebugProfile,
  makeIntelliSenseLoadedState,
  debugLaunchValidTemplatesRoot,
  debugLaunchFailuresWorkspaceRoot,
} from "../unit/workflow-test-helpers";
import { ManifestStateLoaded, ManifestComponentDebugProfile } from "../../manifest/manifest-types";
import { makeContextKey } from "../../build/artifact-resolution";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(modelId: string, targetId = "hw", componentId = "core") {
  return { modelId, targetId, componentId, persistedAt: "" };
}

function makeExeManifest(
  profiles: ManifestComponentDebugProfile[] = [],
  overrides: Partial<ManifestStateLoaded> = {}
): ManifestStateLoaded {
  return makeIntelliSenseLoadedState({
    targets: [{
      kind: "target",
      id: "hw",
      name: "Hardware",
      shortName: "HW",
      executableExtension: ".elf",
    } as ManifestStateLoaded["targets"][0]],
    components: [{
      kind: "component",
      id: "core",
      name: "Core",
      artifactName: "firmware",
      debug: profiles,
    } as ManifestStateLoaded["components"][0]],
    hasDebugBlockingIssues: false,
    ...overrides,
  });
}

function makeWorkspaceFolder(folderPath: string): vscode.WorkspaceFolder {
  return { uri: vscode.Uri.file(folderPath), name: "test", index: 0 };
}

function makeCancelToken(): vscode.CancellationToken {
  return new vscode.CancellationTokenSource().token;
}

// ---------------------------------------------------------------------------
// Suite: provideDebugConfigurations – blocked/empty availability
// ---------------------------------------------------------------------------

suite("RunDebugConfigProvider – provideDebugConfigurations blocked", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-fail-provide-"));
    fs.mkdirSync(path.join(tmpDir, "model-t"), { recursive: true });
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns [] when hasDebugBlockingIssues is true", () => {
    const profile = makeComponentDebugProfile({
      name: "GDB Remote",
      template: "gdb-remote.json",
      componentId: "core",
    });
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeExeManifest([profile], { hasDebugBlockingIssues: true });
    const config = makeConfig("T2T1");
    const folder = makeWorkspaceFolder(tmpDir);

    const provider = new RunDebugConfigProvider(
      () => manifest,
      () => config,
      () => tmpDir,
      () => debugLaunchValidTemplatesRoot(),
      folder
    );

    const result = provider.provideDebugConfigurations(folder, makeCancelToken());
    assert.deepStrictEqual(result, []);
  });

  test("returns [] when no debug profiles match the active config", () => {
    const profile = makeComponentDebugProfile({
      name: "GDB Remote",
      template: "gdb-remote.json",
      componentId: "core",
      when: { type: "model", id: "T3W1" }, // won't match T2T1
    });
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeExeManifest([profile]);
    const config = makeConfig("T2T1");
    const folder = makeWorkspaceFolder(tmpDir);

    const provider = new RunDebugConfigProvider(
      () => manifest,
      () => config,
      () => tmpDir,
      () => debugLaunchValidTemplatesRoot(),
      folder
    );

    const result = provider.provideDebugConfigurations(folder, makeCancelToken());
    assert.deepStrictEqual(result, []);
  });

  test("returns [] when the executable artifact is missing", () => {
    const profile = makeComponentDebugProfile({
      name: "GDB Remote",
      template: "gdb-remote.json",
      componentId: "core",
    });
    // No exe file created
    const manifest = makeExeManifest([profile]);
    const config = makeConfig("T2T1");
    const folder = makeWorkspaceFolder(tmpDir);

    const provider = new RunDebugConfigProvider(
      () => manifest,
      () => config,
      () => tmpDir,
      () => debugLaunchValidTemplatesRoot(),
      folder
    );

    const result = provider.provideDebugConfigurations(folder, makeCancelToken());
    assert.deepStrictEqual(result, []);
  });

  test("generateDebugConfigurations also returns [] under blocking issues (direct call)", () => {
    const profile = makeComponentDebugProfile({
      name: "GDB Remote",
      template: "gdb-remote.json",
      componentId: "core",
    });
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeExeManifest([profile], { hasDebugBlockingIssues: true });
    const config = makeConfig("T2T1");

    const entries = generateDebugConfigurations(manifest, config, tmpDir);
    assert.strictEqual(entries.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Suite: resolveDebugConfiguration – failure paths
// ---------------------------------------------------------------------------

suite("RunDebugConfigProvider – resolveDebugConfiguration failures", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-fail-resolve-"));
    fs.mkdirSync(path.join(tmpDir, "model-t"), { recursive: true });
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns undefined when tbenchContextKey is stale", () => {
    const profile = makeComponentDebugProfile({
      name: "GDB Remote",
      template: "gdb-remote.json",
      componentId: "core",
    });
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeExeManifest([profile]);
    const currentConfig = makeConfig("T2T1");
    const folder = makeWorkspaceFolder(tmpDir);

    const provider = new RunDebugConfigProvider(
      () => manifest,
      () => currentConfig,
      () => tmpDir,
      () => debugLaunchValidTemplatesRoot(),
      folder
    );

    const staleProxy: vscode.DebugConfiguration = {
      type: TBENCH_DEBUG_TYPE,
      request: "launch",
      name: "Trezor Bench: stale",
      tbenchMode: "default",
      tbenchProfileId: profile.id,
      tbenchContextKey: "T3W1::hw::core", // different from T2T1::hw::core
    };

    const result = provider.resolveDebugConfiguration(folder, staleProxy, makeCancelToken());
    assert.strictEqual(result, undefined);
  });

  test("returns undefined when the debug template is missing", () => {
    const profile = makeComponentDebugProfile({
      name: "GDB Remote",
      template: "nonexistent-template.json",
      componentId: "core",
    });
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeExeManifest([profile]);
    const config = makeConfig("T2T1");
    const folder = makeWorkspaceFolder(tmpDir);

    const provider = new RunDebugConfigProvider(
      () => manifest,
      () => config,
      () => tmpDir,
      () => debugLaunchValidTemplatesRoot(),
      folder
    );

    const proxy: vscode.DebugConfiguration = {
      type: TBENCH_DEBUG_TYPE,
      request: "launch",
      name: "Trezor Bench: test",
      tbenchMode: "default",
      tbenchProfileId: profile.id,
      tbenchContextKey: makeContextKey(config),
    };

    const result = provider.resolveDebugConfiguration(folder, proxy, makeCancelToken());
    assert.strictEqual(result, undefined);
  });

  test("returns undefined when the debug template is malformed JSON", () => {
    const profile = makeComponentDebugProfile({
      name: "GDB Remote",
      template: "malformed-template.json",
      componentId: "core",
    });
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeExeManifest([profile]);
    const config = makeConfig("T2T1");
    const folder = makeWorkspaceFolder(tmpDir);
    const failuresTemplatesRoot = path.join(debugLaunchFailuresWorkspaceRoot(), "debug-templates");

    const provider = new RunDebugConfigProvider(
      () => manifest,
      () => config,
      () => tmpDir,
      () => failuresTemplatesRoot,
      folder
    );

    const proxy: vscode.DebugConfiguration = {
      type: TBENCH_DEBUG_TYPE,
      request: "launch",
      name: "Trezor Bench: test",
      tbenchMode: "default",
      tbenchProfileId: profile.id,
      tbenchContextKey: makeContextKey(config),
    };

    const result = provider.resolveDebugConfiguration(folder, proxy, makeCancelToken());
    assert.strictEqual(result, undefined);
  });

  test("returns undefined when the template path escapes the templates root", () => {
    const profile = makeComponentDebugProfile({
      name: "GDB Remote",
      template: "../../../etc/passwd",
      componentId: "core",
    });
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeExeManifest([profile]);
    const config = makeConfig("T2T1");
    const folder = makeWorkspaceFolder(tmpDir);

    const provider = new RunDebugConfigProvider(
      () => manifest,
      () => config,
      () => tmpDir,
      () => debugLaunchValidTemplatesRoot(),
      folder
    );

    const proxy: vscode.DebugConfiguration = {
      type: TBENCH_DEBUG_TYPE,
      request: "launch",
      name: "Trezor Bench: test",
      tbenchMode: "default",
      tbenchProfileId: profile.id,
      tbenchContextKey: makeContextKey(config),
    };

    const result = provider.resolveDebugConfiguration(folder, proxy, makeCancelToken());
    assert.strictEqual(result, undefined);
  });

  test("returns undefined when the profile is no longer present in the manifest", () => {
    const profile = makeComponentDebugProfile({
      name: "GDB Remote",
      template: "gdb-remote.json",
      componentId: "core",
    });
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");

    // Manifest with no debug profiles at all
    const manifestNoProfiles = makeExeManifest([]);
    const config = makeConfig("T2T1");
    const folder = makeWorkspaceFolder(tmpDir);

    const provider = new RunDebugConfigProvider(
      () => manifestNoProfiles,
      () => config,
      () => tmpDir,
      () => debugLaunchValidTemplatesRoot(),
      folder
    );

    const proxy: vscode.DebugConfiguration = {
      type: TBENCH_DEBUG_TYPE,
      request: "launch",
      name: "Trezor Bench: test",
      tbenchMode: "default",
      tbenchProfileId: profile.id, // profile ID from a former manifest state
      tbenchContextKey: makeContextKey(config),
    };

    const result = provider.resolveDebugConfiguration(folder, proxy, makeCancelToken());
    // resolveDebugConfiguration will fail to find a matching profile → undefined
    assert.strictEqual(result, undefined);
  });

  test("passes through non-tbench configs unchanged", () => {
    const folder = makeWorkspaceFolder(tmpDir);
    const provider = new RunDebugConfigProvider(
      () => undefined,
      () => undefined,
      () => tmpDir,
      () => debugLaunchValidTemplatesRoot(),
      folder
    );

    const nonProxy: vscode.DebugConfiguration = {
      type: "cppdbg",
      request: "launch",
      name: "C/C++ debugger",
    };

    const result = provider.resolveDebugConfiguration(folder, nonProxy, makeCancelToken());
    assert.strictEqual(result, nonProxy);
  });
});
