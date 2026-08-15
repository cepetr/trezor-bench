/**
 * Unit tests for artifact-path derivation and no-fallback resolution.
 *
 * Covers:
 *  - deriveArtifactPath: constructs correct path from all inputs
 *  - deriveArtifactPath: returns undefined when any required input is missing
 *  - resolveCompileCommandsArtifact: returns "missing" status when file does not exist
 *  - resolveCompileCommandsArtifact: no-fallback — uses only the exact expected path
 *  - buildResolutionInputs: correctly extracts artifact fields from manifest
 *  - buildResolutionInputs: returns undefined for unknown model/target/component
 *  - resolveExecutableArtifact: status and profileResolutionState for all blocked cases
 *  - resolveExecutableArtifact: valid status when component entry resolves and file exists
 */

import * as assert from "assert";
import * as path from "path";
import {
  deriveArtifactPath,
  deriveBinaryArtifactPath,
  deriveMapArtifactPath,
  resolveCompileCommandsArtifact,
  resolveBinaryArtifact,
  resolveMapArtifact,
  resolveExecutableArtifact,
  buildResolutionInputs,
  makeContextKey,
} from "../../../intellisense/artifact-resolution";
import { ArtifactResolutionInputs } from "../../../intellisense/intellisense-types";
import { makeIntelliSenseLoadedState, makeDebugLoadedState, makeComponentDebugProfile, makeDebugTargetWithExtension } from "../workflow-test-helpers";
import { BuildSelection } from "../../../build/build-selection";
import { ManifestStateLoaded } from "../../../manifest/manifest-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ARTIFACTS_ROOT = "/workspace/build";

function makeInputs(overrides: Partial<ArtifactResolutionInputs> = {}): ArtifactResolutionInputs {
  return {
    artifactsRoot: ARTIFACTS_ROOT,
    modelId: "T2T1",
    artifactFolder: "model-t",
    componentId: "core",
    artifactName: "compile_commands_core",
    targetId: "hw",
    artifactSuffix: "",
    ...overrides,
  };
}

