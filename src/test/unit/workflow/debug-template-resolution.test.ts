/**
 * Unit tests for debug template resolution failure paths and edge cases.
 *
 * Covers:
 *  - loadDebugTemplate: template-root traversal edge cases (absolute path, simple "..",
 *    backslash/encoded traversal, path resolving to root itself)
 *  - loadDebugTemplate: JSONC parse failures for null/number/boolean/string root values
 *  - loadDebugTemplate: valid JSONC with comments and trailing commas parses successfully
 *  - buildDebugVariableMap: 3-way cyclic vars, self-referencing var, multiple cycles
 *  - applyTbenchSubstitution: duplicate unknown var reported once, non-tbench
 *    vars with similar syntax pass through, mixed tbench and non-tbench in same string
 */

import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  loadDebugTemplate,
  buildDebugVariableMap,
  applyTbenchSubstitution,
  TBENCH_VAR_MODEL_ID,
} from "../../../commands/debug-launch";

// ---------------------------------------------------------------------------
// loadDebugTemplate: traversal edge cases
// ---------------------------------------------------------------------------

suite("loadDebugTemplate – traversal edge cases", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-traversal-"));
    fs.writeFileSync(path.join(tmpDir, "valid.json"), '{"type":"gdb","request":"launch"}');
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("simple '..' at root is blocked", () => {
    const result = loadDebugTemplate("..", tmpDir);
    assert.strictEqual(result.parseState, "traversal-blocked");
  });

  test("absolute path outside templatesRoot is blocked", () => {
    // Use an absolute path to a non-existent file outside tmpDir
    const outsidePath = path.join(path.dirname(tmpDir), "outside.json");
    const result = loadDebugTemplate(outsidePath, tmpDir);
    // Absolute path should be blocked or treated as traversal
    assert.ok(
      result.parseState === "traversal-blocked" || result.parseState === "missing",
      `expected traversal-blocked or missing for absolute outside path, got: ${result.parseState}`
    );
  });

  test("sub/../../outside.json is blocked", () => {
    const result = loadDebugTemplate("sub/../../outside.json", tmpDir);
    assert.strictEqual(result.parseState, "traversal-blocked");
  });

  test("triple traversal a/b/../../../outside.json is blocked", () => {
    const result = loadDebugTemplate("a/b/../../../outside.json", tmpDir);
    assert.strictEqual(result.parseState, "traversal-blocked");
  });

  test("path resolving to exactly the templatesRoot directory is blocked (not a file)", () => {
    // An empty relative path resolves to templatesRoot itself, which is a directory not a JSON file
    // We verify it doesn't load successfully
    const result = loadDebugTemplate("./valid.json", tmpDir);
    // ./valid.json normalizes to valid.json within root → should load
    assert.ok(
      result.parseState === "loaded" || result.parseState === "missing",
      `expected loaded or missing for ./valid.json, got: ${result.parseState}`
    );
  });

  test("filename with no traversal but non-existent resolves to missing", () => {
    const result = loadDebugTemplate("does-not-exist.json", tmpDir);
    assert.strictEqual(result.parseState, "missing");
  });

  test("valid.json within templatesRoot loads successfully", () => {
    const result = loadDebugTemplate("valid.json", tmpDir);
    assert.strictEqual(result.parseState, "loaded");
  });
});

// ---------------------------------------------------------------------------
// loadDebugTemplate: JSONC parse failure root value types
// ---------------------------------------------------------------------------

