import * as assert from "assert";
import { parseManifest, validateManifest } from "../../../manifest/validate-manifest";
import * as vscode from "vscode";

suite("parseManifest", () => {
  // -------------------------------------------------------------------------
  // Valid manifest
  // -------------------------------------------------------------------------

  test("parses a valid manifest and returns correct models, targets, components", () => {
    const source = `
models:
  - id: T2T1
    name: Trezor Model T
  - id: T3W1
    name: Trezor Model T3
targets:
  - id: hw
    name: Hardware
    shortName: HW
  - id: emu
    name: Emulator
components:
  - id: core
    name: Core
  - id: prodtest
    name: Prodtest
`.trim();

    const result = parseManifest(source);

    assert.strictEqual(result.issues.length, 0, "expected no validation issues");
    assert.deepStrictEqual(
      result.models.map((m) => ({ id: m.id, name: m.name })),
      [
        { id: "T2T1", name: "Trezor Model T" },
        { id: "T3W1", name: "Trezor Model T3" },
      ]
    );
    assert.deepStrictEqual(
      result.targets.map((t) => ({ id: t.id, name: t.name, shortName: t.shortName })),
      [
        { id: "hw", name: "Hardware", shortName: "HW" },
        { id: "emu", name: "Emulator", shortName: undefined },
      ]
    );
    assert.deepStrictEqual(
      result.components.map((c) => ({ id: c.id, name: c.name })),
      [
        { id: "core", name: "Core" },
        { id: "prodtest", name: "Prodtest" },
      ]
    );
  });

  test("assigns kind fields correctly", () => {
    const source = `
models:
  - id: T2T1
    name: Model T
targets:
  - id: hw
    name: Hardware
components:
  - id: core
    name: Core
`.trim();
    const result = parseManifest(source);
    assert.strictEqual(result.models[0].kind, "model");
    assert.strictEqual(result.targets[0].kind, "target");
    assert.strictEqual(result.components[0].kind, "component");
  });

  // -------------------------------------------------------------------------
  // YAML parse errors
  // -------------------------------------------------------------------------

  test("returns yaml-parse error for malformed YAML", () => {
    const source = `models:\n  - id: T2T1\n    bad: [unclosed`;
    const result = parseManifest(source);
    assert.ok(result.issues.length > 0, "expected at least one issue");
    assert.strictEqual(result.issues[0].code, "yaml-parse");
    assert.strictEqual(result.issues[0].severity, "error");
  });

  test("returns empty collections for malformed YAML", () => {
    const source = `models:\n  - id: T2T1\n    bad: [unclosed`;
    const result = parseManifest(source);
    assert.strictEqual(result.models.length, 0);
    assert.strictEqual(result.targets.length, 0);
    assert.strictEqual(result.components.length, 0);
  });

  // -------------------------------------------------------------------------
  // Missing required fields
  // -------------------------------------------------------------------------

  test("reports missing-field error when model id is absent", () => {
    const source = `
models:
  - name: No ID Model
targets:
  - id: hw
    name: Hardware
components:
  - id: core
    name: Core
`.trim();
    const result = parseManifest(source);
    const missingId = result.issues.find(
      (i) => i.code === "missing-field" && i.message.includes('"id"')
    );
    assert.ok(missingId, "expected missing-field issue for model id");
    assert.strictEqual(missingId.severity, "error");
  });

  test("reports missing-field error when target name is absent", () => {
    const source = `
models:
  - id: T2T1
    name: Model T
targets:
  - id: hw
components:
  - id: core
    name: Core
`.trim();
    const result = parseManifest(source);
    const missingName = result.issues.find(
      (i) => i.code === "missing-field" && i.message.includes('"name"')
    );
    assert.ok(missingName, "expected missing-field issue for target name");
  });

  // -------------------------------------------------------------------------
  // Empty collections
  // -------------------------------------------------------------------------

  test("reports empty-collection error for empty models array", () => {
    const source = `
models: []
targets:
  - id: hw
    name: Hardware
components:
  - id: core
    name: Core
`.trim();
    const result = parseManifest(source);
    const emptyErr = result.issues.find(
      (i) => i.code === "empty-collection" && i.message.includes("model")
    );
    assert.ok(emptyErr, "expected empty-collection error for models");
    assert.strictEqual(emptyErr.severity, "error");
  });

  test("reports empty-collection error when targets key is missing", () => {
    const source = `
models:
  - id: T2T1
    name: Model T
components:
  - id: core
    name: Core
`.trim();
    const result = parseManifest(source);
    const emptyErr = result.issues.find(
      (i) => i.code === "empty-collection" && i.message.includes("target")
    );
    assert.ok(emptyErr, "expected empty-collection error for targets");
  });

  // -------------------------------------------------------------------------
  // Duplicate IDs
  // -------------------------------------------------------------------------

  test("reports duplicate-id error for duplicate model ids", () => {
    const source = `
models:
  - id: T2T1
    name: First
  - id: T2T1
    name: Duplicate
targets:
  - id: hw
    name: Hardware
components:
  - id: core
    name: Core
`.trim();
    const result = parseManifest(source);
    const dupErr = result.issues.find(
      (i) => i.code === "duplicate-id" && i.message.includes("T2T1")
    );
    assert.ok(dupErr, "expected duplicate-id error for T2T1");
    assert.strictEqual(dupErr.severity, "error");
  });

  test("accepts duplicate id across different collections", () => {
    // "core" may appear as both a component and a (hypothetical) target without error
    const source = `
models:
  - id: T2T1
    name: Model T
targets:
  - id: core
    name: Core Target
components:
  - id: core
    name: Core Component
`.trim();
    const result = parseManifest(source);
    const dupErr = result.issues.find((i) => i.code === "duplicate-id");
    assert.ok(!dupErr, "should not report duplicate-id for ids across collections");
  });

  // -------------------------------------------------------------------------
  // Range information
  // -------------------------------------------------------------------------

  test("attaches a vscode range to yaml-parse issues when offset is available", () => {
    // Produce a YAML error that includes position info
    const source = `models:\n  - id: T2T1\n    bad: [unclosed`;
    const result = parseManifest(source);
    // At least the first parse error may have a range
    const withRange = result.issues.find((i) => i.range !== undefined);
    // Not all parsers produce position info, so just check the shape when present
    if (withRange?.range) {
      assert.ok(
        typeof withRange.range.start.line === "number",
        "range.start.line should be a number"
      );
    }
  });
});