function makeBuildSelection(overrides: Partial<BuildSelection> = {}): BuildSelection {
  return {
    modelId: "T2T1",
    targetId: "hw",
    componentId: "core",
    persistedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// makeContextKey
// ---------------------------------------------------------------------------

suite("makeContextKey", () => {
  test("produces a stable key from model, target, and component ids", () => {
    const key = makeContextKey(makeBuildSelection());
    assert.strictEqual(key, "T2T1::hw::core");
  });

  test("distinct configs produce distinct keys", () => {
    const keyA = makeContextKey(makeBuildSelection({ modelId: "T2T1" }));
    const keyB = makeContextKey(makeBuildSelection({ modelId: "T3W1" }));
    assert.notStrictEqual(keyA, keyB);
  });
});

// ---------------------------------------------------------------------------
// deriveArtifactPath
// ---------------------------------------------------------------------------

suite("deriveArtifactPath", () => {
  test("constructs the correct .cc.json path with no suffix", () => {
    const result = deriveArtifactPath(makeInputs());
    const expected = path.join(ARTIFACTS_ROOT, "model-t", "compile_commands_core.cc.json");
    assert.strictEqual(result, expected);
  });

  test("appends artifactSuffix to the basename", () => {
    const result = deriveArtifactPath(makeInputs({ artifactSuffix: "_emu" }));
    const expected = path.join(ARTIFACTS_ROOT, "model-t", "compile_commands_core_emu.cc.json");
    assert.strictEqual(result, expected);
  });

  test("returns undefined when artifactsRoot is empty", () => {
    const result = deriveArtifactPath(makeInputs({ artifactsRoot: "" }));
    assert.strictEqual(result, undefined);
  });

  test("returns undefined when artifactFolder is undefined", () => {
    const result = deriveArtifactPath(makeInputs({ artifactFolder: undefined }));
    assert.strictEqual(result, undefined);
  });

  test("returns undefined when artifactName is undefined", () => {
    const result = deriveArtifactPath(makeInputs({ artifactName: undefined }));
    assert.strictEqual(result, undefined);
  });

  test("treats an empty artifactSuffix as no suffix", () => {
    const result = deriveArtifactPath(makeInputs({ artifactSuffix: "" }));
    const expected = path.join(ARTIFACTS_ROOT, "model-t", "compile_commands_core.cc.json");
    assert.strictEqual(result, expected);
  });

  test("uses artifactFolder from model, not model id, as the folder segment", () => {
    const result = deriveArtifactPath(makeInputs({ artifactFolder: "custom-folder", modelId: "SHOULD_NOT_APPEAR" }));
    assert.ok(result?.includes("custom-folder"), `expected 'custom-folder' in path, got: ${result}`);
    assert.ok(!result?.includes("SHOULD_NOT_APPEAR"), `model id should not appear in path: ${result}`);
  });

  test("uses artifactName from component, not component id, as the basename stem", () => {
    const result = deriveArtifactPath(makeInputs({ artifactName: "cc_override", componentId: "SHOULD_NOT_APPEAR" }));
    assert.ok(result?.includes("cc_override"), `expected 'cc_override' in path, got: ${result}`);
    assert.ok(!result?.includes("SHOULD_NOT_APPEAR"), `component id should not appear in path: ${result}`);
  });
});

// ---------------------------------------------------------------------------
// resolveCompileCommandsArtifact — no-fallback (no real files needed for these tests)
// ---------------------------------------------------------------------------

suite("resolveCompileCommandsArtifact — status and no-fallback", () => {
  const config = makeBuildSelection();

  test("returns missing status when the expected file does not exist", () => {
    const inputs = makeInputs({ artifactsRoot: "/does/not/exist" });
    const result = resolveCompileCommandsArtifact(inputs, config);
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.exists, false);
  });

  test("includes the expected path in the result even when missing", () => {
    const inputs = makeInputs({ artifactsRoot: "/does/not/exist" });
    const result = resolveCompileCommandsArtifact(inputs, config);
    assert.ok(result.path.endsWith(".cc.json"), `path should end with .cc.json, got: ${result.path}`);
  });

  test("reports missing-reason when artifactsRoot is empty (no-fallback: not searching elsewhere)", () => {
    const inputs = makeInputs({ artifactsRoot: "" });
    const result = resolveCompileCommandsArtifact(inputs, config);
    assert.strictEqual(result.status, "missing");
    assert.ok(
      result.missingReason?.includes("build-artifacts"),
      `expected missingReason to mention 'build-artifacts', got: ${result.missingReason}`
    );
  });

  test("reports missing-reason when artifactFolder is missing", () => {
    const inputs = makeInputs({ artifactFolder: undefined });
    const result = resolveCompileCommandsArtifact(inputs, config);
    assert.strictEqual(result.status, "missing");
    assert.ok(result.missingReason?.includes("artifactFolder"), `expected 'artifactFolder' in missingReason, got: ${result.missingReason}`);
  });

  test("reports missing-reason when artifactName is missing", () => {
    const inputs = makeInputs({ artifactName: undefined });
    const result = resolveCompileCommandsArtifact(inputs, config);
    assert.strictEqual(result.status, "missing");
    assert.ok(result.missingReason?.includes("artifactName"), `expected 'artifactName' in missingReason, got: ${result.missingReason}`);
  });

  test("contextKey includes active model, target, and component", () => {
    const inputs = makeInputs({ artifactsRoot: "/does/not/exist" });
    const result = resolveCompileCommandsArtifact(inputs, config);
    assert.strictEqual(result.contextKey, "T2T1::hw::core");
  });
});

// ---------------------------------------------------------------------------
// buildResolutionInputs
// ---------------------------------------------------------------------------

suite("buildResolutionInputs", () => {
  const validConfig: BuildSelection = {
    modelId: "T2T1",
    targetId: "hw",
    componentId: "core",
    persistedAt: "2026-01-01T00:00:00Z",
  };

  test("extracts artifactFolder from the model", () => {
    const manifest = makeIntelliSenseLoadedState();
    const result = buildResolutionInputs(manifest, validConfig, ARTIFACTS_ROOT);
    assert.strictEqual(result?.artifactFolder, "model-t");
  });

  test("extracts artifactName from the component", () => {
    const manifest = makeIntelliSenseLoadedState();
    const result = buildResolutionInputs(manifest, validConfig, ARTIFACTS_ROOT);
    assert.strictEqual(result?.artifactName, "compile_commands_core");
  });

  test("extracts empty artifactSuffix for target without suffix", () => {
    const manifest = makeIntelliSenseLoadedState();
    const result = buildResolutionInputs(manifest, validConfig, ARTIFACTS_ROOT);
    assert.strictEqual(result?.artifactSuffix, "");
  });

  test("extracts non-empty artifactSuffix for target with suffix", () => {
    const manifest = makeIntelliSenseLoadedState();
    const config: BuildSelection = { ...validConfig, targetId: "emu" };
    const result = buildResolutionInputs(manifest, config, ARTIFACTS_ROOT);
    assert.strictEqual(result?.artifactSuffix, "_emu");
  });

  test("returns undefined for unknown model id", () => {
    const manifest = makeIntelliSenseLoadedState();
    const config: BuildSelection = { ...validConfig, modelId: "UNKNOWN" };
    const result = buildResolutionInputs(manifest, config, ARTIFACTS_ROOT);
    assert.strictEqual(result, undefined);
  });

  test("returns undefined for unknown component id", () => {
    const manifest = makeIntelliSenseLoadedState();
    const config: BuildSelection = { ...validConfig, componentId: "UNKNOWN" };
    const result = buildResolutionInputs(manifest, config, ARTIFACTS_ROOT);
    assert.strictEqual(result, undefined);
  });

  test("passes through the artifactsRoot unchanged", () => {
    const manifest = makeIntelliSenseLoadedState();
    const result = buildResolutionInputs(manifest, validConfig, ARTIFACTS_ROOT);
    assert.strictEqual(result?.artifactsRoot, ARTIFACTS_ROOT);
  });
});

// ---------------------------------------------------------------------------
// Regression coverage for artifactsPath changes and suffix transitions
// ---------------------------------------------------------------------------

suite("artifactsPath change regression", () => {
  test("changing artifactsRoot produces a different path", () => {
    const pathA = deriveArtifactPath(makeInputs({ artifactsRoot: "/build/v1" }));
    const pathB = deriveArtifactPath(makeInputs({ artifactsRoot: "/build/v2" }));
    assert.notStrictEqual(pathA, pathB);
  });

  test("path with new artifactsRoot starts with the new root", () => {
    const newRoot = "/custom/artifacts";
    const result = deriveArtifactPath(makeInputs({ artifactsRoot: newRoot }));
    assert.ok(result?.startsWith(newRoot), `expected path to start with ${newRoot}, got ${result}`);
  });

  test("setting artifactsRoot to empty makes path undefined", () => {
    const result = deriveArtifactPath(makeInputs({ artifactsRoot: "" }));
    assert.strictEqual(result, undefined);
  });

  test("buildResolutionInputs passes the provided artifactsRoot without modification", () => {
    const manifest = makeIntelliSenseLoadedState();
    const config = makeBuildSelection();
    const root = "/new/artifacts/root";
    const inputs = buildResolutionInputs(manifest, config, root);
    assert.strictEqual(inputs?.artifactsRoot, root);
  });

  test("resolveCompileCommandsArtifact reflects artifactsRoot in the returned path", () => {
    const inputs = makeInputs({ artifactsRoot: "/custom/root" });
    const result = resolveCompileCommandsArtifact(inputs, makeBuildSelection());
    assert.ok(result.path.startsWith("/custom/root"), `expected path to start with /custom/root, got ${result.path}`);
  });
});

suite("target suffix transition regression", () => {
  test("switching from no-suffix target to suffixed target changes the path", () => {
    const noSuffix = deriveArtifactPath(makeInputs({ artifactSuffix: "" }));
    const withSuffix = deriveArtifactPath(makeInputs({ artifactSuffix: "_emu" }));
    assert.notStrictEqual(noSuffix, withSuffix);
  });

  test("path with suffix includes the suffix before .cc.json", () => {
    const result = deriveArtifactPath(makeInputs({ artifactSuffix: "_emu" }));
    assert.ok(result?.endsWith("_emu.cc.json"), `expected path to end with '_emu.cc.json', got: ${result}`);
  });

  test("path without suffix ends with <artifactName>.cc.json (no extra underscore)", () => {
    const result = deriveArtifactPath(makeInputs({ artifactSuffix: "" }));
    assert.ok(result?.endsWith("compile_commands_core.cc.json"), `expected path to end with 'compile_commands_core.cc.json', got: ${result}`);
  });

  test("buildResolutionInputs picks up artifactSuffix from target", () => {
    const manifest = makeIntelliSenseLoadedState();
    // The intellisense-valid state has an 'emu' target with artifactSuffix
    const config = makeBuildSelection({ targetId: "emu" });
    const inputs = buildResolutionInputs(manifest, config, ARTIFACTS_ROOT);
    assert.ok(inputs, "expected inputs to be defined for emu target");
    assert.strictEqual(inputs!.artifactSuffix, "_emu");
  });

  test("buildResolutionInputs uses empty string artifactSuffix for target without suffix", () => {
    const manifest = makeIntelliSenseLoadedState();
    const config = makeBuildSelection({ targetId: "hw" });
    const inputs = buildResolutionInputs(manifest, config, ARTIFACTS_ROOT);
    assert.ok(inputs, "expected inputs for hw target");
    assert.strictEqual(inputs!.artifactSuffix, "");
  });

  test("contextKey differs between suffixed and non-suffixed target", () => {
    const keyHw = makeContextKey(makeBuildSelection({ targetId: "hw" }));
    const keyEmu = makeContextKey(makeBuildSelection({ targetId: "emu" }));
    assert.notStrictEqual(keyHw, keyEmu);
  });
});

// ---------------------------------------------------------------------------
// deriveBinaryArtifactPath
// ---------------------------------------------------------------------------

suite("deriveBinaryArtifactPath", () => {
  test("constructs correct .bin path for all inputs", () => {
    const inputs = makeInputs();
    const result = deriveBinaryArtifactPath(inputs);
    assert.strictEqual(
      result,
      path.join(ARTIFACTS_ROOT, "model-t", "compile_commands_core.bin")
    );
  });

  test("appends artifactSuffix before .bin extension", () => {
    const inputs = makeInputs({ artifactSuffix: "_emu" });
    const result = deriveBinaryArtifactPath(inputs);
    assert.strictEqual(
      result,
      path.join(ARTIFACTS_ROOT, "model-t", "compile_commands_core_emu.bin")
    );
  });

  test("returns undefined when artifactsRoot is missing", () => {
    const inputs = makeInputs({ artifactsRoot: "" });
    assert.strictEqual(deriveBinaryArtifactPath(inputs), undefined);
  });

  test("returns undefined when artifactFolder is missing", () => {
    const inputs = makeInputs({ artifactFolder: "" });
    assert.strictEqual(deriveBinaryArtifactPath(inputs), undefined);
  });

  test("returns undefined when artifactName is missing", () => {
    const inputs = makeInputs({ artifactName: "" });
    assert.strictEqual(deriveBinaryArtifactPath(inputs), undefined);
  });
});

// ---------------------------------------------------------------------------
// deriveMapArtifactPath
// ---------------------------------------------------------------------------

suite("deriveMapArtifactPath", () => {
  test("constructs correct .map path for all inputs", () => {
    const inputs = makeInputs();
    const result = deriveMapArtifactPath(inputs);
    assert.strictEqual(
      result,
      path.join(ARTIFACTS_ROOT, "model-t", "compile_commands_core.map")
    );
  });

  test("appends artifactSuffix before .map extension", () => {
    const inputs = makeInputs({ artifactSuffix: "_emu" });
    const result = deriveMapArtifactPath(inputs);
    assert.strictEqual(
      result,
      path.join(ARTIFACTS_ROOT, "model-t", "compile_commands_core_emu.map")
    );
  });

  test("returns undefined when artifactsRoot is missing", () => {
    const inputs = makeInputs({ artifactsRoot: "" });
    assert.strictEqual(deriveMapArtifactPath(inputs), undefined);
  });

  test("returns undefined when artifactFolder is missing", () => {
    const inputs = makeInputs({ artifactFolder: "" });
    assert.strictEqual(deriveMapArtifactPath(inputs), undefined);
  });

  test("returns undefined when artifactName is missing", () => {
    const inputs = makeInputs({ artifactName: "" });
    assert.strictEqual(deriveMapArtifactPath(inputs), undefined);
  });
});

// ---------------------------------------------------------------------------
// resolveBinaryArtifact
// ---------------------------------------------------------------------------

suite("resolveBinaryArtifact", () => {
  test("returns missing status when binary file does not exist on disk", () => {
    const inputs = makeInputs({
      artifactsRoot: "/nonexistent/root",
    });
    const result = resolveBinaryArtifact(inputs, makeBuildSelection());
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.exists, false);
  });

  test("sets contextKey matching active config", () => {
    const config = makeBuildSelection({ modelId: "T2T1", targetId: "hw", componentId: "core" });
    const result = resolveBinaryArtifact(makeInputs(), config);
    assert.strictEqual(result.contextKey, "T2T1::hw::core");
  });

  test("includes expected path in result", () => {
    const result = resolveBinaryArtifact(makeInputs(), makeBuildSelection());
    assert.ok(result.path.endsWith(".bin"), `expected .bin path, got: ${result.path}`);
  });

  test("returns missing with missingReason when inputs cannot derive path", () => {
    const inputs = makeInputs({ artifactsRoot: "" });
    const result = resolveBinaryArtifact(inputs, makeBuildSelection());
    assert.strictEqual(result.status, "missing");
    assert.ok(result.missingReason, "expected a missingReason string");
  });

  test("path is empty string when inputs cannot derive path", () => {
    const inputs = makeInputs({ artifactsRoot: "" });
    const result = resolveBinaryArtifact(inputs, makeBuildSelection());
    assert.strictEqual(result.path, "");
  });
});

