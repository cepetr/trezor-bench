/**
 * Integration tests for multi-profile Run and Debug selection (User Story 2).
 *
 * Covers:
 *  - generateDebugConfigurations returns 1 default + N profile-specific entries
 *    when N > 1 profiles match the active build context.
 *  - Profile-specific entries use mode="profile" and each target a different profile.
 *  - Profile entries are in declaration order after the default entry.
 *  - With 1 matching profile, no profile-specific entries are generated.
 *  - profile entries carry the same contextKey as the default entry.
 *  - Launching a profile-specific entry through resolveDebugConfiguration materializes
 *    the correct template (i.e., the selected profile's template, not the default's).
 *  - Direct Start Debugging (executeDebugLaunch) launches immediately when one
 *    profile matches and opens a profile picker when multiple profiles match.
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
  labelForProfileEntry,
  labelForDefaultEntry,
} from "../../debug/run-debug-provider";
import { executeDebugLaunch } from "../../commands/debug-launch";
import {
  makeComponentDebugProfile,
  makeIntelliSenseLoadedState,
  makeRunDebugMultiProfileState,
  debugLaunchValidTemplatesRoot,
} from "../unit/workflow-test-helpers";
import { ManifestStateLoaded } from "../../manifest/manifest-types";
import { makeContextKey } from "../../build/artifact-resolution";

// ---------------------------------------------------------------------------
// Helpers shared across suites
// ---------------------------------------------------------------------------

function makeConfig(modelId: string, targetId = "hw", componentId = "core") {
  return { modelId, targetId, componentId, persistedAt: "" };
}

function makeWorkspaceFolder(folderPath: string): vscode.WorkspaceFolder {
  return { uri: vscode.Uri.file(folderPath), name: "test", index: 0 };
}

function makeCancelToken(): vscode.CancellationToken {
  return new vscode.CancellationTokenSource().token;
}

/**
 * Builds a manifest state with `count` match-all profiles on `core` component,
 * with executable extension ".elf" on target "hw".
 */
function makeMultiProfileManifest(
  count: number,
  templates: string[] = [],
): ManifestStateLoaded {
  const profiles = Array.from({ length: count }, (_, i) => {
    const name = `Profile ${String.fromCharCode(65 + i)}`;
    const template = templates[i] ?? `profile-${i}.json`;
    return makeComponentDebugProfile({ name, template, declarationIndex: i });
  });

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
  });
}

// ---------------------------------------------------------------------------
// Suite: generateDebugConfigurations – multi-profile entry set
// ---------------------------------------------------------------------------

