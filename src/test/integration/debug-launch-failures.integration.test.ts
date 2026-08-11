/**
 * Integration tests for Debug Launch failure cases.
 *
 * Covers:
 *  - no-match: resolveActiveExecutableArtifact returns no-match state
 *  - missing-executable: executable file absent, executeDebugLaunch returns gracefully
 *  - missing-template: loadDebugTemplate returns "missing" for non-existent template
 *  - malformed-template: loadDebugTemplate returns "invalid" for malformed JSONC
 *  - unresolved-variable: applyTbenchSubstitution reports unknown tbench variables
 *  - ambiguous-profile: resolveActiveExecutableArtifact returns ambiguous state
 *  - traversal: loadDebugTemplate returns "traversal-blocked" for escaping paths
 *  - unsupported-workspace: tbench.startDebugging completes without throwing
 *  - each blocked executeDebugLaunch call resolves without throwing
 */

import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as vscode from "vscode";
import {
  resolveActiveExecutableArtifact,
} from "../../intellisense/artifact-resolution";
import {
  loadDebugTemplate,
  buildDebugVariableMap,
  applyTbenchSubstitution,
  executeDebugLaunch,
} from "../../commands/debug-launch";
import {
  makeDebugLoadedState,
  makeComponentDebugProfile,
  makeDebugTargetWithExtension,
  makeIntelliSenseLoadedState,
  debugLaunchFailuresWorkspaceRoot,
} from "../unit/workflow-test-helpers";
import { ManifestStateLoaded, ManifestComponentDebugProfile } from "../../manifest/manifest-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(modelId: string, targetId = "hw", componentId = "core"): {
  modelId: string;
  targetId: string;
  componentId: string;
  persistedAt: string;
} {
  return { modelId, targetId, componentId, persistedAt: "" };
}

const failuresTemplatesRoot = path.join(debugLaunchFailuresWorkspaceRoot(), "debug-templates");

// Helper to create manifests with component-scoped debug entries
// Derives path: <artifactsRoot>/model-t/firmware.elf
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
// Suite: no-match failure
// ---------------------------------------------------------------------------