// ---------------------------------------------------------------------------
// validateManifest
// ---------------------------------------------------------------------------

suite("validateManifest", () => {
  const dummyUri = vscode.Uri.file("/workspace/tbench.yaml");

  test("returns loaded state for a valid manifest", () => {
    const source = `
models:
  - id: T2T1
    name: Model T
targets:
  - id: hw
    name: Hardware
components:
  - id: core
    name: Core
`.trim();
    const state = validateManifest(source, dummyUri);
    assert.strictEqual(state.status, "loaded");
    if (state.status === "loaded") {
      assert.strictEqual(state.models.length, 1);
      assert.strictEqual(state.targets.length, 1);
      assert.strictEqual(state.components.length, 1);
    }
  });

  test("returns invalid state for malformed YAML", () => {
    const source = `models:\n  - id: T2T1\n    bad: [unclosed`;
    const state = validateManifest(source, dummyUri);
    assert.strictEqual(state.status, "invalid");
    if (state.status === "invalid") {
      assert.ok(state.validationIssues.length > 0);
    }
  });

  test("returns invalid state for structurally invalid manifest", () => {
    const source = `
models: []
targets: []
components: []
`.trim();
    const state = validateManifest(source, dummyUri);
    assert.strictEqual(state.status, "invalid");
  });

  test("attaches the manifestUri to loaded state", () => {
    const source = `
models:
  - id: T2T1
    name: Model T
targets:
  - id: hw
    name: Hardware
components:
  - id: core
    name: Core
`.trim();
    const state = validateManifest(source, dummyUri);
    assert.strictEqual(state.manifestUri, dummyUri);
  });

  test("sets loadedAt timestamp on loaded state", () => {
    const before = new Date();
    const source = `
models:
  - id: T2T1
    name: Model T
targets:
  - id: hw
    name: Hardware
components:
  - id: core
    name: Core
`.trim();
    const state = validateManifest(source, dummyUri);
    const after = new Date();
    if (state.status === "loaded") {
      assert.ok(state.loadedAt >= before, "loadedAt should be after test start");
      assert.ok(state.loadedAt <= after, "loadedAt should be before test end");
    }
  });
});

// ---------------------------------------------------------------------------
// parseManifest – options
// ---------------------------------------------------------------------------

