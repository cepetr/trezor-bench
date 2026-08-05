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
import { TfToolsDebugConfigurationProvider, TFTOOLS_DEBUG_TYPE } from "../../debug/run-debug-provider";
import { makeContextKey } from "../../intellisense/artifact-resolution";

/** Commands that must never be registered in any current slice. */
const BANNED_COMMAND_PATTERNS = [
  /^tfTools\.debug\b/i,
  /^tfTools\.intellisense\b/i,
];

suite("Scope guard — no cross-slice commands", () => {
  test("package.json does not use eager '*' activation", () => {
    const ext = vscode.extensions.getExtension("cepetr.tf-tools");
    assert.ok(ext, "expected cepetr.tf-tools extension to be available in the test host");

    const activationEvents = (ext.packageJSON?.activationEvents ?? []) as string[];
    assert.ok(
      !activationEvents.includes("*"),
      "package.json must not use eager '*' activation"
    );
  });

  async function activateExtension(): Promise<void> {
    const ext = vscode.extensions.getExtension("cepetr.tf-tools");
    assert.ok(ext, "expected cepetr.tf-tools extension to be available in the test host");
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

  test("only expected tfTools commands are registered", async () => {
    await activateExtension();
    const allCommands = await vscode.commands.getCommands(true);
    // Each contributed view auto-generates its own `<viewId>.focus` and
    // `<viewId>.resetViewLocation` commands; the three configuration panes'
    // ids are host-generated, not contributed, and must be excluded here.
    const VIEW_COMMAND_PREFIXES = [
      "tfTools.configuration.",
      "tfTools.buildOptions.",
      "tfTools.buildArtifacts.",
    ];
    const tfCommands = allCommands
      .filter((cmd) => cmd.startsWith("tfTools."))
      .filter((cmd) => !VIEW_COMMAND_PREFIXES.some((prefix) => cmd.startsWith(prefix)));

    // Allowed commands through Debug Launch (Feature 6) and earlier slices
    const ALLOWED = new Set([
      "tfTools.showLogs",
      "tfTools.selectModel",
      "tfTools.selectTarget",
      "tfTools.selectComponent",
      "tfTools.selectPreset",
      "tfTools.build",
      "tfTools.clippy",
      "tfTools.check",
      "tfTools.clean",
      "tfTools.toggleBuildOption",
      "tfTools.selectBuildOptionState",
      "tfTools.refreshIntelliSense",
      "tfTools.flash",
      "tfTools.upload",
      "tfTools.openMapFile",
      "tfTools.startDebugging",
    ]);

    const unexpected = tfCommands.filter((cmd) => !ALLOWED.has(cmd));
    assert.deepStrictEqual(
      unexpected,
      [],
      `Unexpected tfTools commands found: ${unexpected.join(", ")}`
    );
  });

  test("configuration view header does not expose unnamed Debug actions", async () => {
    const ext = vscode.extensions.getExtension("cepetr.tf-tools");
    if (!ext) {
      return; // Skip gracefully when extension not installed in test host
    }
    const menus: Record<string, unknown[]> =
      ext.packageJSON?.contributes?.menus ?? {};
    const viewTitleMenus: unknown[] = (menus["view/title"] as unknown[]) ?? [];

    // Only tfTools.startDebugging is the allowed debug-related header action;
    // any tfTools.debug.* commands in the header would be cross-slice
    const BANNED_VIEW_TITLE_COMMANDS = [/^tfTools\.debug\b/];
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
    const ext = vscode.extensions.getExtension("cepetr.tf-tools");
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

    assert.ok(!primaryCommands.includes("tfTools.clippy"), "tfTools.clippy must stay out of the primary header");
    assert.ok(!primaryCommands.includes("tfTools.check"), "tfTools.check must stay out of the primary header");
    assert.ok(!primaryCommands.includes("tfTools.clean"), "tfTools.clean must stay out of the primary header");
    assert.ok(!primaryCommands.includes("tfTools.flash"), "tfTools.flash must stay out of the primary header");
    assert.ok(!primaryCommands.includes("tfTools.upload"), "tfTools.upload must stay out of the primary header");
  });
});

// ---------------------------------------------------------------------------
// Debug Launch scope boundaries
// ---------------------------------------------------------------------------

suite("Debug Launch scope boundaries", () => {
  function getExtPackageJson(): Record<string, unknown> {
    const ext = vscode.extensions.getExtension("cepetr.tf-tools");
    if (!ext) {
      return {};
    }
    return ext.packageJSON as Record<string, unknown>;
  }

  test("only tfTools.startDebugging is the debug-related command in package.json", () => {
    const pkg = getExtPackageJson();
    const commands = (pkg.contributes as { commands?: Array<{ command: string }> } | undefined)
      ?.commands ?? [];
    const debugCommands = commands
      .map((c) => c.command)
      .filter((cmd) => cmd.toLowerCase().includes("debug"));
    assert.deepStrictEqual(
      debugCommands,
      ["tfTools.startDebugging"],
      "Only tfTools.startDebugging must be contributed as a debug-related command"
    );
  });

  test("tfTools.startDebugging has Trezor category and correct title in package.json", () => {
    const pkg = getExtPackageJson();
    const commands = (pkg.contributes as { commands?: Array<{ command: string; title: string; category?: string }> } | undefined)
      ?.commands ?? [];
    const entry = commands.find((c) => c.command === "tfTools.startDebugging");
    assert.ok(entry, "expected tfTools.startDebugging in package.json commands");
    assert.ok(
      entry.title.includes("Start Debugging") || entry.title.includes("Debug"),
      `expected debug-related title, got: ${entry.title}`
    );
    // Verify it appears in the Trezor category
    assert.strictEqual(entry.category, "Trezor", "startDebugging must use Trezor category");
  });

  test("no tfTools.debug.* settings are contributed", () => {
    const pkg = getExtPackageJson();
    const conf = (pkg.contributes as { configuration?: { properties?: Record<string, unknown> } } | undefined)
      ?.configuration;
    const propKeys = Object.keys(conf?.properties ?? {});
    const illegalKeys = propKeys.filter((k) => /^tfTools\.debug\./.test(k));
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

    const provider = new TfToolsDebugConfigurationProvider(
      () => manifest,
      () => config,
      () => artifactsRoot,
      () => templatesRoot,
      workspaceFolder
    );

    const proxyConfig: vscode.DebugConfiguration = {
      type: TFTOOLS_DEBUG_TYPE,
      request: "launch",
      name: "Trezor: test",
      tfToolsMode: "default",
      tfToolsProfileId: profile?.id ?? "",
      tfToolsContextKey: makeContextKey(config),
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

