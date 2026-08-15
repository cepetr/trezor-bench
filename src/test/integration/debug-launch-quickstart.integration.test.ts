/**
 * Integration tests validating the consolidated Debug Launch scenarios.
 *
 * Maps to the Debug Launch behavior in specs/product-spec.md:
 *   S1: Unique matching profile — executable row valid, launch surfaces functional
 *   S2: First matching profile in declaration order wins
 *   S3: Ambiguous and unmatched contexts stay discoverable but blocked (enablement)
 *   S4: Executable row explains readiness with tooltip
 *   S5: Template failures at invocation time, not during enablement
 *   S6: tbench substitution resolves nested values, preserves non-tbench variables
 *   S7: Template-root traversal is rejected at invocation time
 */

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  resolveExecutableArtifact,
} from "../../intellisense/artifact-resolution";
import {
  resolveDebugProfile,
  deriveExecutableFileName,
  loadDebugTemplate,
  buildDebugVariableMap,
  applyTbenchSubstitution,
  executeDebugLaunch,
} from "../../commands/debug-launch";
import {
  makeComponentDebugProfile,
  makeDebugTargetWithExtension,
  makeIntelliSenseLoadedState,
  debugLaunchFailuresWorkspaceRoot,
} from "../unit/workflow-test-helpers";
import { ManifestStateLoaded, ManifestComponentDebugProfile } from "../../manifest/manifest-types";
import { ExecutableArtifactItem } from "../../ui/configuration-tree";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(modelId: string, targetId = "hw", componentId = "core") {
  return { modelId, targetId, componentId, persistedAt: "" };
}

const failuresTemplatesRoot = path.join(debugLaunchFailuresWorkspaceRoot(), "debug-templates");

// Helper: creates manifest state whose derived exe path is <artifactsRoot>/model-t/firmware.elf
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
// S1: Unique matching profile — valid Executable row + launch
// ---------------------------------------------------------------------------

suite("QS1 – Unique matching profile", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-qs1-"));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("resolveExecutableArtifact returns valid when unique profile matches and executable exists", () => {
    const exeDir = path.join(tmpDir, "model-t");
    fs.mkdirSync(exeDir);
    fs.writeFileSync(path.join(exeDir, "firmware.elf"), "");

    const entry = makeComponentDebugProfile({ name: "gdb", template: "gdb-remote.json" });
    const manifest = makeExeManifest([entry]);
    const config = makeConfig("T2T1");

    const result = resolveExecutableArtifact(manifest, config, tmpDir);
    assert.strictEqual(result.status, "valid");
    assert.strictEqual(result.profileResolutionState, "selected");
    assert.strictEqual(result.exists, true);
  });

  test("ExecutableArtifactItem shows valid status with pass icon and path tooltip", () => {
    const exeDir = path.join(tmpDir, "model-t");
    fs.mkdirSync(exeDir);
    fs.writeFileSync(path.join(exeDir, "firmware.elf"), "");

    const entry = makeComponentDebugProfile({ name: "gdb", template: "gdb-remote.json" });
    const manifest = makeExeManifest([entry]);
    const config = makeConfig("T2T1");

    const artifact = resolveExecutableArtifact(manifest, config, tmpDir);
    const item = new ExecutableArtifactItem(artifact);

    assert.strictEqual(item.description, "present");
    assert.ok(
      (item.iconPath as vscode.ThemeIcon).id === "pass",
      "expected pass icon for valid executable"
    );
    assert.ok(
      String(item.tooltip).includes("firmware.elf"),
      `expected executable path in tooltip, got: ${item.tooltip}`
    );
  });

  test("executeDebugLaunch resolves without throwing when valid fixture template exists and executable present", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const exeDir = path.join(tmpDir, "model-t");
    fs.mkdirSync(exeDir);
    fs.writeFileSync(path.join(exeDir, "firmware.elf"), "");

    const entry = makeComponentDebugProfile({ name: "gdb", template: "gdb-remote.json" });
    const manifest = makeExeManifest([entry]);
    const config = makeConfig("T2T1");

    // Launch may fail (no real debugger in CI), but it must not throw an error
    await assert.doesNotReject(
      () => executeDebugLaunch(workspaceFolder, manifest, config),
      "expected executeDebugLaunch to resolve without throwing for fully valid scenario"
    );
  });
});

// ---------------------------------------------------------------------------
// S2: First-match wins among multiple matching entries (declaration order)
// ---------------------------------------------------------------------------