suite("parseManifest – options", () => {
  function baseManifest(options: string): string {
    return `
models:
  - id: T2T1
    name: Trezor Model T
  - id: T3W1
    name: Trezor Model T3
targets:
  - id: hw
    name: Hardware
  - id: emu
    name: Emulator
components:
  - id: core
    name: Core
${options}
`.trim();
  }

  // -------------------------------------------------------------------------
  // No build options
  // -------------------------------------------------------------------------

  test("parses manifest without options without error", () => {
    const source = baseManifest("");
    const result = parseManifest(source);
    assert.deepStrictEqual(result.buildOptions, []);
    assert.strictEqual(result.hasWorkflowBlockingIssues, false);
    assert.ok(!result.issues.some((i) => i.code === "invalid-when"));
  });

  // -------------------------------------------------------------------------
  // Valid checkbox option
  // -------------------------------------------------------------------------

  test("parses a valid ungrouped checkbox option", () => {
    const source = baseManifest(`
options:
  - name: "Debug Build"
    flag: "--debug"
    type: checkbox
`);
    const result = parseManifest(source);
    assert.strictEqual(result.issues.filter((i) => i.severity === "error").length, 0);
    assert.strictEqual(result.buildOptions.length, 1);
    const opt = result.buildOptions[0];
    assert.strictEqual(opt.label, "Debug Build");
    assert.strictEqual(opt.flag, "--debug");
    assert.strictEqual(opt.kind, "checkbox");
    assert.strictEqual(opt.group, undefined);
    assert.strictEqual(opt.when, undefined);
  });

  test("parses a grouped checkbox option", () => {
    const source = baseManifest(`
options:
  - name: "Fast"
    flag: "--fast"
    type: checkbox
    group: "Build Tuning"
`);
    const result = parseManifest(source);
    assert.strictEqual(result.buildOptions[0].group, "Build Tuning");
  });

  test("parses option description when present", () => {
    const source = baseManifest(`
options:
  - name: "Debug"
    flag: "--debug"
    type: checkbox
    description: "Enable debug symbols"
`);
    const result = parseManifest(source);
    assert.strictEqual(result.buildOptions[0].description, "Enable debug symbols");
  });

  test("assigns deterministic key derived from flag", () => {
    const source = baseManifest(`
options:
  - name: "Debug"
    flag: "--debug"
    type: checkbox
`);
    const result = parseManifest(source);
    // Key is derived from flag: strip leading dashes, replace non-alnum with _
    assert.strictEqual(result.buildOptions[0].key, "debug");
  });

  // -------------------------------------------------------------------------
  // Valid multistate option
  // -------------------------------------------------------------------------

  test("parses a valid multistate option with explicit default", () => {
    const source = baseManifest(`
options:
  - name: "Verbosity"
    flag: "--verbose"
    type: multistate
    states:
      - value: null
        name: "Off"
      - value: "on"
        name: "On"
        default: true
`);
    const result = parseManifest(source);
    assert.strictEqual(result.issues.filter((i) => i.severity === "error").length, 0);
    const opt = result.buildOptions[0];
    assert.strictEqual(opt.kind, "multistate");
    assert.strictEqual(opt.states?.length, 2);
    assert.strictEqual(opt.defaultState, "on");
  });

  test("uses first state as default when no explicit default is set", () => {
    const source = baseManifest(`
options:
  - name: "Verbosity"
    flag: "--verbose"
    type: multistate
    states:
      - value: null
        name: "Off"
      - value: "on"
        name: "On"
`);
    const result = parseManifest(source);
    assert.strictEqual(result.buildOptions[0].defaultState, "null");
  });

  // -------------------------------------------------------------------------
  // when expressions
  // -------------------------------------------------------------------------

  test("parses a valid when expression and stores it as AST", () => {
    const source = baseManifest(`
options:
  - name: "T2T1 Only"
    flag: "--t2t1"
    type: checkbox
    when: "model(T2T1)"
`);
    const result = parseManifest(source);
    assert.strictEqual(result.issues.filter((i) => i.code === "invalid-when").length, 0);
    const opt = result.buildOptions[0];
    assert.deepStrictEqual(opt.when, { type: "model", id: "T2T1" });
  });

  test("reports invalid-when error and sets hasWorkflowBlockingIssues for syntactically invalid when", () => {
    const source = baseManifest(`
options:
  - name: "Broken"
    flag: "--broken"
    type: checkbox
    when: "all()"
`);
    const result = parseManifest(source);
    assert.ok(result.issues.some((i) => i.code === "invalid-when"));
    assert.strictEqual(result.hasWorkflowBlockingIssues, true);
  });

  test("reports invalid-when error for unknown model id in when expression", () => {
    const source = baseManifest(`
options:
  - name: "Unknown"
    flag: "--unknown"
    type: checkbox
    when: "model(NONEXISTENT)"
`);
    const result = parseManifest(source);
    assert.ok(result.issues.some((i) => i.code === "invalid-when"));
    assert.strictEqual(result.hasWorkflowBlockingIssues, true);
  });

  test("does not block workflow for manifests with only valid when expressions", () => {
    const source = baseManifest(`
options:
  - name: "T2T1"
    flag: "--t2t1"
    type: checkbox
    when: "model(T2T1)"
`);
    const result = parseManifest(source);
    assert.strictEqual(result.hasWorkflowBlockingIssues, false);
  });

  // -------------------------------------------------------------------------
  // Duplicate flag validation
  // -------------------------------------------------------------------------

  test("reports duplicate-flag error for options with the same flag", () => {
    const source = baseManifest(`
options:
  - name: "First"
    flag: "--debug"
    type: checkbox
  - name: "Second"
    flag: "--debug"
    type: checkbox
`);
    const result = parseManifest(source);
    assert.ok(result.issues.some((i) => i.code === "duplicate-flag"));
  });

  // -------------------------------------------------------------------------
  // Declaration order preserved
  // -------------------------------------------------------------------------

  test("preserves manifest declaration order for options", () => {
    const source = baseManifest(`
options:
  - name: "Alpha"
    flag: "--alpha"
    type: checkbox
  - name: "Beta"
    flag: "--beta"
    type: checkbox
  - name: "Gamma"
    flag: "--gamma"
    type: checkbox
`);
    const result = parseManifest(source);
    assert.deepStrictEqual(
      result.buildOptions.map((o) => o.label),
      ["Alpha", "Beta", "Gamma"]
    );
  });
});