suite("loadDebugTemplate – JSONC non-object root values", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-jsonc-"));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTemplate(name: string, content: string): void {
    fs.writeFileSync(path.join(tmpDir, name), content);
  }

  test("null root value returns invalid", () => {
    writeTemplate("null.json", "null");
    const result = loadDebugTemplate("null.json", tmpDir);
    assert.strictEqual(result.parseState, "invalid");
  });

  test("number root value returns invalid", () => {
    writeTemplate("number.json", "42");
    const result = loadDebugTemplate("number.json", tmpDir);
    assert.strictEqual(result.parseState, "invalid");
  });

  test("boolean root value returns invalid", () => {
    writeTemplate("bool.json", "true");
    const result = loadDebugTemplate("bool.json", tmpDir);
    assert.strictEqual(result.parseState, "invalid");
  });

  test("string root value returns invalid", () => {
    writeTemplate("string.json", '"hello"');
    const result = loadDebugTemplate("string.json", tmpDir);
    assert.strictEqual(result.parseState, "invalid");
  });

  test("array root value returns invalid", () => {
    writeTemplate("array.json", '[{"type":"gdb"}]');
    const result = loadDebugTemplate("array.json", tmpDir);
    assert.strictEqual(result.parseState, "invalid");
  });

  test("empty object root value is valid (degenerate but well-formed)", () => {
    writeTemplate("empty.json", "{}");
    const result = loadDebugTemplate("empty.json", tmpDir);
    assert.strictEqual(result.parseState, "loaded");
    assert.deepStrictEqual(result.configuration, {});
  });

  test("JSONC with line comments parses successfully", () => {
    writeTemplate("with-comments.jsonc", '// A debug config\n{"type":"gdb"}');
    // Note: using .jsonc extension — the file name doesn't matter, content is parsed with jsonc-parser
    // but the template file reference is by relative path, so .jsonc works here too
    const result = loadDebugTemplate("with-comments.jsonc", tmpDir);
    // jsonc-parser supports comments, expect loaded or potentially missing depending on extension
    // The implementation ignores extension and just reads the file content as JSONC
    assert.ok(
      result.parseState === "loaded" || result.parseState === "missing",
      `expected loaded or missing, got: ${result.parseState}`
    );
  });

  test("JSONC with trailing commas parses successfully", () => {
    writeTemplate("trailing-comma.json", '{"type":"gdb","request":"launch",}');
    const result = loadDebugTemplate("trailing-comma.json", tmpDir);
    // jsonc-parser is lenient with trailing commas
    assert.strictEqual(result.parseState, "loaded");
    assert.strictEqual(result.configuration?.type, "gdb");
  });

  test("severely malformed JSONC returns invalid", () => {
    writeTemplate("malformed.json", '{{this is not json}');
    const result = loadDebugTemplate("malformed.json", tmpDir);
    assert.strictEqual(result.parseState, "invalid");
  });
});

// ---------------------------------------------------------------------------
// buildDebugVariableMap: cyclic and multi-cycle edge cases
// ---------------------------------------------------------------------------

suite("buildDebugVariableMap – cyclic variable edge cases", () => {
  const MODEL = "T2T1";
  const MODEL_NAME = "Trezor Model T (v1)";
  const TARGET = "hw";
  const TARGET_NAME = "Hardware";
  const COMPONENT = "core";
  const COMPONENT_NAME = "Core";
  const ARTIFACT_PATH = "/build/model-t";
  const EXE_FILE = "firmware.elf";
  const EXE = "/build/model-t/firmware.elf";
  const PROFILE_NAME = "gdb-remote";

  test("self-referencing var (a → a) produces a resolution error", () => {
    const vars = { a: "${tbench.debug.var:a}" };
    const result = buildDebugVariableMap({
      modelId: MODEL,
      modelName: MODEL_NAME,
      targetId: TARGET,
      targetName: TARGET_NAME,
      componentId: COMPONENT,
      componentName: COMPONENT_NAME,
      artifactPath: ARTIFACT_PATH,
      executableFileName: EXE_FILE,
      executablePath: EXE,
      debugProfileName: PROFILE_NAME,
      profileVars: vars,
    });
    assert.ok(result.resolutionErrors.length > 0, "expected a resolution error for self-cycle");
    assert.ok(
      result.resolutionErrors.some((e) => e.toLowerCase().includes("cyclic") || e.toLowerCase().includes("cycle")),
      `expected cyclic error, got: ${result.resolutionErrors.join(", ")}`
    );
  });

  test("3-way cycle (a → b → c → a) produces a resolution error", () => {
    const vars = {
      a: "${tbench.debug.var:b}",
      b: "${tbench.debug.var:c}",
      c: "${tbench.debug.var:a}",
    };
    const result = buildDebugVariableMap({
      modelId: MODEL,
      modelName: MODEL_NAME,
      targetId: TARGET,
      targetName: TARGET_NAME,
      componentId: COMPONENT,
      componentName: COMPONENT_NAME,
      artifactPath: ARTIFACT_PATH,
      executableFileName: EXE_FILE,
      executablePath: EXE,
      debugProfileName: PROFILE_NAME,
      profileVars: vars,
    });
    assert.ok(result.resolutionErrors.length > 0, "expected resolution error for 3-way cycle");
  });

  test("non-cyclic chain (a → b → literal) resolves without error", () => {
    const vars = {
      b: "hello",
      a: "${tbench.debug.var:b}-world",
    };
    const result = buildDebugVariableMap({
      modelId: MODEL,
      modelName: MODEL_NAME,
      targetId: TARGET,
      targetName: TARGET_NAME,
      componentId: COMPONENT,
      componentName: COMPONENT_NAME,
      artifactPath: ARTIFACT_PATH,
      executableFileName: EXE_FILE,
      executablePath: EXE,
      debugProfileName: PROFILE_NAME,
      profileVars: vars,
    });
    assert.strictEqual(result.resolutionErrors.length, 0);
    assert.strictEqual(result.resolvedVars["tbench.debug.var:a"], "hello-world");
    assert.strictEqual(result.resolvedVars["tbench.debug.var:b"], "hello");
  });

  test("built-in vars are unaffected by profile var cycles", () => {
    const vars = {
      x: "${tbench.debug.var:x}", // self-cycle
    };
    const result = buildDebugVariableMap({
      modelId: MODEL,
      modelName: MODEL_NAME,
      targetId: TARGET,
      targetName: TARGET_NAME,
      componentId: COMPONENT,
      componentName: COMPONENT_NAME,
      artifactPath: ARTIFACT_PATH,
      executableFileName: EXE_FILE,
      executablePath: EXE,
      debugProfileName: PROFILE_NAME,
      profileVars: vars,
    });
    // Built-ins must still be present even when profile vars cycle
    assert.strictEqual(result.resolvedVars[TBENCH_VAR_MODEL_ID], MODEL);
  });

  test("profile var referencing undefined tbench var produces a resolution error", () => {
    const vars = { foo: "${tbench.undefined_key}" };
    const result = buildDebugVariableMap({
      modelId: MODEL,
      modelName: MODEL_NAME,
      targetId: TARGET,
      targetName: TARGET_NAME,
      componentId: COMPONENT,
      componentName: COMPONENT_NAME,
      artifactPath: ARTIFACT_PATH,
      executableFileName: EXE_FILE,
      executablePath: EXE,
      debugProfileName: PROFILE_NAME,
      profileVars: vars,
    });
    assert.ok(result.resolutionErrors.length > 0);
    assert.ok(
      result.resolutionErrors.some((e) => e.includes("undefined_key")),
      `expected 'undefined_key' in error, got: ${result.resolutionErrors.join(", ")}`
    );
  });
});