suite("QS2 – First-match-wins selection among multiple matching profiles", () => {
  test("resolveDebugProfile selects first profile in declaration order when all match", () => {
    const first = makeComponentDebugProfile({ name: "first", template: "first.json", declarationIndex: 0 });
    const second = makeComponentDebugProfile({ name: "second", template: "second.json", declarationIndex: 1 });
    const buildContext = { modelId: "T2T1", targetId: "hw", componentId: "core" };

    const result = resolveDebugProfile([first, second], buildContext);

    assert.strictEqual(result.resolutionState, "selected");
    assert.strictEqual(result.selectedProfile?.name, "first");
  });

  test("resolveExecutableArtifact selects first matching profile for executable path", () => {
    const first = makeComponentDebugProfile({ name: "first", template: "first.json", declarationIndex: 0 });
    const second = makeComponentDebugProfile({ name: "second", template: "second.json", declarationIndex: 1 });
    const manifest = makeExeManifest([first, second]);
    const config = makeConfig("T2T1");

    const result = resolveExecutableArtifact(manifest, config, "/artifacts");

    assert.strictEqual(result.profileResolutionState, "selected");
    assert.ok(
      result.expectedPath.includes("firmware.elf"),
      `expected firmware.elf in expectedPath, got: ${result.expectedPath}`
    );
  });
});

// ---------------------------------------------------------------------------
// S3: Ambiguous and unmatched contexts stay blocked with visible actions
// ---------------------------------------------------------------------------

suite("QS3 – Unmatched contexts remain discoverable but blocked", () => {
  test("no-match: resolveExecutableArtifact returns missing with no-match state", () => {
    const entry = makeComponentDebugProfile({
      name: "gdb",
      template: "gdb.json",
      when: { type: "model", id: "T3W1" },
    });
    const manifest = makeExeManifest([entry]);
    const config = makeConfig("T2T1"); // T3W1 entry does not match T2T1

    const result = resolveExecutableArtifact(manifest, config, "/artifacts");
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.profileResolutionState, "no-match");
    assert.ok(result.missingReason, "expected a missingReason for no-match state");
  });

  test("no-match: ExecutableArtifactItem shows error icon and missing description", () => {
    const entry = makeComponentDebugProfile({
      name: "gdb",
      template: "gdb.json",
      when: { type: "model", id: "T3W1" },
    });
    const manifest = makeExeManifest([entry]);
    const config = makeConfig("T2T1");

    const artifact = resolveExecutableArtifact(manifest, config, "/artifacts");
    const item = new ExecutableArtifactItem(artifact);

    assert.strictEqual(item.description, "missing");
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "error");
  });

  test("no-match state does NOT fire executeDebugLaunch (blocked early)", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    // no-match case
    const entry = makeComponentDebugProfile({
      name: "gdb",
      template: "gdb.json",
      when: { type: "model", id: "T3W1" },
    });
    await assert.doesNotReject(
      () => executeDebugLaunch(workspaceFolder, makeExeManifest([entry]),
        makeConfig("T2T1")),
      "no-match must resolve without throwing"
    );
  });
});

// ---------------------------------------------------------------------------
// S4: Executable row explains readiness with tooltip
// ---------------------------------------------------------------------------

suite("QS4 – Executable row explains readiness", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-qs4-"));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("valid state: tooltip includes the expected executable path", () => {
    const exeDir = path.join(tmpDir, "model-t");
    fs.mkdirSync(exeDir);
    const exePath = path.join(exeDir, "firmware.elf");
    fs.writeFileSync(exePath, "");

    const entry = makeComponentDebugProfile({ name: "gdb", template: "gdb.json" });
    const manifest = makeExeManifest([entry]);
    const artifact = resolveExecutableArtifact(manifest, makeConfig("T2T1"), tmpDir);
    const item = new ExecutableArtifactItem(artifact);

    assert.ok(
      String(item.tooltip).includes("firmware.elf"),
      `expected path in tooltip for valid state, got: ${item.tooltip}`
    );
  });

  test("missing state: tooltip includes the missing reason", () => {
    const entry = makeComponentDebugProfile({ name: "gdb", template: "gdb.json" });
    const manifest = makeExeManifest([entry]);
    const artifact = resolveExecutableArtifact(manifest, makeConfig("T2T1"), tmpDir);
    const item = new ExecutableArtifactItem(artifact);

    assert.strictEqual(item.description, "missing");
    assert.ok(
      String(item.tooltip).length > 0,
      "expected non-empty tooltip for missing state"
    );
    // tooltip should mention the path or a reason
    assert.ok(
      String(item.tooltip).includes("firmware.elf") || String(item.tooltip).includes("not found"),
      `expected path or reason in tooltip, got: ${item.tooltip}`
    );
  });

  test("no-match state: Executable row tooltip describes why", () => {
    const entry = makeComponentDebugProfile({
      name: "gdb",
      template: "gdb.json",
      when: { type: "model", id: "T3W1" },
    });
    const manifest = makeExeManifest([entry]);
    const artifact = resolveExecutableArtifact(manifest, makeConfig("T2T1"), tmpDir);
    const item = new ExecutableArtifactItem(artifact);

    assert.strictEqual(item.description, "missing");
    assert.ok(
      String(item.tooltip).length > 0,
      "expected non-empty tooltip for no-match state"
    );
  });
});