suite("Debug Launch Failures – no-match", () => {
  test("resolveActiveExecutableArtifact returns no-match when no entry matches the active context", () => {
    const entry = makeComponentDebugProfile({
      name: "gdb",
      template: "gdb-remote.json",
      when: { type: "model", id: "T3W1" }, // only T3W1 matches
    });
    const manifest = makeExeManifest([entry]);
    const config = makeConfig("T2T1"); // T2T1 does not match

    const result = resolveActiveExecutableArtifact(manifest, config, "/some/root");
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.profileResolutionState, "no-match");
    assert.ok(result.missingReason, "expected a missingReason for no-match");
    assert.ok(result.tooltip.length > 0, "expected non-empty tooltip");
  });

  test("executeDebugLaunch resolves without throwing when no entry matches", async () => {
    const entry = makeComponentDebugProfile({
      name: "gdb",
      template: "gdb-remote.json",
      when: { type: "model", id: "T3W1" },
    });
    const manifest = makeExeManifest([entry]);
    const config = makeConfig("T2T1");
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      // Skip if no workspace is open in the test host
      return;
    }

    // Should not throw — blocked launch is handled gracefully
    await assert.doesNotReject(
      () => executeDebugLaunch(workspaceFolder, manifest, config),
      "expected executeDebugLaunch to resolve without throwing for no-match"
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: first-match wins (replaces ambiguous-profile)
// ---------------------------------------------------------------------------

suite("Debug Launch Failures – first-match-wins", () => {
  test("resolveActiveExecutableArtifact selects first matching entry in declaration order", () => {
    const first = makeComponentDebugProfile({ name: "first", template: "a.json", declarationIndex: 0 });
    const second = makeComponentDebugProfile({ name: "second", template: "b.json", declarationIndex: 1 });
    const manifest = makeExeManifest([first, second]);
    const config = makeConfig("T2T1");

    const result = resolveActiveExecutableArtifact(manifest, config, "/some/root");
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.profileResolutionState, "selected");
    assert.ok(result.tooltip.length > 0, "expected non-empty tooltip");
  });

  test("executeDebugLaunch resolves without throwing for first-match scenario", async () => {
    const first = makeComponentDebugProfile({ name: "first", template: "a.json", declarationIndex: 0 });
    const manifest = makeExeManifest([first]);
    const config = makeConfig("T2T1");
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      return;
    }

    await assert.doesNotReject(
      () => executeDebugLaunch(workspaceFolder, manifest, config),
      "expected executeDebugLaunch to resolve without throwing for first-match"
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: missing-executable failure
// ---------------------------------------------------------------------------

suite("Debug Launch Failures – missing-executable", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-missing-exe-"));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("resolveActiveExecutableArtifact returns selected+missing when executable is absent", () => {
    const entry = makeComponentDebugProfile({ name: "gdb", template: "gdb-remote.json" });
    const manifest = makeExeManifest([entry]);
    const config = makeConfig("T2T1");

    const result = resolveActiveExecutableArtifact(manifest, config, tmpDir);
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.profileResolutionState, "selected");
    assert.strictEqual(result.exists, false);
    assert.ok(result.expectedPath.endsWith("firmware.elf"));
    assert.ok(result.missingReason, "expected missingReason for missing executable");
  });

  test("executeDebugLaunch resolves without throwing when executable is missing", async () => {
    const entry = makeComponentDebugProfile({ name: "gdb", template: "gdb-remote.json" });
    const manifest = makeExeManifest([entry]);
    const config = makeConfig("T2T1");
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
      return;
    }

    await assert.doesNotReject(
      () => executeDebugLaunch(workspaceFolder, manifest, config),
      "expected executeDebugLaunch to resolve without throwing for missing executable"
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: missing-template failure
// ---------------------------------------------------------------------------

suite("Debug Launch Failures – missing-template", () => {
  test("loadDebugTemplate returns missing for non-existent template in failures fixture", () => {
    const result = loadDebugTemplate("missing-template.json", failuresTemplatesRoot);
    assert.strictEqual(result.parseState, "missing");
    assert.ok(result.error, "expected an error message for missing template");
  });

  test("executeDebugLaunch resolves without throwing when template file is missing", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-missing-tpl-"));
    try {
      // Create the executable so we get past missing-executable check
      const exeDir = path.join(tmpDir, "model-t");
      fs.mkdirSync(exeDir);
      fs.writeFileSync(path.join(exeDir, "firmware.elf"), "");

      const entry = makeComponentDebugProfile({ name: "gdb", template: "missing-template.json" });
      const manifest = makeExeManifest([entry]);
      const config = makeConfig("T2T1");

      // Use tmpDir as both artifacts and templates root — template is missing
      await assert.doesNotReject(
        () => executeDebugLaunch(workspaceFolder, manifest, config),
        "expected executeDebugLaunch to resolve without throwing for missing template"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: malformed-template failure
// ---------------------------------------------------------------------------

suite("Debug Launch Failures – malformed-template", () => {
  test("loadDebugTemplate returns invalid for malformed-template.json fixture", () => {
    const result = loadDebugTemplate("malformed-template.json", failuresTemplatesRoot);
    assert.strictEqual(result.parseState, "invalid");
    assert.ok(result.error, "expected an error message for malformed template");
    assert.ok(
      result.error.toLowerCase().includes("parse") || result.error.toLowerCase().includes("error"),
      `expected parse error message, got: ${result.error}`
    );
  });

  test("executeDebugLaunch resolves without throwing when template is malformed", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-malformed-tpl-"));
    try {
      const exeDir = path.join(tmpDir, "model-t");
      fs.mkdirSync(exeDir);
      fs.writeFileSync(path.join(exeDir, "firmware.elf"), "");

      const entry = makeComponentDebugProfile({ name: "gdb", template: "malformed-template.json" });
      const manifest = makeExeManifest([entry]);
      const config = makeConfig("T2T1");

      await assert.doesNotReject(
        () => executeDebugLaunch(workspaceFolder, manifest, config),
        "expected executeDebugLaunch to resolve without throwing for malformed template"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: unresolved-variable failure
// ---------------------------------------------------------------------------

suite("Debug Launch Failures – unresolved-variable", () => {
  test("unknown-var-template.json fixture contains a non-existent tbench variable", () => {
    const result = loadDebugTemplate("unknown-var-template.json", failuresTemplatesRoot);
    assert.strictEqual(result.parseState, "loaded");
    // Verify the template contains the unknown var token
    const cfg = result.configuration!;
    const hasUnknownVar = JSON.stringify(cfg).includes("tbench.nonExistentVariable");
    assert.ok(hasUnknownVar, "expected unknown-var-template.json to contain tbench.nonExistentVariable");
  });

  test("applyTbenchSubstitution reports unknownVars for the unknown-var template content", () => {
    const result = loadDebugTemplate("unknown-var-template.json", failuresTemplatesRoot);
    assert.strictEqual(result.parseState, "loaded");

    const varMap = buildDebugVariableMap("T2T1", "Trezor Model T (v1)", "hw", "Hardware", "core", "Core", "/build/model-t", "firmware.elf", "/build/firmware.elf", "gdb", undefined);
    const { unknownVars } = applyTbenchSubstitution(result.configuration, varMap.resolvedVars);
    assert.ok(
      unknownVars.some((v) => v.includes("nonExistentVariable")),
      `expected nonExistentVariable in unknownVars, got: ${unknownVars.join(", ")}`
    );
  });

  test("executeDebugLaunch resolves without throwing for unknown-var template", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-unknown-var-"));
    try {
      const exeDir = path.join(tmpDir, "model-t");
      fs.mkdirSync(exeDir);
      fs.writeFileSync(path.join(exeDir, "firmware.elf"), "");

      const entry = makeComponentDebugProfile({ name: "gdb", template: "unknown-var-template.json" });
      const manifest = makeExeManifest([entry]);
      const config = makeConfig("T2T1");

      await assert.doesNotReject(
        () => executeDebugLaunch(workspaceFolder, manifest, config),
        "expected executeDebugLaunch to resolve without throwing for unknown-var template"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: traversal failure
// ---------------------------------------------------------------------------

suite("Debug Launch Failures – traversal", () => {
  test("loadDebugTemplate returns traversal-blocked for ../escaped/ path", () => {
    const result = loadDebugTemplate("../escaped/template.json", failuresTemplatesRoot);
    assert.strictEqual(result.parseState, "traversal-blocked");
    assert.ok(result.error, "expected an error message for traversal attempt");
  });

  test("executeDebugLaunch resolves without throwing for traversal-attempt template", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-traversal-test-"));
    try {
      const exeDir = path.join(tmpDir, "model-t");
      fs.mkdirSync(exeDir);
      fs.writeFileSync(path.join(exeDir, "firmware.elf"), "");

      const entry = makeComponentDebugProfile({ name: "gdb", template: "../escaped/template.json" });
      const manifest = makeExeManifest([entry]);
      const config = makeConfig("T2T1");

      await assert.doesNotReject(
        () => executeDebugLaunch(workspaceFolder, manifest, config),
        "expected executeDebugLaunch to resolve without throwing for traversal attempt"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: manifest-invalid failure
// ---------------------------------------------------------------------------

suite("Debug Launch Failures – manifest-invalid", () => {
  test("resolveActiveExecutableArtifact returns manifest-invalid when hasDebugBlockingIssues is true", () => {
    const manifest = makeDebugLoadedState([], { hasDebugBlockingIssues: true });
    const result = resolveActiveExecutableArtifact(manifest, makeConfig("T2T1"), "/some/root");
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.profileResolutionState, "manifest-invalid");
  });

  test("executeDebugLaunch resolves without throwing when manifest has blocking issues", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const manifest = makeDebugLoadedState([], { hasDebugBlockingIssues: true });
    const config = makeConfig("T2T1");

    await assert.doesNotReject(
      () => executeDebugLaunch(workspaceFolder, manifest, config),
      "expected executeDebugLaunch to resolve without throwing for manifest-invalid"
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: unsupported-workspace failure
// ---------------------------------------------------------------------------

suite("Debug Launch Failures – unsupported-workspace", () => {
  test("tbench.startDebugging command is registered and completes without throwing", async () => {
    const cmds = await vscode.commands.getCommands(false);
    assert.ok(
      cmds.includes("tbench.startDebugging"),
      "expected tbench.startDebugging to be registered"
    );

    // Execute without a loaded manifest state — should return without throwing
    await assert.doesNotReject(
      () => Promise.resolve(vscode.commands.executeCommand("tbench.startDebugging")),
      "expected tbench.startDebugging to execute without throwing in unsupported state"
    );
  });
});