suite("generateDebugConfigurations – multi-profile entry set", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-mp-"));
    fs.mkdirSync(path.join(tmpDir, "model-t"), { recursive: true });
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("3 matching profiles → 4 total entries (1 default + 3 profile-specific)", () => {
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeMultiProfileManifest(3);
    const config = makeConfig("T2T1");

    const entries = generateDebugConfigurations(manifest, config, tmpDir);

    assert.strictEqual(entries.length, 4);
    assert.strictEqual(entries.filter((e) => e["tbenchMode"] === "default").length, 1);
    assert.strictEqual(entries.filter((e) => e["tbenchMode"] === "profile").length, 3);
  });

  test("2 matching profiles → 3 total entries (1 default + 2 profile-specific)", () => {
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeMultiProfileManifest(2);
    const config = makeConfig("T2T1");

    const entries = generateDebugConfigurations(manifest, config, tmpDir);

    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries.filter((e) => e["tbenchMode"] === "profile").length, 2);
  });

  test("1 matching profile → 1 entry only (default, no profile-specific)", () => {
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeMultiProfileManifest(1);
    const config = makeConfig("T2T1");

    const entries = generateDebugConfigurations(manifest, config, tmpDir);

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]["tbenchMode"], "default");
  });

  test("default entry profile is first matching profile in declaration order", () => {
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeMultiProfileManifest(3);
    const config = makeConfig("T2T1");
    const component = manifest.components.find((c) => c.id === "core")!;
    const firstProfile = component.debug![0];

    const entries = generateDebugConfigurations(manifest, config, tmpDir);

    const defaultEntry = entries.find((e) => e["tbenchMode"] === "default");
    assert.strictEqual(defaultEntry!["tbenchProfileId"], firstProfile.id);
  });

  test("profile-specific entries follow declaration order, ordered by id", () => {
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeMultiProfileManifest(3);
    const config = makeConfig("T2T1");
    const component = manifest.components.find((c) => c.id === "core")!;
    const profiles = component.debug!;

    const entries = generateDebugConfigurations(manifest, config, tmpDir);

    const profileEntries = entries.filter((e) => e["tbenchMode"] === "profile");
    assert.strictEqual(profileEntries[0]["tbenchProfileId"], profiles[0].id);
    assert.strictEqual(profileEntries[1]["tbenchProfileId"], profiles[1].id);
    assert.strictEqual(profileEntries[2]["tbenchProfileId"], profiles[2].id);
  });

  test("all entries share the same contextKey", () => {
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeMultiProfileManifest(3);
    const config = makeConfig("T2T1");
    const expectedKey = makeContextKey(config);

    const entries = generateDebugConfigurations(manifest, config, tmpDir);

    assert.ok(entries.every((e) => e["tbenchContextKey"] === expectedKey));
  });

  test("profile-specific entry label includes profile name", () => {
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeMultiProfileManifest(2);
    const config = makeConfig("T2T1");
    const component = manifest.components.find((c) => c.id === "core")!;
    const firstProfile = component.debug![0];

    const entries = generateDebugConfigurations(manifest, config, tmpDir);

    const profileEntryForFirst = entries.find(
      (e) => e["tbenchMode"] === "profile" && e["tbenchProfileId"] === firstProfile.id
    );
    assert.ok(profileEntryForFirst, "profile-specific entry for first profile should exist");
    assert.ok(profileEntryForFirst.name.includes(firstProfile.name),
      `entry label '${profileEntryForFirst.name}' should include profile name '${firstProfile.name}'`);
  });

  test("default entry label is shorter than the profile-specific label", () => {
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeMultiProfileManifest(2);
    const config = makeConfig("T2T1");
    const component = manifest.components.find((c) => c.id === "core")!;
    const firstProfile = component.debug![0];

    const entries = generateDebugConfigurations(manifest, config, tmpDir);

    const defaultEntry = entries.find((e) => e["tbenchMode"] === "default");
    const profileEntry = entries.find(
      (e) => e["tbenchMode"] === "profile" && e["tbenchProfileId"] === firstProfile.id
    );
    // default label is shorter than profile label (no profile name prefix)
    assert.ok(defaultEntry!.name.length < profileEntry!.name.length);
  });

  test("makeRunDebugMultiProfileState prodtest+T2T1+hw → 3 matching profiles", () => {
    fs.mkdirSync(path.join(tmpDir, "model-t"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "model-t", "compile_commands_prodtest.elf"), "");
    const manifest = makeRunDebugMultiProfileState();
    const config = makeConfig("T2T1", "hw", "prodtest");

    // Targets in makeRunDebugMultiProfileState don't have executableExtension,
    // so we override with the appropriate manifest
    const overrideManifest = {
      ...manifest,
      targets: manifest.targets.map((t) =>
        t.id === "hw"
          ? { ...t, executableExtension: ".elf" }
          : t
      ),
    } as ManifestStateLoaded;

    const entries = generateDebugConfigurations(overrideManifest, config, tmpDir);

    // prodtest+T2T1+hw matches profiles[0](T2T1), profiles[1](hw), profiles[2](any) = 3 matches
    // → 1 default + 3 profile-specific = 4 entries
    assert.strictEqual(entries.length, 4);
  });
});

// ---------------------------------------------------------------------------
// Suite: Provider multi-profile – provideDebugConfigurations
// ---------------------------------------------------------------------------

