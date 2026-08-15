/**
 * Integration tests asserting no cross-slice commands are contributed
 * beyond what is expected in the current slice (Debug Launch / Feature 6).
 *
 * Negative-scope tests: Debug and unrelated commands must not
 * be present. Flash, Upload, openMapFile, and startDebugging are now part of the allowed set.
 */
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  makeDebugLoadedState,
  makeComponentDebugProfile,
  makeDebugTargetWithExtension,
  debugLaunchValidWorkspaceRoot,
  debugLaunchValidTemplatesRoot,
} from "../unit/workflow-test-helpers";
import { executeDebugLaunch } from "../../commands/debug-launch";
import { ManifestStateLoaded } from "../../manifest/manifest-types";
import { TbenchDebugConfigurationProvider, TBENCH_DEBUG_TYPE } from "../../debug/run-debug-provider";
import { makeContextKey } from "../../intellisense/artifact-resolution";

/** Commands that must never be registered in any current slice. */
const BANNED_COMMAND_PATTERNS = [
  /^tbench\.debug\b/i,
  /^tbench\.intellisense\b/i,
];

suite("Scope guard — no cross-slice commands", () => {
  test("package.json does not use eager '*' activation", () => {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    assert.ok(ext, "expected cepetr.tbench extension to be available in the test host");

    const activationEvents = (ext.packageJSON?.activationEvents ?? []) as string[];
    assert.ok(
      !activationEvents.includes("*"),
      "package.json must not use eager '*' activation"
    );
  });

  async function activateExtension(): Promise<void> {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    assert.ok(ext, "expected cepetr.tbench extension to be available in the test host");
    if (!ext.isActive) {
      await ext.activate();
    }
  }

  test("no Debug/IntelliSense commands are registered", async () => {
    await activateExtension();
    const allCommands = await vscode.commands.getCommands(true);
    const offenders = allCommands.filter((cmd) =>
      BANNED_COMMAND_PATTERNS.some((re) => re.test(cmd))
    );
    assert.deepStrictEqual(
      offenders,
      [],
      `Cross-slice commands must not be registered: ${offenders.join(", ")}`
    );
  });

  test("only expected tbench commands are registered", async () => {
    await activateExtension();
    const allCommands = await vscode.commands.getCommands(true);
    // Each contributed view auto-generates its own `<viewId>.focus` and
    // `<viewId>.resetViewLocation` commands; the three configuration panes'
    // ids are host-generated, not contributed, and must be excluded here.
    const VIEW_COMMAND_PREFIXES = [
      "tbench.configuration.",
      "tbench.buildOptions.",
      "tbench.buildArtifacts.",
    ];
    const tfCommands = allCommands
      .filter((cmd) => cmd.startsWith("tbench."))
      .filter((cmd) => !VIEW_COMMAND_PREFIXES.some((prefix) => cmd.startsWith(prefix)));

    // Allowed commands through Debug Launch (Feature 6) and earlier slices
    const ALLOWED = new Set([
      "tbench.showLogs",
      "tbench.selectModel",
      "tbench.selectTarget",
      "tbench.selectComponent",
      "tbench.selectPreset",
      "tbench.build",
      "tbench.clippy",
      "tbench.check",
      "tbench.clean",
      "tbench.toggleBuildOption",
      "tbench.selectBuildOptionState",
      "tbench.refreshIntelliSense",
      "tbench.flash",
      "tbench.upload",
      "tbench.openMapFile",
      "tbench.startDebugging",
    ]);

    const unexpected = tfCommands.filter((cmd) => !ALLOWED.has(cmd));
    assert.deepStrictEqual(
      unexpected,
      [],
      `Unexpected tbench commands found: ${unexpected.join(", ")}`
    );
  });

  test("configuration view header does not expose unnamed Debug actions", async () => {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    if (!ext) {
      return; // Skip gracefully when extension not installed in test host
    }
    const menus: Record<string, unknown[]> =
      ext.packageJSON?.contributes?.menus ?? {};
    const viewTitleMenus: unknown[] = (menus["view/title"] as unknown[]) ?? [];

    // Only tbench.startDebugging is the allowed debug-related header action;
    // any tbench.debug.* commands in the header would be cross-slice
    const BANNED_VIEW_TITLE_COMMANDS = [/^tbench\.debug\b/];
    const offenders = viewTitleMenus.filter((entry) => {
      const e = entry as { command?: string };
      return BANNED_VIEW_TITLE_COMMANDS.some((re) => e.command && re.test(e.command));
    });
    assert.deepStrictEqual(
      offenders,
      [],
      "Cross-slice debug actions must not appear in view/title menus"
    );
  });

  test("configuration view keeps Clippy/Check/Clean out of primary header slots", async () => {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    if (!ext) {
      return;
    }
    const menus: Record<string, unknown[]> =
      ext.packageJSON?.contributes?.menus ?? {};
    const viewTitleMenus = ((menus["view/title"] as Array<{
      command?: string;
      group?: string;
    }>) ?? []);

    const primaryCommands = viewTitleMenus
      .filter((entry) => entry.group?.startsWith("navigation@"))
      .map((entry) => entry.command)
      .filter((command): command is string => Boolean(command));

    assert.ok(!primaryCommands.includes("tbench.clippy"), "tbench.clippy must stay out of the primary header");
    assert.ok(!primaryCommands.includes("tbench.check"), "tbench.check must stay out of the primary header");
    assert.ok(!primaryCommands.includes("tbench.clean"), "tbench.clean must stay out of the primary header");
    assert.ok(!primaryCommands.includes("tbench.flash"), "tbench.flash must stay out of the primary header");
    assert.ok(!primaryCommands.includes("tbench.upload"), "tbench.upload must stay out of the primary header");
  });
});