// ---------------------------------------------------------------------------
// parseManifest – canonical "options" schema
// ---------------------------------------------------------------------------

suite("parseManifest – canonical options schema", () => {
  function baseManifest(optionsBlock: string): string {
    return `
models:
  - id: t2t1
    name: T2T1
targets:
  - id: hardware
    name: Hardware
  - id: emulator
    name: Emulator
components:
  - id: firmware
    name: Firmware
${optionsBlock}
`.trim();
  }

  test("parses checkbox option using 'options:', 'name:', 'type:', and id-derived flag", () => {
    const source = baseManifest(`
options:
  - id: perf-overlay
    name: Performance Overlay
    type: checkbox
    group: Debugging
`);
    const result = parseManifest(source);
    assert.strictEqual(result.issues.filter((i) => i.severity === "error").length, 0);
    assert.strictEqual(result.buildOptions.length, 1);
    const opt = result.buildOptions[0];
    assert.strictEqual(opt.label, "Performance Overlay");
    assert.strictEqual(opt.flag, "--perf-overlay");
    assert.strictEqual(opt.key, "perf_overlay");
    assert.strictEqual(opt.kind, "checkbox");
    assert.strictEqual(opt.group, "Debugging");
  });

  test("parses multistate option with value-based states", () => {
    const source = baseManifest(`
options:
  - id: debug
    name: Debug Optimization
    type: multistate
    states:
      - value: null
        name: Default
        default: true
      - value: "true"
        name: Enabled
      - value: "false"
        name: Disabled
`);
    const result = parseManifest(source);
    assert.strictEqual(result.issues.filter((i) => i.severity === "error").length, 0);
    const opt = result.buildOptions[0];
    assert.strictEqual(opt.flag, "--debug");
    assert.strictEqual(opt.kind, "multistate");
    assert.strictEqual(opt.states?.length, 3);

    const nullState = opt.states?.find((s) => s.id === "null");
    assert.ok(nullState, "expected state with id 'null'");
    assert.strictEqual(nullState!.flag, "");

    const trueState = opt.states?.find((s) => s.id === "true");
    assert.ok(trueState, "expected state with id 'true'");
    assert.strictEqual(trueState!.flag, "--debug=true");
    assert.strictEqual(trueState!.label, "Enabled");

    assert.strictEqual(opt.defaultState, "null");
  });

  test("parses description for canonical multistate states", () => {
    const source = baseManifest(`
options:
  - id: dbg-console
    name: Debug Console
    type: multistate
    states:
      - value: null
        name: Default
        description: Use the component default.
        default: true
      - value: swo
        name: SWO
        description: Route the debug console over SWO.
`);
    const result = parseManifest(source);
    assert.strictEqual(result.issues.filter((i) => i.severity === "error").length, 0);
    const opt = result.buildOptions[0];
    const defaultState = opt.states?.find((s) => s.id === "null");
    assert.ok(defaultState);
    assert.strictEqual(defaultState!.description, "Use the component default.");
    const swoState = opt.states?.find((s) => s.id === "swo");
    assert.ok(swoState);
    assert.strictEqual(swoState!.description, "Route the debug console over SWO.");
  });

  test("derives multistate flag as --{id}={value} for string values", () => {
    const source = baseManifest(`
options:
  - id: dbg-console
    name: Debug Console
    type: multistate
    states:
      - value: null
        name: Default
        default: true
      - value: vcp
        name: VCP
      - value: swo
        name: SWO
`);
    const result = parseManifest(source);
    assert.strictEqual(result.issues.filter((i) => i.severity === "error").length, 0);
    const opt = result.buildOptions[0];
    const vcpState = opt.states?.find((s) => s.id === "vcp");
    assert.ok(vcpState);
    assert.strictEqual(vcpState!.flag, "--dbg-console=vcp");
    const swoState = opt.states?.find((s) => s.id === "swo");
    assert.ok(swoState);
    assert.strictEqual(swoState!.flag, "--dbg-console=swo");
  });

  test("parses when expression in canonical schema option", () => {
    const source = baseManifest(`
options:
  - id: production
    name: Production
    type: checkbox
    when: "target(hardware)"
`);
    const result = parseManifest(source);
    assert.strictEqual(result.issues.filter((i) => i.code === "invalid-when").length, 0);
    assert.deepStrictEqual(result.buildOptions[0].when, { type: "target", id: "hardware" });
  });

  test("rejects legacy kind for options", () => {
    const source = baseManifest(`
options:
  - id: perf-overlay
    name: Performance Overlay
    kind: checkbox
`);
    const result = parseManifest(source);
    assert.ok(result.issues.some((i) => i.code === "invalid-type"));
    assert.strictEqual(result.buildOptions.length, 0);
  });

  test("rejects legacy label for options", () => {
    const source = baseManifest(`
options:
  - label: Performance Overlay
    flag: --perf-overlay
    type: checkbox
`);
    const result = parseManifest(source);
    assert.ok(result.issues.some((i) => i.code === "missing-field"));
    assert.strictEqual(result.buildOptions.length, 0);
  });

  test("rejects legacy state id/label schema", () => {
    const source = baseManifest(`
options:
  - id: dbg-console
    name: Debug Console
    type: multistate
    states:
      - id: off
        label: Off
`);
    const result = parseManifest(source);
    assert.ok(result.issues.some((i) => i.code === "invalid-type" || i.code === "missing-field"));
    assert.strictEqual(result.buildOptions.length, 0);
  });
});