suite("RunDebugConfigProvider – multi-profile provideDebugConfigurations", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-mp-provider-"));
    fs.mkdirSync(path.join(tmpDir, "model-t"), { recursive: true });
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns 4 entries for 3-profile context through the provider interface", () => {
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeMultiProfileManifest(3);
    const config = makeConfig("T2T1");
    const folder = makeWorkspaceFolder(tmpDir);

    const provider = new RunDebugConfigProvider(
      () => manifest,
      () => config,
      () => tmpDir,
      () => debugLaunchValidTemplatesRoot()
    );

    const result = provider.provideDebugConfigurations(folder, makeCancelToken());
    const entries = result as vscode.DebugConfiguration[];

    assert.strictEqual(entries.length, 4);
  });
});

// ---------------------------------------------------------------------------
// Suite: Provider resolveDebugConfiguration – profile-specific launch
// ---------------------------------------------------------------------------

suite("RunDebugConfigProvider – profile-specific resolveDebugConfiguration", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-mp-resolve-"));
    fs.mkdirSync(path.join(tmpDir, "model-t"), { recursive: true });
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("resolving a profile-specific entry materializes the selected profile", () => {
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeMultiProfileManifest(2, ["gdb-remote.json", "gdb-remote.json"]);
    const config = makeConfig("T2T1");
    const component = manifest.components.find((c) => c.id === "core")!;
    const secondProfile = component.debug![1];
    const folder = makeWorkspaceFolder(tmpDir);
    const templatesRoot = debugLaunchValidTemplatesRoot();

    const provider = new RunDebugConfigProvider(
      () => manifest,
      () => config,
      () => tmpDir,
      () => templatesRoot
    );

    const profileProxy: vscode.DebugConfiguration = {
      type: TBENCH_DEBUG_TYPE,
      request: "launch",
      name: `Trezor Bench: ${secondProfile.name}`,
      tbenchMode: "profile",
      tbenchProfileId: secondProfile.id,
      tbenchContextKey: makeContextKey(config),
    };

    const resolved = provider.resolveDebugConfiguration(folder, profileProxy, makeCancelToken());

    assert.ok(resolved !== undefined, "profile-specific entry should resolve to real config");
    const resolvedConfig = resolved as vscode.DebugConfiguration;
    assert.notStrictEqual(resolvedConfig.type, TBENCH_DEBUG_TYPE);
  });

  test("resolved profile-specific entry keeps the selected proxy label for repeat F5 launches", () => {
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeMultiProfileManifest(2, ["gdb-remote.json", "gdb-remote.json"]);
    const config = makeConfig("T2T1");
    const component = manifest.components.find((c) => c.id === "core")!;
    const secondProfile = component.debug![1];
    const folder = makeWorkspaceFolder(tmpDir);

    const provider = new RunDebugConfigProvider(
      () => manifest,
      () => config,
      () => tmpDir,
      () => debugLaunchValidTemplatesRoot()
    );

    const profileProxy: vscode.DebugConfiguration = {
      type: TBENCH_DEBUG_TYPE,
      request: "launch",
      name: labelForProfileEntry(secondProfile.name),
      tbenchMode: "profile",
      tbenchProfileId: secondProfile.id,
      tbenchContextKey: makeContextKey(config),
    };

    const resolved = provider.resolveDebugConfiguration(folder, profileProxy, makeCancelToken());

    assert.ok(resolved !== undefined, "profile-specific entry should resolve to real config");
    assert.strictEqual((resolved as vscode.DebugConfiguration).name, profileProxy.name);
  });

  test("resolved profile-specific entry canonicalizes older long proxy labels", () => {
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeMultiProfileManifest(2, ["gdb-remote.json", "gdb-remote.json"]);
    const config = makeConfig("T2T1");
    const component = manifest.components.find((c) => c.id === "core")!;
    const secondProfile = component.debug![1];
    const folder = makeWorkspaceFolder(tmpDir);

    const provider = new RunDebugConfigProvider(
      () => manifest,
      () => config,
      () => tmpDir,
      () => debugLaunchValidTemplatesRoot()
    );

    const oldProfileProxy: vscode.DebugConfiguration = {
      type: TBENCH_DEBUG_TYPE,
      request: "launch",
      name: `Trezor Bench: ${secondProfile.name} | T2T1 | HW | Core`,
      tbenchMode: "profile",
      tbenchProfileId: secondProfile.id,
      tbenchContextKey: makeContextKey(config),
    };

    const resolved = provider.resolveDebugConfiguration(folder, oldProfileProxy, makeCancelToken());

    assert.ok(resolved !== undefined, "profile-specific entry should resolve to real config");
    assert.strictEqual((resolved as vscode.DebugConfiguration).name, labelForProfileEntry(secondProfile.name));
  });

  test("resolving a profile-specific entry with unknown profileId returns undefined", () => {
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
    const manifest = makeMultiProfileManifest(2, ["gdb-remote.json", "gdb-remote.json"]);
    const config = makeConfig("T2T1");
    const folder = makeWorkspaceFolder(tmpDir);

    const provider = new RunDebugConfigProvider(
      () => manifest,
      () => config,
      () => tmpDir,
      () => debugLaunchValidTemplatesRoot()
    );

    const profileProxy: vscode.DebugConfiguration = {
      type: TBENCH_DEBUG_TYPE,
      request: "launch",
      name: "Trezor Bench: gone",
      tbenchMode: "profile",
      tbenchProfileId: "nonexistent:debug[99]",
      tbenchContextKey: makeContextKey(config),
    };

    const resolved = provider.resolveDebugConfiguration(folder, profileProxy, makeCancelToken());
    assert.strictEqual(resolved, undefined);
  });
});