// ---------------------------------------------------------------------------
// resolveMapArtifact
// ---------------------------------------------------------------------------

suite("resolveMapArtifact", () => {
  test("returns missing status when map file does not exist on disk", () => {
    const inputs = makeInputs({
      artifactsRoot: "/nonexistent/root",
    });
    const result = resolveMapArtifact(inputs, makeBuildSelection());
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.exists, false);
  });

  test("sets contextKey matching active config", () => {
    const config = makeBuildSelection({ modelId: "T2T1", targetId: "hw", componentId: "core" });
    const result = resolveMapArtifact(makeInputs(), config);
    assert.strictEqual(result.contextKey, "T2T1::hw::core");
  });

  test("includes expected path in result", () => {
    const result = resolveMapArtifact(makeInputs(), makeBuildSelection());
    assert.ok(result.path.endsWith(".map"), `expected .map path, got: ${result.path}`);
  });

  test("returns missing with missingReason when inputs cannot derive path", () => {
    const inputs = makeInputs({ artifactsRoot: "" });
    const result = resolveMapArtifact(inputs, makeBuildSelection());
    assert.strictEqual(result.status, "missing");
    assert.ok(result.missingReason, "expected a missingReason string");
  });

  test("path is empty string when inputs cannot derive path", () => {
    const inputs = makeInputs({ artifactsRoot: "" });
    const result = resolveMapArtifact(inputs, makeBuildSelection());
    assert.strictEqual(result.path, "");
  });
});