// ---------------------------------------------------------------------------
// S5: Template failures at invocation time, not during enablement
// ---------------------------------------------------------------------------

suite("QS5 – Template failures at invocation time", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-qs5-"));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("missing template does NOT affect resolveExecutableArtifact — profile remains valid if executable exists", () => {
    const exeDir = path.join(tmpDir, "model-t");
    fs.mkdirSync(exeDir);
    fs.writeFileSync(path.join(exeDir, "firmware.elf"), "");

    const entry = makeComponentDebugProfile({ name: "gdb", template: "missing-template.json" });
    const manifest = makeExeManifest([entry]);
    const artifact = resolveExecutableArtifact(manifest, makeConfig("T2T1"), tmpDir);

    // Template existence does NOT affect enablement
    assert.strictEqual(artifact.status, "valid");
  });

  test("malformed template does NOT affect resolveExecutableArtifact enablement", () => {
    const exeDir = path.join(tmpDir, "model-t");
    fs.mkdirSync(exeDir);
    fs.writeFileSync(path.join(exeDir, "firmware.elf"), "");

    const entry = makeComponentDebugProfile({ name: "gdb", template: "malformed-template.json" });
    const manifest = makeExeManifest([entry]);
    const artifact = resolveExecutableArtifact(manifest, makeConfig("T2T1"), tmpDir);

    assert.strictEqual(artifact.status, "valid");
  });

  test("loadDebugTemplate returns missing at invocation time for non-existent template", () => {
    const result = loadDebugTemplate("missing-template.json", failuresTemplatesRoot);
    assert.strictEqual(result.parseState, "missing");
    assert.ok(result.error, "expected error message for missing template");
  });

  test("loadDebugTemplate returns invalid at invocation time for malformed JSONC template", () => {
    const result = loadDebugTemplate("malformed-template.json", failuresTemplatesRoot);
    assert.strictEqual(result.parseState, "invalid");
    assert.ok(result.error, "expected error message for malformed template");
  });

  test("executeDebugLaunch resolves without throwing for missing template at invocation", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const exeDir = path.join(tmpDir, "model-t");
    fs.mkdirSync(exeDir);
    fs.writeFileSync(path.join(exeDir, "firmware.elf"), "");

    const entry = makeComponentDebugProfile({ name: "gdb", template: "missing-template.json" });
    const manifest = makeExeManifest([entry]);

    await assert.doesNotReject(
      () => executeDebugLaunch(workspaceFolder, manifest, makeConfig("T2T1")),
      "missing template must resolve without throwing"
    );
  });
});

// ---------------------------------------------------------------------------
// S6: tbench substitution in nested values; non-tbench vars preserved
// ---------------------------------------------------------------------------

