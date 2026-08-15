/**
 * Integration tests for Debug Launch.
 *
 * Covers:
 *  - resolveExecutableArtifact returns "valid" when executable exists on disk
 *  - resolveExecutableArtifact returns "selected" profile state for a unique match
 *  - loadDebugTemplate loads the valid workspace fixture template successfully
 *  - buildDebugVariableMap + applyTbenchSubstitution produce the expected resolved config
 *  - Non-tbench variables in the template pass through unchanged after substitution
 *  - tbench.startDebugging is registered as a VS Code command after activation
 *  - Executing tbench.startDebugging in unsupported-workspace state resolves without throwing
 *  - package.json commandPalette entry for tbench.startDebugging uses tbench.startDebuggingEnabled
 */

import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as vscode from "vscode";
import {
  resolveExecutableArtifact,
} from "../../intellisense/artifact-resolution";
import {
  loadDebugTemplate,
  buildDebugVariableMap,
  applyTbenchSubstitution,
  executeDebugLaunch,
} from "../../commands/debug-launch";
import {
  makeComponentDebugProfile,
  makeDebugTargetWithExtension,
  makeIntelliSenseLoadedState,
  debugLaunchValidTemplatesRoot,
} from "../unit/workflow-test-helpers";
import { ManifestStateLoaded, ManifestComponentDebugProfile } from "../../manifest/manifest-types";
import {
  TBENCH_DEBUG_TYPE,
} from "../../debug/run-debug-provider";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function activateExtension(): Promise<boolean> {
  const ext = vscode.extensions.getExtension("cepetr.tbench");
  if (!ext) {
    return false;
  }
  if (!ext.isActive) {
    await ext.activate();
  }
  return ext.isActive;
}

function getExtPackageJson(): Record<string, unknown> {
  const ext = vscode.extensions.getExtension("cepetr.tbench");
  assert.ok(ext, "cepetr.tbench extension must be present");
  return ext.packageJSON as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helper to create a manifest with component-scoped debug entries for integration tests.
// Produces path: <artifactsRoot>/model-t/firmware.elf  (model-t from T2T1, firmware.elf from component+target)
// ---------------------------------------------------------------------------

function makeExeManifest(
  entries: ManifestComponentDebugProfile[] = [],
  overrides: Partial<ManifestStateLoaded> = {}
): ManifestStateLoaded {
  return makeIntelliSenseLoadedState({
    targets: [makeDebugTargetWithExtension("hw", ".elf")],
    components: [{
      kind: "component",
      id: "core",
      name: "Core",
      artifactName: "firmware",
      debug: entries,
    } as ManifestStateLoaded["components"][0]],
    hasDebugBlockingIssues: false,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Suite: resolveExecutableArtifact filesystem integration
// ---------------------------------------------------------------------------

suite("Debug Launch – resolveExecutableArtifact filesystem integration", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-debug-test-"));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns status: valid when entry resolves and executable exists", () => {
    const execDir = path.join(tmpDir, "model-t");
    fs.mkdirSync(execDir, { recursive: true });
    fs.writeFileSync(path.join(execDir, "firmware.elf"), "");

    const entry = makeComponentDebugProfile({ name: "gdb", template: "gdb-remote.json" });
    const manifest = makeExeManifest([entry]);
    const config = { modelId: "T2T1", targetId: "hw", componentId: "core", persistedAt: "" };

    const result = resolveExecutableArtifact(manifest, config, tmpDir);
    assert.strictEqual(result.status, "valid");
    assert.strictEqual(result.profileResolutionState, "selected");
    assert.strictEqual(result.exists, true);
    assert.ok(result.path.endsWith("firmware.elf"));
  });

  test("appends artifactSuffix and executableExtension for suffixed targets", () => {
    const execDir = path.join(tmpDir, "model-t");
    fs.mkdirSync(execDir, { recursive: true });
    fs.writeFileSync(path.join(execDir, "firmware_emu.elf"), "");

    const entry = makeComponentDebugProfile({ name: "gdb", template: "gdb-remote.json" });
    const manifest = makeExeManifest([entry], {
      targets: [makeDebugTargetWithExtension("emu", ".elf", "_emu")],
    });
    const config = { modelId: "T2T1", targetId: "emu", componentId: "core", persistedAt: "" };

    const result = resolveExecutableArtifact(manifest, config, tmpDir);
    assert.strictEqual(result.status, "valid");
    assert.strictEqual(result.profileResolutionState, "selected");
    assert.strictEqual(result.exists, true);
    assert.ok(result.path.endsWith("firmware_emu.elf"));
  });

  test("returns status: missing when executable file does not exist", () => {
    const entry = makeComponentDebugProfile({ name: "gdb", template: "gdb-remote.json" });
    const manifest = makeExeManifest([entry]);
    const config = { modelId: "T2T1", targetId: "hw", componentId: "core", persistedAt: "" };

    const result = resolveExecutableArtifact(manifest, config, tmpDir);
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.profileResolutionState, "selected");
    assert.strictEqual(result.exists, false);
  });

  test("returns status: missing with no-match when entry when-expression does not match", () => {
    const entry = makeComponentDebugProfile({
      name: "gdb",
      template: "gdb-remote.json",
      when: { type: "model", id: "T3W1" }, // different model
    });
    const manifest = makeExeManifest([entry]);
    const config = { modelId: "T2T1", targetId: "hw", componentId: "core", persistedAt: "" };

    const result = resolveExecutableArtifact(manifest, config, tmpDir);
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.profileResolutionState, "no-match");
  });

  test("returns status: missing with manifest-invalid when hasDebugBlockingIssues is true", () => {
    const manifest = makeExeManifest([], { hasDebugBlockingIssues: true });
    const config = { modelId: "T2T1", targetId: "hw", componentId: "core", persistedAt: "" };

    const result = resolveExecutableArtifact(manifest, config, tmpDir);
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.profileResolutionState, "manifest-invalid");
  });

  test("first matching entry wins when multiple entries match", () => {
    const first = makeComponentDebugProfile({ name: "first", template: "a.json", declarationIndex: 0 });
    const second = makeComponentDebugProfile({ name: "second", template: "b.json", declarationIndex: 1 });
    const manifest = makeExeManifest([first, second]);
    const config = { modelId: "T2T1", targetId: "hw", componentId: "core", persistedAt: "" };

    const result = resolveExecutableArtifact(manifest, config, tmpDir);
    assert.strictEqual(result.status, "missing"); // file doesn't exist yet
    assert.strictEqual(result.profileResolutionState, "selected");
  });
});