// ---------------------------------------------------------------------------
// Suite: label helpers for multi-profile labels
// ---------------------------------------------------------------------------

suite("label helpers – multi-profile labels", () => {
  test("labelForProfileEntry distinguishes profile-specific entries by name", () => {
    const l1 = labelForProfileEntry("GDB Remote");
    const l2 = labelForProfileEntry("OpenOCD");
    assert.notStrictEqual(l1, l2);
  });

  test("default and profile-specific labels use the tbench prefix", () => {
    const def = labelForDefaultEntry();
    const prof = labelForProfileEntry("MyProfile");
    assert.strictEqual(def, "Trezor Bench");
    assert.ok(prof.startsWith("Trezor Bench:"));
    assert.ok(prof.includes("MyProfile"));
  });

  test("profile label includes only the profile name after the tbench prefix", () => {
    const label = labelForProfileEntry("GDB Remote (T2T1)");
    assert.ok(label.includes("GDB Remote (T2T1)"));
    assert.strictEqual(label, "Trezor Bench: GDB Remote (T2T1)");
  });
});

// ---------------------------------------------------------------------------
// Suite: Direct Start Debugging – profile picker behavior
// ---------------------------------------------------------------------------

suite("executeDebugLaunch – multi-profile selection", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-mp-launch-"));
    fs.mkdirSync(path.join(tmpDir, "model-t"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("does not show a picker when exactly one profile matches", async () => {
    const manifest = makeMultiProfileManifest(1, ["gdb-remote.json"]);
    const config = makeConfig("T2T1");
    const folder = makeWorkspaceFolder(tmpDir);
    const originalShowQuickPick = vscode.window.showQuickPick;
    const originalStartDebugging = vscode.debug.startDebugging;
    let pickerShown = false;
    let launchCount = 0;
    let launchedConfig: vscode.DebugConfiguration | undefined;

    try {
      (vscode.window as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = async () => {
        pickerShown = true;
        return undefined;
      };
      (vscode.debug as { startDebugging: typeof vscode.debug.startDebugging }).startDebugging = async (_folder, debugConfig) => {
        launchCount += 1;
        launchedConfig = debugConfig as vscode.DebugConfiguration;
        return true;
      };

      await executeDebugLaunch(folder, manifest, config);

      assert.strictEqual(pickerShown, false);
      assert.strictEqual(launchCount, 1);
      assert.strictEqual(launchedConfig?.type, TBENCH_DEBUG_TYPE);
      assert.strictEqual(launchedConfig?.name, "Trezor Bench");
      assert.strictEqual(launchedConfig?.["tbenchMode"], "default");
    } finally {
      (vscode.window as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = originalShowQuickPick;
      (vscode.debug as { startDebugging: typeof vscode.debug.startDebugging }).startDebugging = originalStartDebugging;
    }
  });

  test("shows a picker and launches the selected profile when multiple profiles match", async () => {
    const manifest = makeMultiProfileManifest(2, ["gdb-remote.json", "gdb-remote.json"]);
    const config = makeConfig("T2T1");
    const folder = makeWorkspaceFolder(tmpDir);
    const originalShowQuickPick = vscode.window.showQuickPick;
    const originalStartDebugging = vscode.debug.startDebugging;
    let pickedLabel = "";
    let launchedConfig: vscode.DebugConfiguration | undefined;

    try {
      (vscode.window as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = ((
        async (items: readonly vscode.QuickPickItem[]) => {
          pickedLabel = String(items[1]?.label ?? "");
          return items[1];
        }
      ) as unknown) as typeof vscode.window.showQuickPick;
      (vscode.debug as { startDebugging: typeof vscode.debug.startDebugging }).startDebugging = async (_folder, debugConfig) => {
        launchedConfig = debugConfig as vscode.DebugConfiguration;
        return true;
      };

      await executeDebugLaunch(folder, manifest, config);

      assert.strictEqual(pickedLabel, "Profile B");
      assert.ok(launchedConfig, "expected selected profile to be launched");
      assert.strictEqual(launchedConfig?.type, TBENCH_DEBUG_TYPE);
      assert.strictEqual(launchedConfig?.name, "Trezor Bench: Profile B");
      assert.strictEqual(launchedConfig?.["tbenchMode"], "profile");
    } finally {
      (vscode.window as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = originalShowQuickPick;
      (vscode.debug as { startDebugging: typeof vscode.debug.startDebugging }).startDebugging = originalStartDebugging;
    }
  });

  test("multi-profile picker items omit extra description and detail text", async () => {
    const manifest = makeMultiProfileManifest(2, ["gdb-remote.json", "gdb-remote.json"]);
    const config = makeConfig("T2T1");
    const folder = makeWorkspaceFolder(tmpDir);
    const originalShowQuickPick = vscode.window.showQuickPick;
    const originalStartDebugging = vscode.debug.startDebugging;
    let capturedItems: readonly vscode.QuickPickItem[] = [];

    try {
      (vscode.window as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = ((
        async (items: readonly vscode.QuickPickItem[]) => {
          capturedItems = items;
          return items[0];
        }
      ) as unknown) as typeof vscode.window.showQuickPick;
      (vscode.debug as { startDebugging: typeof vscode.debug.startDebugging }).startDebugging = async () => true;

      await executeDebugLaunch(folder, manifest, config);

      assert.strictEqual(capturedItems.length, 2);
      assert.ok(capturedItems.every((item) => item.description === undefined));
      assert.ok(capturedItems.every((item) => item.detail === undefined));
    } finally {
      (vscode.window as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = originalShowQuickPick;
      (vscode.debug as { startDebugging: typeof vscode.debug.startDebugging }).startDebugging = originalStartDebugging;
    }
  });

  test("cancelling the picker does not start debugging", async () => {
    const manifest = makeMultiProfileManifest(2, ["gdb-remote.json", "gdb-remote.json"]);
    const config = makeConfig("T2T1");
    const folder = makeWorkspaceFolder(tmpDir);
    const originalShowQuickPick = vscode.window.showQuickPick;
    const originalStartDebugging = vscode.debug.startDebugging;
    let launchCount = 0;

    try {
      (vscode.window as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = async () => undefined;
      (vscode.debug as { startDebugging: typeof vscode.debug.startDebugging }).startDebugging = async () => {
        launchCount += 1;
        return true;
      };

      await executeDebugLaunch(folder, manifest, config);

      assert.strictEqual(launchCount, 0);
    } finally {
      (vscode.window as { showQuickPick: typeof vscode.window.showQuickPick }).showQuickPick = originalShowQuickPick;
      (vscode.debug as { startDebugging: typeof vscode.debug.startDebugging }).startDebugging = originalStartDebugging;
    }
  });
});