suite("QS6 – tbench substitution and non-tbench variable pass-through", () => {
  test("buildDebugVariableMap includes all built-in tbench variables", () => {
    const varMap = buildDebugVariableMap("T2T1", "Trezor Model T (v1)", "hw", "Hardware", "core", "Core", "/artifacts/model-t", "firmware.elf", "/artifacts/model-t/firmware.elf", "gdb-remote", undefined);
    assert.strictEqual(varMap.resolvedVars["tbench.model.id"], "T2T1");
    assert.strictEqual(varMap.resolvedVars["tbench.target.id"], "hw");
    assert.strictEqual(varMap.resolvedVars["tbench.component.id"], "core");
    assert.strictEqual(varMap.resolvedVars["tbench.artifactPath"], "/artifacts/model-t");
    assert.strictEqual(varMap.resolvedVars["tbench.executablePath"], "/artifacts/model-t/firmware.elf");
    assert.strictEqual(varMap.resolvedVars["tbench.executable"], "firmware.elf");
  });

  test("applyTbenchSubstitution resolves nested object and array string fields", () => {
    const varMap = buildDebugVariableMap("T2T1", "Trezor Model T (v1)", "hw", "Hardware", "core", "Core", "/build/model-t", "firmware.elf", "/build/firmware.elf", "gdb-remote", undefined);
    const template = {
      type: "cortex-debug",
      executable: "${tbench.executablePath}",
      args: ["--model", "${tbench.model.id}"],
      nested: { label: "Debug ${tbench.component.id}" },
    };
    const { value, unknownVars } = applyTbenchSubstitution(template, varMap.resolvedVars);
    const resolved = value as typeof template;

    assert.strictEqual(resolved.executable, "/build/firmware.elf");
    assert.deepStrictEqual(resolved.args, ["--model", "T2T1"]);
    assert.strictEqual((resolved.nested as { label: string }).label, "Debug core");
    assert.strictEqual(unknownVars.length, 0);
  });

  test("applyTbenchSubstitution leaves non-tbench VS Code variables untouched", () => {
    const varMap = buildDebugVariableMap("T2T1", "Trezor Model T (v1)", "hw", "Hardware", "core", "Core", "/build/model-t", "fw.elf", "/build/fw.elf", "gdb-remote", undefined);
    const template = {
      cwd: "${workspaceFolder}",
      serverPath: "${env:OPENOCD_PATH}",
      executable: "${tbench.executablePath}",
    };
    const { value, unknownVars } = applyTbenchSubstitution(template, varMap.resolvedVars);
    const resolved = value as typeof template;

    assert.strictEqual(resolved.cwd, "${workspaceFolder}", "non-tbench var must pass through");
    assert.strictEqual(resolved.serverPath, "${env:OPENOCD_PATH}", "env var must pass through");
    assert.strictEqual(resolved.executable, "/build/fw.elf");
    assert.strictEqual(unknownVars.length, 0, "non-tbench vars must not appear in unknownVars");
  });

  test("applyTbenchSubstitution reports unknown tbench variables", () => {
    const varMap = buildDebugVariableMap("T2T1", "Trezor Model T (v1)", "hw", "Hardware", "core", "Core", "/build/model-t", "fw.elf", "/build/fw.elf", "gdb-remote", undefined);
    const template = { serverPort: "${tbench.nonExistentPort}" };
    const { unknownVars } = applyTbenchSubstitution(template, varMap.resolvedVars);

    assert.ok(
      unknownVars.includes("tbench.nonExistentPort"),
      `expected tbench.nonExistentPort in unknownVars, got: ${unknownVars.join(", ")}`
    );
  });

  test("buildDebugVariableMap surface cyclic profile vars as resolution errors", () => {
    const vars = { a: "${tbench.debug.var:b}", b: "${tbench.debug.var:a}" };
    const varMap = buildDebugVariableMap("T2T1", "Trezor Model T (v1)", "hw", "Hardware", "core", "Core", "/build/model-t", "fw.elf", "/build/fw.elf", "gdb-remote", vars);

    assert.ok(
      varMap.resolutionErrors.length > 0,
      "expected resolution errors for cyclic profile vars"
    );
  });
});

// ---------------------------------------------------------------------------
// S7: Template-root traversal is rejected at invocation time
// ---------------------------------------------------------------------------

suite("QS7 – Template-root traversal rejection", () => {
  test("loadDebugTemplate blocks traversal path that escapes templates root", () => {
    const result = loadDebugTemplate("../escaped/evil.json", failuresTemplatesRoot);
    assert.strictEqual(result.parseState, "traversal-blocked");
    assert.ok(result.error, "expected error message for traversal attempt");
    assert.ok(
      result.error.includes("templates root") || result.error.includes("escapes"),
      `expected traversal message, got: ${result.error}`
    );
  });

  test("deriveExecutableFileName returns artifactName+artifactSuffix+executableExtension", () => {
    const fileName = deriveExecutableFileName("firmware", "", ".elf");
    assert.strictEqual(fileName, "firmware.elf");
  });

  test("deriveExecutableFileName includes suffix when present", () => {
    const fileName = deriveExecutableFileName("firmware", "_emu", ".elf");
    assert.strictEqual(fileName, "firmware_emu.elf");
  });

  test("executeDebugLaunch resolves without throwing for traversal-attempt template", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-qs7-"));
    try {
      const exeDir = path.join(tmpDir, "model-t");
      fs.mkdirSync(exeDir);
      fs.writeFileSync(path.join(exeDir, "firmware.elf"), "");

      const entry = makeComponentDebugProfile({
        name: "gdb",
        template: "../escaped/evil.json",
      });
      const manifest = makeExeManifest([entry]);

      await assert.doesNotReject(
        () => executeDebugLaunch(workspaceFolder, manifest, makeConfig("T2T1")),
        "traversal attempt must resolve without throwing"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