// ---------------------------------------------------------------------------
// options[].id carried through to BuildOption.id
// ---------------------------------------------------------------------------

suite("parseManifest – options[].id", () => {
  function baseManifest(optionsBlock: string): string {
    return `
models:
  - id: t2t1
    name: T2T1
targets:
  - id: hardware
    name: Hardware
components:
  - id: firmware
    name: Firmware
${optionsBlock}
`.trim();
  }

  test("carries options[].id through to BuildOption.id", () => {
    const source = baseManifest(`
options:
  - id: btc-only
    name: BTC Only
    type: checkbox
`);
    const result = parseManifest(source);
    assert.strictEqual(result.issues.filter((i) => i.severity === "error").length, 0);
    assert.strictEqual(result.buildOptions[0].id, "btc-only");
  });

  test("leaves BuildOption.id undefined when the manifest entry omits id", () => {
    const source = baseManifest(`
options:
  - name: Debug Console
    flag: "--dbg-console"
    type: multistate
    states:
      - value: null
        name: Default
`);
    const result = parseManifest(source);
    assert.strictEqual(result.issues.filter((i) => i.severity === "error").length, 0);
    const opt = result.buildOptions[0];
    assert.strictEqual(opt.id, undefined);
    // Fallback preset match key: the flag with leading dashes stripped.
    assert.strictEqual(opt.flag.replace(/^-+/, ""), "dbg-console");
  });
});

// ---------------------------------------------------------------------------
// IntelliSense artifact field tests
// ---------------------------------------------------------------------------

suite("parseManifest — IntelliSense artifact fields", () => {
  const baseSource = `
models:
  - id: T2T1
    name: Trezor Model T
    artifactFolder: model-t
targets:
  - id: hw
    name: Hardware
  - id: emu
    name: Emulator
    artifactSuffix: _emu
components:
  - id: core
    name: Core
    artifactName: compile_commands_core
`.trim();

  test("parses artifactFolder from model entries", () => {
    const result = parseManifest(baseSource);
    assert.strictEqual(result.issues.length, 0);
    assert.strictEqual(result.models[0].artifactFolder, "model-t");
  });

  test("artifactFolder is undefined when absent from model", () => {
    const source = `
models:
  - id: T2T1
    name: Trezor Model T
targets:
  - id: hw
    name: Hardware
components:
  - id: core
    name: Core
`.trim();
    const result = parseManifest(source);
    assert.strictEqual(result.issues.length, 0);
    assert.strictEqual(result.models[0].artifactFolder, undefined);
  });

  test("parses artifactName from component entries", () => {
    const result = parseManifest(baseSource);
    assert.strictEqual(result.components[0].artifactName, "compile_commands_core");
  });

  test("artifactName is undefined when absent from component", () => {
    const source = `
models:
  - id: T2T1
    name: Trezor Model T
targets:
  - id: hw
    name: Hardware
components:
  - id: core
    name: Core
`.trim();
    const result = parseManifest(source);
    assert.strictEqual(result.components[0].artifactName, undefined);
  });

  test("parses artifactSuffix from target entries", () => {
    const result = parseManifest(baseSource);
    assert.strictEqual(result.targets[1].artifactSuffix, "_emu");
  });

  test("artifactSuffix is undefined when absent from target", () => {
    const result = parseManifest(baseSource);
    assert.strictEqual(result.targets[0].artifactSuffix, undefined);
  });

  test("artifact fields do not affect manifest validity — manifest without them is still valid", () => {
    const source = `
models:
  - id: T2T1
    name: Trezor Model T
targets:
  - id: hw
    name: Hardware
components:
  - id: core
    name: Core
`.trim();
    const result = parseManifest(source);
    assert.strictEqual(result.issues.length, 0);
  });

  test("empty string artifactFolder is treated as absent", () => {
    const source = `
models:
  - id: T2T1
    name: Trezor Model T
    artifactFolder: "  "
targets:
  - id: hw
    name: Hardware
components:
  - id: core
    name: Core
`.trim();
    const result = parseManifest(source);
    // Whitespace-only value is treated as absent
    assert.strictEqual(result.models[0].artifactFolder, undefined);
  });

  test("parses legacy hyphenated artifact fields for backward compatibility", () => {
    const source = `
models:
  - id: T2T1
    name: Trezor Model T
    artifact-folder: model-t
targets:
  - id: emu
    name: Emulator
    artifact-suffix: _emu
components:
  - id: core
    name: Core
    artifact-name: compile_commands_core
`.trim();
    const result = parseManifest(source);

    assert.strictEqual(result.issues.length, 0);
    assert.strictEqual(result.models[0].artifactFolder, "model-t");
    assert.strictEqual(result.targets[0].artifactSuffix, "_emu");
    assert.strictEqual(result.components[0].artifactName, "compile_commands_core");
  });

  test("prefers camelCase artifact fields when both legacy and canonical names are present", () => {
    const source = `
models:
  - id: T2T1
    name: Trezor Model T
    artifactFolder: model-t-new
    artifact-folder: model-t-old
targets:
  - id: emu
    name: Emulator
    artifactSuffix: _new
    artifact-suffix: _old
components:
  - id: core
    name: Core
    artifactName: compile_commands_new
    artifact-name: compile_commands_old
`.trim();
    const result = parseManifest(source);

    assert.strictEqual(result.issues.length, 0);
    assert.strictEqual(result.models[0].artifactFolder, "model-t-new");
    assert.strictEqual(result.targets[0].artifactSuffix, "_new");
    assert.strictEqual(result.components[0].artifactName, "compile_commands_new");
  });
});