// ---------------------------------------------------------------------------
// Debug Launch scope boundaries
// ---------------------------------------------------------------------------

suite("Debug Launch scope boundaries", () => {
  function getExtPackageJson(): Record<string, unknown> {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    if (!ext) {
      return {};
    }
    return ext.packageJSON as Record<string, unknown>;
  }

  test("only tbench.startDebugging is the debug-related command in package.json", () => {
    const pkg = getExtPackageJson();
    const commands = (pkg.contributes as { commands?: Array<{ command: string }> } | undefined)
      ?.commands ?? [];
    const debugCommands = commands
      .map((c) => c.command)
      .filter((cmd) => cmd.toLowerCase().includes("debug"));
    assert.deepStrictEqual(
      debugCommands,
      ["tbench.startDebugging"],
      "Only tbench.startDebugging must be contributed as a debug-related command"
    );
  });

  test("tbench.startDebugging has Trezor Bench category and correct title in package.json", () => {
    const pkg = getExtPackageJson();
    const commands = (pkg.contributes as { commands?: Array<{ command: string; title: string; category?: string }> } | undefined)
      ?.commands ?? [];
    const entry = commands.find((c) => c.command === "tbench.startDebugging");
    assert.ok(entry, "expected tbench.startDebugging in package.json commands");
    assert.ok(
      entry.title.includes("Start Debugging") || entry.title.includes("Debug"),
      `expected debug-related title, got: ${entry.title}`
    );
    // Verify it appears in the Trezor Bench category
    assert.strictEqual(entry.category, "Trezor Bench", "startDebugging must use Trezor Bench category");
  });

  test("no tbench.debug.* settings are contributed", () => {
    const pkg = getExtPackageJson();
    const conf = (pkg.contributes as { configuration?: { properties?: Record<string, unknown> } } | undefined)
      ?.configuration;
    const propKeys = Object.keys(conf?.properties ?? {});
    const illegalKeys = propKeys.filter((k) => /^tbench\.debug\./.test(k));
    assert.deepStrictEqual(
      illegalKeys,
      [],
      `Unexpected debug settings contributed: ${illegalKeys.join(", ")}`
    );
  });
});

// ---------------------------------------------------------------------------
// Debug Launch – no launch.json persistence
// ---------------------------------------------------------------------------

suite("Debug Launch – no launch.json persistence", () => {
  function makeExeManifest(): ManifestStateLoaded {
    const entry = makeComponentDebugProfile({ name: "gdb-remote", template: "gdb-remote.json" });
    return makeDebugLoadedState([entry], {
      models: [
        { kind: "model", id: "T2T1", name: "Trezor Model T", artifactFolder: "model-t" } as ManifestStateLoaded["models"][0],
      ],
      targets: [makeDebugTargetWithExtension("hw", ".elf")],
      components: [
        { kind: "component", id: "core", name: "Core", artifactName: "firmware" } as ManifestStateLoaded["components"][0],
      ],
    });
  }

  test("launch.json is absent from fixture workspace before test", () => {
    const workspaceRoot = debugLaunchValidWorkspaceRoot();
    const launchJson = path.join(workspaceRoot, ".vscode", "launch.json");
    assert.ok(
      !fs.existsSync(launchJson),
      `Expected no .vscode/launch.json in debug-launch-valid fixture, found: ${launchJson}`
    );
  });

  test("executeDebugLaunch does not create launch.json in the workspace", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    const launchJson = path.join(workspaceRoot, ".vscode", "launch.json");
    const existed = fs.existsSync(launchJson);

    const manifest = makeExeManifest();
    const config = { modelId: "T2T1", targetId: "hw", componentId: "core", persistedAt: new Date().toISOString() };

    await executeDebugLaunch(workspaceFolder, manifest, config).catch(() => undefined);

    const existsAfter = fs.existsSync(launchJson);
    if (!existed) {
      assert.strictEqual(
        existsAfter,
        false,
        "executeDebugLaunch must not create a .vscode/launch.json file"
      );
    }
  });

  test("provider resolveDebugConfiguration does not create launch.json", () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    const launchJson = path.join(workspaceRoot, ".vscode", "launch.json");
    const existed = fs.existsSync(launchJson);

    const manifest = makeExeManifest();
    const config = { modelId: "T2T1", targetId: "hw", componentId: "core", persistedAt: "" };
    const artifactsRoot = debugLaunchValidWorkspaceRoot();
    const templatesRoot = debugLaunchValidTemplatesRoot();
    const profile = (manifest.components[0].debug ?? [])[0];

    const provider = new TbenchDebugConfigurationProvider(
      () => manifest,
      () => config,
      () => artifactsRoot,
      () => templatesRoot,
      workspaceFolder
    );

    const proxyConfig: vscode.DebugConfiguration = {
      type: TBENCH_DEBUG_TYPE,
      request: "launch",
      name: "Trezor Bench: test",
      tbenchMode: "default",
      tbenchProfileId: profile?.id ?? "",
      tbenchContextKey: makeContextKey(config),
    };

    try {
      provider.resolveDebugConfiguration(workspaceFolder, proxyConfig, new vscode.CancellationTokenSource().token);
    } catch {
      // ignore launch failures
    }

    const existsAfter = fs.existsSync(launchJson);
    if (!existed) {
      assert.strictEqual(
        existsAfter,
        false,
        "provider resolveDebugConfiguration must not create a .vscode/launch.json file"
      );
    }
  });
});