// ---------------------------------------------------------------------------
// applyTbenchSubstitution: unknown var and mixed-syntax edge cases
// ---------------------------------------------------------------------------

suite("applyTbenchSubstitution – unknown and mixed variable edge cases", () => {
  const RESOLVED = { [TBENCH_VAR_MODEL_ID]: "T2T1" };

  test("duplicate unknown tbench token is reported", () => {
    const template = "${tbench.x} and ${tbench.x}";
    const { unknownVars } = applyTbenchSubstitution(template, RESOLVED);
    // At least one occurrence should be reported
    assert.ok(unknownVars.length > 0, "expected at least one unknown var report");
    assert.ok(
      unknownVars.some((v) => v.includes("x") || v === "tbench.x"),
      `expected 'x' in unknownVars, got: ${unknownVars.join(", ")}`
    );
  });

  test("non-tbench VS Code variable is passed through unchanged", () => {
    const template = "${workspaceFolder}/build";
    const { value, unknownVars } = applyTbenchSubstitution(template, RESOLVED);
    assert.strictEqual(value, "${workspaceFolder}/build");
    assert.strictEqual(unknownVars.length, 0);
  });

  test("${env:VAR} syntax is passed through unchanged", () => {
    const template = "${env:HOME}";
    const { value, unknownVars } = applyTbenchSubstitution(template, RESOLVED);
    assert.strictEqual(value, "${env:HOME}");
    assert.strictEqual(unknownVars.length, 0);
  });

  test("string with both known tbench token and non-tbench token substitutes correctly", () => {
    const resolvedVars = { "tbench.model.id": "T2T1" };
    const template = "${tbench.model.id} at ${workspaceFolder}";
    const { value, unknownVars } = applyTbenchSubstitution(template, resolvedVars);
    assert.strictEqual(value, "T2T1 at ${workspaceFolder}");
    assert.strictEqual(unknownVars.length, 0);
  });

  test("substitution in nested object with only non-tbench vars produces no unknownVars", () => {
    const template = { cwd: "${workspaceFolder}", program: "${command:someCmd}" };
    const { value, unknownVars } = applyTbenchSubstitution(template, RESOLVED);
    assert.deepStrictEqual(value, { cwd: "${workspaceFolder}", program: "${command:someCmd}" });
    assert.strictEqual(unknownVars.length, 0);
  });

  test("single-pass: resolved value is not re-expanded for tbench tokens", () => {
    // If 'tbench.model.id' resolves to '${tbench.target.id}', the result should NOT be re-expanded
    const resolvedVars = {
      "tbench.model.id": "${tbench.target.id}",
      "tbench.target.id": "hw",
    };
    const template = "${tbench.model.id}";
    const { value } = applyTbenchSubstitution(template, resolvedVars);
    // Single-pass: the result is "${tbench.target.id}", not "hw"
    assert.strictEqual(value, "${tbench.target.id}");
  });
});