// ---------------------------------------------------------------------------
// resolveExecutableArtifact
// ---------------------------------------------------------------------------

suite("resolveExecutableArtifact", () => {
  test("returns manifest-invalid state when hasDebugBlockingIssues is true", () => {
    const manifest = makeDebugLoadedState([], { hasDebugBlockingIssues: true });
    const config = makeBuildSelection();
    const result = resolveExecutableArtifact(manifest, config, ARTIFACTS_ROOT);
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.profileResolutionState, "manifest-invalid");
    assert.ok(result.missingReason, "expected a missingReason for manifest-invalid");
  });

  test("returns no-match state when component has no debug profiles", () => {
    const manifest = makeDebugLoadedState([]);
    const config = makeBuildSelection();
    const result = resolveExecutableArtifact(manifest, config, ARTIFACTS_ROOT);
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.profileResolutionState, "no-match");
    assert.ok(result.missingReason);
  });

  test("returns no-match state when all debug profiles have non-matching when", () => {
    const profile = makeComponentDebugProfile({
      name: "gdb",
      template: "t.json",
      when: { type: "model", id: "T3W1" },
    });
    const manifest = makeDebugLoadedState([profile]);
    const config = makeBuildSelection({ modelId: "T2T1" });
    const result = resolveExecutableArtifact(manifest, config, ARTIFACTS_ROOT);
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.profileResolutionState, "no-match");
    assert.ok(result.missingReason);
  });

  test("returns selected + missing when profile resolves but executable does not exist on disk", () => {
    const profile = makeComponentDebugProfile({ name: "gdb", template: "t.json" });
    const manifest = makeIntelliSenseLoadedState({
      targets: [makeDebugTargetWithExtension("hw", ".elf")],
      components: [
        { kind: "component", id: "core", name: "Core", artifactName: "firmware", debug: [profile] } as ManifestStateLoaded["components"][0],
      ],
      hasDebugBlockingIssues: false,
    });
    const config = makeBuildSelection();
    const result = resolveExecutableArtifact(manifest, config, ARTIFACTS_ROOT);
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.profileResolutionState, "selected");
    assert.strictEqual(result.exists, false);
    assert.ok(result.missingReason);
    assert.ok(result.path.endsWith("firmware.elf"), `expectedPath should end with firmware.elf, got: ${result.path}`);
  });

  test("returns selected + valid when profile resolves and executable file exists", () => {
    // Build a manifest whose derived path points to this test file (which exists).
    const artifactsRoot = path.resolve(path.dirname(__filename), "../../..");
    const artFolder = "test/unit/workflow";
    const artName = path.basename(__filename, path.extname(__filename));
    const artExt = path.extname(__filename);
    const profile = makeComponentDebugProfile({ name: "gdb", template: "t.json" });
    const manifest = makeIntelliSenseLoadedState({
      models: [{ kind: "model", id: "T2T1", name: "T", artifactFolder: artFolder } as ManifestStateLoaded["models"][0]],
      targets: [makeDebugTargetWithExtension("hw", artExt)],
      components: [
        { kind: "component", id: "core", name: "Core", artifactName: artName, debug: [profile] } as ManifestStateLoaded["components"][0],
      ],
      hasDebugBlockingIssues: false,
    });
    const config = makeBuildSelection();
    const result = resolveExecutableArtifact(manifest, config, artifactsRoot);
    assert.strictEqual(result.status, "valid");
    assert.strictEqual(result.profileResolutionState, "selected");
    assert.strictEqual(result.exists, true);
    assert.strictEqual(result.path, __filename);
    assert.ok(result.modifiedAt instanceof Date);
  });

  test("returns missing when artifactsRoot is empty", () => {
    const profile = makeComponentDebugProfile({ name: "gdb", template: "t.json" });
    const manifest = makeIntelliSenseLoadedState({
      targets: [makeDebugTargetWithExtension("hw", ".elf")],
      components: [
        { kind: "component", id: "core", name: "Core", artifactName: "fw", debug: [profile] } as ManifestStateLoaded["components"][0],
      ],
      hasDebugBlockingIssues: false,
    });
    const config = makeBuildSelection();
    const result = resolveExecutableArtifact(manifest, config, "");
    assert.strictEqual(result.status, "missing");
    assert.strictEqual(result.profileResolutionState, "selected");
    assert.ok(result.missingReason);
  });

  test("contextKey contains modelId, targetId, and componentId", () => {
    const manifest = makeDebugLoadedState([]);
    const config = makeBuildSelection({ modelId: "T2T1", targetId: "hw", componentId: "core" });
    const result = resolveExecutableArtifact(manifest, config, ARTIFACTS_ROOT);
    assert.strictEqual(result.contextKey, "T2T1::hw::core");
  });

  test("tooltip is non-empty for all blocked cases", () => {
    const cases = [
      makeDebugLoadedState([], { hasDebugBlockingIssues: true }),
      makeDebugLoadedState([]),
    ];
    for (const manifest of cases) {
      const result = resolveExecutableArtifact(manifest, makeBuildSelection(), ARTIFACTS_ROOT);
      assert.ok(result.tooltip.length > 0, `expected non-empty tooltip, got: "${result.tooltip}"`);
    }
  });

  test("expectedPath is empty when profile resolution returns no-match", () => {
    const manifest = makeDebugLoadedState([]);
    const config = makeBuildSelection();
    const result = resolveExecutableArtifact(manifest, config, ARTIFACTS_ROOT);
    assert.strictEqual(result.path, "");
  });

  test("selected profile with missing executable includes expectedPath in result", () => {
    const profile = makeComponentDebugProfile({ name: "gdb", template: "t.json" });
    const manifest = makeIntelliSenseLoadedState({
      targets: [makeDebugTargetWithExtension("hw", ".elf")],
      components: [
        { kind: "component", id: "core", name: "Core", artifactName: "specific", debug: [profile] } as ManifestStateLoaded["components"][0],
      ],
      hasDebugBlockingIssues: false,
    });
    const config = makeBuildSelection();
    const result = resolveExecutableArtifact(manifest, config, ARTIFACTS_ROOT);
    assert.ok(result.path.includes("specific.elf"), `expectedPath should include specific.elf, got: ${result.path}`);
  });
});