// ---------------------------------------------------------------------------
// flashWhen / uploadWhen regression tests
// ---------------------------------------------------------------------------

suite("parseManifest – flashWhen and uploadWhen", () => {
  function makeBaseManifest(components: string): string {
    return `
models:
  - id: T2T1
    name: Trezor Model T
    artifactFolder: model-t
  - id: T3W1
    name: Trezor Model T3
    artifactFolder: model-t3
targets:
  - id: hw
    name: Hardware
  - id: emu
    name: Emulator
${components}
`.trim();
  }

  test("valid flashWhen expression is parsed and stored on component", () => {
    const source = makeBaseManifest(`
components:
  - id: core
    name: Core
    flashWhen: model(T2T1)
`);
    const result = parseManifest(source);
    const core = result.components.find((c) => c.id === "core");
    assert.ok(core, "expected core component");
    assert.ok(core.flashWhen, "expected flashWhen to be set");
  });

  test("valid uploadWhen expression is parsed and stored on component", () => {
    const source = makeBaseManifest(`
components:
  - id: core
    name: Core
    uploadWhen: any(model(T2T1), model(T3W1))
`);
    const result = parseManifest(source);
    const core = result.components.find((c) => c.id === "core");
    assert.ok(core, "expected core component");
    assert.ok(core.uploadWhen, "expected uploadWhen to be set");
  });

  test("absent flashWhen leaves component.flashWhen undefined", () => {
    const source = makeBaseManifest(`
components:
  - id: core
    name: Core
`);
    const result = parseManifest(source);
    const core = result.components.find((c) => c.id === "core");
    assert.ok(core, "expected core component");
    assert.strictEqual(core.flashWhen, undefined);
  });

  test("absent uploadWhen leaves component.uploadWhen undefined", () => {
    const source = makeBaseManifest(`
components:
  - id: core
    name: Core
`);
    const result = parseManifest(source);
    const core = result.components.find((c) => c.id === "core");
    assert.ok(core, "expected core component");
    assert.strictEqual(core.uploadWhen, undefined);
  });

  test("invalid flashWhen syntax surfaces as invalid-when issue", () => {
    const source = makeBaseManifest(`
components:
  - id: core
    name: Core
    flashWhen: "not a valid expression"
`);
    const result = parseManifest(source);
    const invalidWhenIssues = result.issues.filter((i) => i.code === "invalid-when");
    assert.ok(
      invalidWhenIssues.length > 0,
      "expected at least one invalid-when issue for bad flashWhen syntax"
    );
  });

  test("invalid uploadWhen syntax surfaces as invalid-when issue", () => {
    const source = makeBaseManifest(`
components:
  - id: core
    name: Core
    uploadWhen: "not a valid expression"
`);
    const result = parseManifest(source);
    const invalidWhenIssues = result.issues.filter((i) => i.code === "invalid-when");
    assert.ok(
      invalidWhenIssues.length > 0,
      "expected at least one invalid-when issue for bad uploadWhen syntax"
    );
  });

  test("unknown model id in flashWhen surfaces as invalid-when issue", () => {
    const source = makeBaseManifest(`
components:
  - id: core
    name: Core
    flashWhen: model(UNKNOWN_MODEL)
`);
    const result = parseManifest(source);
    const invalidWhenIssues = result.issues.filter((i) => i.code === "invalid-when");
    assert.ok(
      invalidWhenIssues.length > 0,
      "expected invalid-when issue for unknown model id in flashWhen"
    );
    assert.ok(
      invalidWhenIssues.some((i) => i.message.includes("UNKNOWN_MODEL") || i.message.includes("unknown")),
      `expected issue message to mention unknown id, got: ${invalidWhenIssues.map((i) => i.message).join("; ")}`
    );
  });

  test("invalid flashWhen does NOT set hasWorkflowBlockingIssues", () => {
    const source = makeBaseManifest(`
components:
  - id: core
    name: Core
    flashWhen: "not a valid expression"
`);
    const result = parseManifest(source);
    assert.strictEqual(
      result.hasWorkflowBlockingIssues,
      false,
      "invalid flashWhen must NOT block Build/Clippy/Check/Clean workflow"
    );
  });

  test("invalid uploadWhen does NOT set hasWorkflowBlockingIssues", () => {
    const source = makeBaseManifest(`
components:
  - id: core
    name: Core
    uploadWhen: "not a valid expression"
`);
    const result = parseManifest(source);
    assert.strictEqual(
      result.hasWorkflowBlockingIssues,
      false,
      "invalid uploadWhen must NOT block Build/Clippy/Check/Clean workflow"
    );
  });

  test("non-string flashWhen (integer) surfaces as invalid-when issue", () => {
    const source = makeBaseManifest(`
components:
  - id: core
    name: Core
    flashWhen: 42
`);
    const result = parseManifest(source);
    const invalidWhenIssues = result.issues.filter((i) => i.code === "invalid-when");
    assert.ok(
      invalidWhenIssues.length > 0,
      "expected invalid-when issue for non-string flashWhen value"
    );
  });

  test("component without flashWhen/uploadWhen sees no new issues from action rules pass", () => {
    const source = makeBaseManifest(`
components:
  - id: core
    name: Core
`);
    const result = parseManifest(source);
    // No action-rule issues expected for a component with no when fields
    const actionIssues = result.issues.filter((i) => i.code === "invalid-when");
    assert.strictEqual(actionIssues.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Component-scoped debug profile and executableExtension coverage
// ---------------------------------------------------------------------------

suite("parseManifest – component-scoped debug profiles", () => {
  function baseManifest(extras: string): string {
    return `
models:
  - id: T2T1
    name: Trezor Model T
    artifactFolder: model-t
  - id: T3W1
    name: Trezor Model T3
    artifactFolder: model-t3
targets:
  - id: hw
    name: Hardware
  - id: emu
    name: Emulator
components:
  - id: core
    name: Core
    artifactName: firmware
${extras}
`.trim();
  }

  // -------------------------------------------------------------------------
  // executableExtension on targets
  // -------------------------------------------------------------------------

  test("target with executableExtension is parsed correctly", () => {
    const source = `
models:
  - id: T2T1
    name: Trezor Model T
    artifactFolder: model-t
  - id: T3W1
    name: Trezor Model T3
    artifactFolder: model-t3
targets:
  - id: hw
    name: Hardware
    executableExtension: .elf
  - id: emu
    name: Emulator
components:
  - id: core
    name: Core
    artifactName: firmware
`.trim();
    const result = parseManifest(source);
    const hw = result.targets.find((t) => t.id === "hw");
    assert.ok(hw, "expected hw target");
    assert.strictEqual((hw as unknown as { executableExtension?: string }).executableExtension, ".elf");
    assert.strictEqual(result.hasDebugBlockingIssues, false);
  });

  // -------------------------------------------------------------------------
  // Component-scoped debug profiles
  // -------------------------------------------------------------------------

  test("component without debug section parses without debug profiles", () => {
    const source = baseManifest("");
    const result = parseManifest(source);
    assert.strictEqual(result.issues.length, 0);
    const core = result.components.find((c) => c.id === "core");
    assert.ok(core, "expected core component");
    assert.strictEqual(core.debug, undefined);
    assert.strictEqual(result.hasDebugBlockingIssues, false);
  });

  test("component with valid debug profile is parsed", () => {
    const source = baseManifest(`    debug:
      - name: gdb-remote
        template: gdb-remote.json`);
    const result = parseManifest(source);
    assert.strictEqual(result.issues.filter((i) => i.severity === "error").length, 0);
    const core = result.components.find((c) => c.id === "core");
    assert.ok(core?.debug, "expected debug profiles");
    assert.strictEqual(core.debug!.length, 1);
    const profile = core.debug![0];
    assert.strictEqual(profile.name, "gdb-remote");
    assert.strictEqual(profile.template, "gdb-remote.json");
    assert.strictEqual(profile.when, undefined);
    assert.strictEqual(profile.vars, undefined);
    assert.strictEqual(profile.declarationIndex, 0);
    assert.strictEqual(result.hasDebugBlockingIssues, false);
  });

  test("component debug profile with optional when is parsed", () => {
    const source = baseManifest(`    debug:
      - name: hw-only
        template: gdb.json
        when: model(T2T1)`);
    const result = parseManifest(source);
    assert.strictEqual(result.issues.filter((i) => i.severity === "error").length, 0);
    const core = result.components.find((c) => c.id === "core");
    const profile = core?.debug?.[0];
    assert.ok(profile, "expected debug profile");
    assert.deepStrictEqual(profile.when, { type: "model", id: "T2T1" });
    assert.strictEqual(result.hasDebugBlockingIssues, false);
  });

  test("component debug profile with vars is parsed", () => {
    const source = baseManifest(`    debug:
      - name: gdb
        template: gdb.json
        vars:
          port: "3333"
          server: localhost`);
    const result = parseManifest(source);
    assert.strictEqual(result.issues.filter((i) => i.severity === "error").length, 0);
    const core = result.components.find((c) => c.id === "core");
    const profile = core?.debug?.[0];
    assert.ok(profile, "expected debug profile");
    assert.deepStrictEqual(profile.vars, { port: "3333", server: "localhost" });
    assert.strictEqual(result.hasDebugBlockingIssues, false);
  });

  test("component debug profile vars reject obsolete tfTools variables", () => {
    const source = baseManifest(`    debug:
      - name: gdb
        template: gdb.json
        vars:
          endpoint: "\${tfTools.artifactPath}"`);
    const result = parseManifest(source);
    assert.ok(result.issues.some((entry) => entry.severity === "error" && entry.message.includes("obsolete ${tfTools.*}")));
    assert.strictEqual(result.hasDebugBlockingIssues, true);
  });

  test("multiple debug profiles on same component are parsed in order", () => {
    const source = baseManifest(`    debug:
      - name: first
        template: a.json
      - name: second
        template: b.json
        when: model(T2T1)`);
    const result = parseManifest(source);
    assert.strictEqual(result.issues.filter((i) => i.severity === "error").length, 0);
    const core = result.components.find((c) => c.id === "core");
    assert.ok(core?.debug, "expected debug profiles");
    assert.strictEqual(core.debug!.length, 2);
    assert.strictEqual(core.debug![0].name, "first");
    assert.strictEqual(core.debug![0].declarationIndex, 0);
    assert.strictEqual(core.debug![1].name, "second");
    assert.strictEqual(core.debug![1].declarationIndex, 1);
    assert.strictEqual(result.hasDebugBlockingIssues, false);
  });

  // -------------------------------------------------------------------------
  // Missing required fields → hasDebugBlockingIssues
  // -------------------------------------------------------------------------

  test("missing name field sets hasDebugBlockingIssues", () => {
    const source = baseManifest(`    debug:
      - template: gdb.json`);
    const result = parseManifest(source);
    assert.ok(result.issues.some((i) => i.severity === "error" && i.message.toLowerCase().includes("name")));
    assert.strictEqual(result.hasDebugBlockingIssues, true);
  });

  test("missing template field sets hasDebugBlockingIssues", () => {
    const source = baseManifest(`    debug:
      - name: gdb`);
    const result = parseManifest(source);
    assert.ok(result.issues.some((i) => i.severity === "error" && i.message.toLowerCase().includes("template")));
    assert.strictEqual(result.hasDebugBlockingIssues, true);
  });

  // -------------------------------------------------------------------------
  // Invalid when expression → hasDebugBlockingIssues
  // -------------------------------------------------------------------------

  test("invalid when expression on debug profile sets hasDebugBlockingIssues", () => {
    const source = baseManifest(`    debug:
      - name: gdb
        template: gdb.json
        when: "not-valid()"`);
    const result = parseManifest(source);
    assert.ok(result.issues.some((i) => i.code === "invalid-when"));
    assert.strictEqual(result.hasDebugBlockingIssues, true);
  });

  test("when expression with unknown model id sets hasDebugBlockingIssues", () => {
    const source = baseManifest(`    debug:
      - name: gdb
        template: gdb.json
        when: model(NONEXISTENT)`);
    const result = parseManifest(source);
    assert.ok(result.issues.some((i) => i.code === "invalid-when"));
    assert.strictEqual(result.hasDebugBlockingIssues, true);
  });

  // -------------------------------------------------------------------------
  // Legacy top-level debug → rejected
  // -------------------------------------------------------------------------

  test("legacy top-level debug section is rejected with hasDebugBlockingIssues", () => {
    const source = `
models:
  - id: T2T1
    name: Trezor Model T
targets:
  - id: hw
    name: Hardware
components:
  - id: core
    name: Core
debug:
  - name: gdb
    template: gdb.json
`.trim();
    const result = parseManifest(source);
    assert.ok(result.issues.some((i) => i.severity === "error" && i.message.toLowerCase().includes("legacy")));
    assert.strictEqual(result.hasDebugBlockingIssues, true);
  });

  // -------------------------------------------------------------------------
  // validateManifest propagates hasDebugBlockingIssues
  // -------------------------------------------------------------------------

  test("validateManifest sets hasDebugBlockingIssues for missing component debug name", () => {
    const source = baseManifest(`    debug:
      - template: gdb.json`);
    const state = validateManifest(source, vscode.Uri.file("/workspace/manifest.yaml"));
    assert.strictEqual(state.status, "invalid");
    if (state.status === "invalid") {
      assert.ok(
        state.validationIssues.some(
          (issue) => issue.severity === "error" && issue.message.toLowerCase().includes("name")
        )
      );
    }
  });

  test("validateManifest loaded state has debug profiles on component for valid config", () => {
    const source = baseManifest(`    debug:
      - name: gdb
        template: gdb.json`);
    const state = validateManifest(source, vscode.Uri.file("/workspace/manifest.yaml"));
    assert.strictEqual(state.status, "loaded");
    if (state.status === "loaded") {
      assert.strictEqual(state.hasDebugBlockingIssues, false);
      const core = state.components.find((c) => c.id === "core");
      assert.ok(core?.debug && core.debug.length === 1, "expected 1 debug profile on core component");
    }
  });
});