// ---------------------------------------------------------------------------
// Suite: template loading integration
// ---------------------------------------------------------------------------

suite("Debug Launch – loadDebugTemplate integration", () => {
  const templatesRoot = debugLaunchValidTemplatesRoot();

  test("gdb-remote.json template loads successfully from the fixture", () => {
    const result = loadDebugTemplate("gdb-remote.json", templatesRoot);
    assert.strictEqual(result.parseState, "loaded", `expected loaded, got: ${result.error}`);
    const cfg = result.configuration!;
    assert.ok(cfg, "expected a configuration object");
    assert.strictEqual(cfg.type, "gdb");
    assert.strictEqual(cfg.request, "launch");
  });

  test("template is read fresh on each call (per-invocation reload)", () => {
    const first = loadDebugTemplate("gdb-remote.json", templatesRoot);
    const second = loadDebugTemplate("gdb-remote.json", templatesRoot);
    assert.strictEqual(first.parseState, "loaded");
    assert.strictEqual(second.parseState, "loaded");
    // Both should produce equivalent content
    assert.deepStrictEqual(first.configuration, second.configuration);
  });
});

// ---------------------------------------------------------------------------
// Suite: end-to-end substitution integration
// ---------------------------------------------------------------------------

suite("Debug Launch – substitution pipeline integration", () => {
  const templatesRoot = debugLaunchValidTemplatesRoot();

  test("tbench variables in gdb-remote.json template are substituted correctly", () => {
    const templateResult = loadDebugTemplate("gdb-remote.json", templatesRoot);
    assert.strictEqual(templateResult.parseState, "loaded");

    const varMap = buildDebugVariableMap(
      "T2T1",
      "Trezor Model T (v1)",
      "hw",
      "Hardware",
      "core",
      "Core",
      "/build/model-t",
      "firmware.elf",
      "/build/model-t/firmware.elf",
      "gdb-remote",
      undefined
    );
    assert.strictEqual(varMap.resolutionErrors.length, 0);

    const { value, unknownVars } = applyTbenchSubstitution(
      templateResult.configuration,
      varMap.resolvedVars
    );
    assert.strictEqual(unknownVars.length, 0, `unexpected unknown vars: ${unknownVars.join(", ")}`);

    const cfg = value as Record<string, unknown>;
    assert.strictEqual(cfg.name, "gdb-remote \u2013 T2T1/core");
    assert.strictEqual(cfg.program, "/build/model-t/firmware.elf");
  });

  test("non-tbench variables in gdb-remote.json are left unchanged", () => {
    const templateResult = loadDebugTemplate("gdb-remote.json", templatesRoot);
    assert.strictEqual(templateResult.parseState, "loaded");

    const varMap = buildDebugVariableMap("T2T1", "Trezor Model T (v1)", "hw", "Hardware", "core", "Core", "/build/model-t", "firmware.elf", "/build/firmware.elf", "gdb-remote", undefined);
    const { value } = applyTbenchSubstitution(templateResult.configuration, varMap.resolvedVars);
    const cfg = value as Record<string, unknown>;

    // ${workspaceFolder} is a non-tbench variable and must pass through unchanged
    assert.strictEqual(cfg.cwd, "${workspaceFolder}");
  });

  test("nested array environment values are substituted correctly", () => {
    const templateResult = loadDebugTemplate("gdb-remote.json", templatesRoot);
    assert.strictEqual(templateResult.parseState, "loaded");

    const varMap = buildDebugVariableMap("T2T1", "Trezor Model T (v1)", "hw", "Hardware", "core", "Core", "/build/model-t", "firmware.elf", "/build/firmware.elf", "gdb-remote", undefined);
    const { value } = applyTbenchSubstitution(templateResult.configuration, varMap.resolvedVars);
    const cfg = value as { environment: Array<{ name: string; value: string }> };
    const targetEnv = cfg.environment.find((e) => e.name === "TARGET");
    assert.ok(targetEnv, "expected TARGET environment entry");
    assert.strictEqual(targetEnv.value, "hw");
  });

  test("entry vars are resolved and substituted into template strings", () => {
    const templateResult = loadDebugTemplate("gdb-remote.json", templatesRoot);
    assert.strictEqual(templateResult.parseState, "loaded");

    const entry = makeComponentDebugProfile({
      name: "gdb-remote",
      template: "gdb-remote.json",
      vars: { debugPort: "3333" },
    });
    const varMap = buildDebugVariableMap(
      "T2T1", "Trezor Model T (v1)", "hw", "Hardware", "core", "Core", "/build/model-t", "firmware.elf", "/build/firmware.elf", entry.name, entry.vars
    );
    assert.strictEqual(varMap.resolvedVars["tbench.debug.var:debugPort"], "3333");
    assert.strictEqual(varMap.resolutionErrors.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Suite: command registration
// ---------------------------------------------------------------------------

suite("Debug Launch – command registration", () => {
  test("extension activates without error", async () => {
    const activated = await activateExtension();
    assert.strictEqual(activated, true, "expected extension to activate");
  });

  test("tbench.startDebugging is registered as a VS Code command", async () => {
    await activateExtension();
    const cmds = await vscode.commands.getCommands(false);
    assert.ok(
      cmds.includes("tbench.startDebugging"),
      "expected 'tbench.startDebugging' to be registered in VS Code commands"
    );
  });

  test("executing tbench.startDebugging in unsupported-workspace state resolves without throwing", async () => {
    await activateExtension();
    let threw = false;
    try {
      await vscode.commands.executeCommand("tbench.startDebugging");
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, false, "tbench.startDebugging must not throw");
  });

  test("executeDebugLaunch reveals the Run and Debug view after a successful launch", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-debug-view-"));
    const originalStartDebugging = vscode.debug.startDebugging;
    const originalExecuteCommand = vscode.commands.executeCommand;
    const invokedCommands: string[] = [];

    try {
      const exeDir = path.join(tmpDir, "model-t");
      fs.mkdirSync(exeDir, { recursive: true });
      fs.writeFileSync(path.join(exeDir, "firmware.elf"), "");

      (vscode.debug as { startDebugging: typeof vscode.debug.startDebugging }).startDebugging = async () => true;
      (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = async (command: string, ...args: unknown[]) => {
        invokedCommands.push(command);
        return originalExecuteCommand(command, ...args);
      };

      const entry = makeComponentDebugProfile({ name: "gdb-remote", template: "gdb-remote.json" });
      const manifest = makeExeManifest([entry]);
      const config = { modelId: "T2T1", targetId: "hw", componentId: "core", persistedAt: "" };

      await executeDebugLaunch(workspaceFolder, manifest, config);

      assert.ok(invokedCommands.includes("workbench.view.debug"));
    } finally {
      (vscode.debug as { startDebugging: typeof vscode.debug.startDebugging }).startDebugging = originalStartDebugging;
      (vscode.commands as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = originalExecuteCommand;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: package.json contributions
// ---------------------------------------------------------------------------

suite("Debug Launch – package.json contributions", () => {
  test("tbench.startDebugging command is listed in package.json contributions", () => {
    const pkg = getExtPackageJson();
    const commands = (pkg.contributes as { commands: Array<{ command: string }> }).commands;
    const entry = commands.find((c) => c.command === "tbench.startDebugging");
    assert.ok(entry, "expected tbench.startDebugging in package.json commands");
  });

  test("commandPalette entry for tbench.startDebugging uses tbench.startDebuggingEnabled", () => {
    const pkg = getExtPackageJson();
    const menus = pkg.contributes as { menus: Record<string, unknown[]> };
    const paletteEntries = (menus.menus["commandPalette"] ?? []) as Array<{
      command: string;
      when?: string;
    }>;
    const entry = paletteEntries.find((e) => e.command === "tbench.startDebugging");
    assert.ok(entry, "expected commandPalette entry for tbench.startDebugging");
    assert.strictEqual(
      entry.when,
      "tbench.startDebuggingEnabled",
      "startDebugging palette entry must use when: tbench.startDebuggingEnabled"
    );
  });

  test("view/title has Start Debugging entry for Configuration view header", () => {
    const pkg = getExtPackageJson();
    const menus = pkg.contributes as { menus: Record<string, unknown[]> };
    const titleEntries = (menus.menus["view/title"] ?? []) as Array<{
      command: string;
      when?: string;
      group?: string;
    }>;
    const headerEntry = titleEntries.find(
      (e) => e.command === "tbench.startDebugging" && e.group?.startsWith("navigation@")
    );
    assert.ok(headerEntry, "expected view/title navigation entry for tbench.startDebugging");
    assert.ok(
      headerEntry.when?.includes("view == tbench.configuration"),
      `expected 'view == tbench.configuration' in when-clause, got: ${headerEntry.when}`
    );
  });

  test("view/item/context has Start Debugging entry for Executable row", () => {
    const pkg = getExtPackageJson();
    const menus = pkg.contributes as { menus: Record<string, unknown[]> };
    const contextEntries = (menus.menus["view/item/context"] ?? []) as Array<{
      command: string;
      when?: string;
    }>;
    const entry = contextEntries.find(
      (e) => e.command === "tbench.startDebugging" && e.when?.includes("artifact-executable")
    );
    assert.ok(entry, "expected view/item/context entry for tbench.startDebugging on Executable row");
  });
});

// ---------------------------------------------------------------------------
// Suite: Debug Launch scope boundaries
// ---------------------------------------------------------------------------

suite("Debug Launch – scope boundaries", () => {
  function getPackageJson(): Record<string, unknown> {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    if (!ext) {
      return {};
    }
    return ext.packageJSON as Record<string, unknown>;
  }

  test("no Build/Clippy/Check/Clean entries appear in debug-launch contributions", () => {
    const pkg = getPackageJson();
    const menus = (pkg.contributes as { menus?: Record<string, unknown[]> } | undefined)?.menus ?? {};
    const allEntries = [
      ...(menus["view/title"] as Array<{ command: string }> ?? []),
      ...(menus["view/item/context"] as Array<{ command: string }> ?? []),
    ];
    const WORKFLOW_CMD_PATTERNS = [/^tbench\.build$/, /^tbench\.clippy$/, /^tbench\.check$/, /^tbench\.clean$/];
    // Workflow commands may appear in view/title but must not appear in
    // view/item/context (where only artifact-row actions belong)
    const contextEntries = (menus["view/item/context"] as Array<{ command: string }> ?? []);
    const contextOffenders = contextEntries.filter((e) =>
      WORKFLOW_CMD_PATTERNS.some((re) => re.test(e.command))
    );
    assert.deepStrictEqual(
      contextOffenders,
      [],
      "Build/Clippy/Check/Clean commands must not appear in view/item/context"
    );
    void allEntries; // suppress unused-variable warning
  });

  test("startDebugging is the only debug-related command contributed in package.json settings", () => {
    const pkg = getPackageJson();
    const conf = (pkg.contributes as { configuration?: { properties?: Record<string, unknown> } } | undefined)
      ?.configuration;
    const propKeys = Object.keys(conf?.properties ?? {});
    const debugSettingKeys = propKeys.filter((k) => k.startsWith("tbench.debug."));
    assert.deepStrictEqual(
      debugSettingKeys,
      [],
      `No tbench.debug settings must be contributed; found: ${debugSettingKeys.join(", ")}`
    );
  });

  test("startDebugging overflow entry is after flash/upload and before refreshIntelliSense", () => {
    const pkg = getPackageJson();
    const menus = (pkg.contributes as { menus?: Record<string, unknown[]> } | undefined)?.menus ?? {};
    const overflowEntries = ((menus["view/title"] as Array<{ command: string; group?: string }>) ?? [])
      .filter((e) => e.group?.startsWith("overflow@"))
      .sort((a, b) => {
        const aOrd = parseInt((a.group ?? "overflow@99").split("@")[1] ?? "99", 10);
        const bOrd = parseInt((b.group ?? "overflow@99").split("@")[1] ?? "99", 10);
        return aOrd - bOrd;
      });

    const cmdOrder = overflowEntries.map((e) => e.command);
    const flashIdx = cmdOrder.indexOf("tbench.flash");
    const uploadIdx = cmdOrder.indexOf("tbench.upload");
    const startDebugIdx = cmdOrder.indexOf("tbench.startDebugging");
    const refreshIdx = cmdOrder.indexOf("tbench.refreshIntelliSense");

    // startDebugging must come after flash/upload (when present) and before refreshIntelliSense
    if (flashIdx !== -1) {
      assert.ok(startDebugIdx > flashIdx, "startDebugging must appear after flash in overflow");
    }
    if (uploadIdx !== -1) {
      assert.ok(startDebugIdx > uploadIdx, "startDebugging must appear after upload in overflow");
    }
    if (refreshIdx !== -1) {
      assert.ok(startDebugIdx < refreshIdx, "startDebugging must appear before refreshIntelliSense in overflow");
    }
    assert.ok(startDebugIdx !== -1, "startDebugging must be in overflow menu");
  });
});

// ---------------------------------------------------------------------------
// Suite: Run and Debug provider – package.json contribution regressions
// ---------------------------------------------------------------------------

suite("Run and Debug provider – package contribution regressions", () => {
  function getExtPackageJson(): Record<string, unknown> {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    if (!ext) {
      return {};
    }
    return ext.packageJSON as Record<string, unknown>;
  }

  test("contributes a 'tbench' debugger type in package.json", () => {
    const pkg = getExtPackageJson();
    const debuggers = (
      pkg.contributes as { debuggers?: Array<{ type: string }> } | undefined
    )?.debuggers ?? [];
    const entry = debuggers.find((d) => d.type === "tbench");
    assert.ok(entry, "expected 'tbench' debugger type in package.json contributes.debuggers");
  });

  test("tbench debugger has a non-empty label", () => {
    const pkg = getExtPackageJson();
    const debuggers = (
      pkg.contributes as { debuggers?: Array<{ type: string; label?: string }> } | undefined
    )?.debuggers ?? [];
    const entry = debuggers.find((d) => d.type === "tbench");
    assert.ok(entry?.label, "tbench debugger must have a label in package.json");
  });

  test("tbench debugger contributes launch configurationAttributes for proxy fields", () => {
    const pkg = getExtPackageJson();
    const debuggers = (
      pkg.contributes as {
        debuggers?: Array<{
          type: string;
          configurationAttributes?: {
            launch?: {
              properties?: Record<string, unknown>;
            };
          };
        }>;
      } | undefined
    )?.debuggers ?? [];
    const entry = debuggers.find((d) => d.type === "tbench");
    const properties = entry?.configurationAttributes?.launch?.properties ?? {};

    assert.ok(properties["tbenchMode"], "expected tbenchMode launch schema property");
    assert.ok(properties["tbenchProfileId"], "expected tbenchProfileId launch schema property");
    assert.ok(properties["tbenchContextKey"], "expected tbenchContextKey launch schema property");
  });

  test("onDebugResolve:tbench activation event is present", () => {
    const pkg = getExtPackageJson();
    const activationEvents = (pkg.activationEvents as string[] | undefined) ?? [];
    assert.ok(
      activationEvents.includes("onDebugResolve:tbench"),
      `expected 'onDebugResolve:tbench' in activationEvents, got: [${activationEvents.join(", ")}]`
    );
  });

  test("tbench debug type is not the same as an existing debugger type", () => {
    // The tbench type is a proxy type and must not collide with real debugger types
    // like 'cppdbg', 'cortex-debug', 'gdb', etc.
    const RESERVED_TYPES = ["cppdbg", "cortex-debug", "gdb", "lldb", "node", "python", "go"];
    assert.ok(
      !RESERVED_TYPES.includes(TBENCH_DEBUG_TYPE),
      `TBENCH_DEBUG_TYPE '${TBENCH_DEBUG_TYPE}' must not collide with a standard debugger type`
    );
  });
});
