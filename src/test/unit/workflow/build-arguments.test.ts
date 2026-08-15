/**
 * Unit tests for Build Workflow effective argument derivation.
 *
 * Derive effective Build/Clippy/Check args from model, target, component,
 * the active preset, and currently applicable build-option overrides.
 * Build/Clippy/Check share the same effective configuration.
 * Clean runs without build-option arguments and without a preset argument.
 */
import * as assert from "assert";
import {
  deriveWorkflowArguments,
  deriveCleanArguments,
} from "../../../commands/build-workflow";
import { ResolvedOption } from "../../../build/build-options";
import { BuildOption } from "../../../manifest/manifest-types";
import { DEFAULT_PRESET_ID } from "../../../presets/preset-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkboxOpt(
  key: string,
  flag: string,
  available: boolean,
  value: boolean,
  isOverride: boolean,
  presetValue: boolean = false
): ResolvedOption {
  const option: BuildOption = {
    key,
    label: key,
    flag,
    kind: "checkbox",
  };
  return { option, available, value, presetValue, presetState: "resolved", isOverride };
}

function multistateOpt(
  key: string,
  available: boolean,
  activeStateId: string,
  isOverride: boolean,
  states: Array<{ id: string; label: string; flag: string }>,
  presetValue?: string
): ResolvedOption {
  const option: BuildOption = {
    key,
    label: key,
    flag: "",
    kind: "multistate",
    states,
  };
  return {
    option,
    available,
    value: activeStateId,
    presetValue: presetValue ?? states[0]?.id,
    presetState: "resolved",
    isOverride,
  };
}

function unresolvedMultistateOpt(
  key: string,
  available: boolean,
  states: Array<{ id: string; label: string; flag: string }>
): ResolvedOption {
  const option: BuildOption = { key, label: key, flag: "", kind: "multistate", states };
  return { option, available, value: states[0]?.id ?? "", presetState: "unresolved", isOverride: false };
}

function mismatchOpt(key: string, flag: string, available: boolean): ResolvedOption {
  const option: BuildOption = { key, label: key, flag, kind: "checkbox" };
  return { option, available, value: false, presetState: "mismatch", isOverride: false };
}

// ---------------------------------------------------------------------------
// Suite: deriveWorkflowArguments — pre-feature prefix (byte-identical)
// ---------------------------------------------------------------------------

suite("deriveWorkflowArguments – pre-feature prefix stays byte-identical", () => {
  const baseContext = { modelId: "T2T1", targetId: "hw", componentId: "core" };

  test("returns <component> -m <model> format with no options, no target flag, Default active", () => {
    const args = deriveWorkflowArguments("Build", baseContext, [], DEFAULT_PRESET_ID);
    assert.deepStrictEqual(args, ["core", "-m", "T2T1"]);
  });

  test("appends target flag when present", () => {
    const ctx = { ...baseContext, targetFlag: "--hw" };
    const args = deriveWorkflowArguments("Build", ctx, [], DEFAULT_PRESET_ID);
    assert.deepStrictEqual(args, ["core", "-m", "T2T1", "--hw"]);
  });

  test("omits target flag when null", () => {
    const ctx = { ...baseContext, targetFlag: null };
    const args = deriveWorkflowArguments("Build", ctx, [], DEFAULT_PRESET_ID);
    assert.deepStrictEqual(args, ["core", "-m", "T2T1"]);
  });

  test("Build, Clippy, Check produce the same effective configuration", () => {
    const resolved: ResolvedOption[] = [checkboxOpt("debug", "--debug", true, true, true)];
    const buildArgs = deriveWorkflowArguments("Build", baseContext, resolved, DEFAULT_PRESET_ID);
    const clippyArgs = deriveWorkflowArguments("Clippy", baseContext, resolved, DEFAULT_PRESET_ID);
    const checkArgs = deriveWorkflowArguments("Check", baseContext, resolved, DEFAULT_PRESET_ID);
    assert.deepStrictEqual(buildArgs, clippyArgs);
    assert.deepStrictEqual(buildArgs, checkArgs);
  });
});

// ---------------------------------------------------------------------------
// Suite: -p argument
// ---------------------------------------------------------------------------

suite("deriveWorkflowArguments – preset argument", () => {
  const baseContext = { modelId: "T2T1", targetId: "hw", componentId: "core", targetFlag: "--hw" };

  test("-p default is never emitted", () => {
    const args = deriveWorkflowArguments("Build", baseContext, [], DEFAULT_PRESET_ID);
    assert.ok(!args.includes("-p"));
  });

  test("emits exactly one -p <preset> pair for a named preset", () => {
    const args = deriveWorkflowArguments("Build", baseContext, [], "test");
    const pIndex = args.indexOf("-p");
    assert.strictEqual(pIndex, args.lastIndexOf("-p"), "-p must appear exactly once");
    assert.strictEqual(args[pIndex + 1], "test");
  });

  test("-p is positioned after the target flag and before override flags", () => {
    const resolved = [checkboxOpt("frozen", "--frozen", true, false, true, true)];
    const args = deriveWorkflowArguments("Build", baseContext, resolved, "test");
    assert.deepStrictEqual(args, ["core", "-m", "T2T1", "--hw", "-p", "test", "--frozen=false"]);
  });

  test("the preset id is emitted verbatim, with no quoting or case transformation", () => {
    const args = deriveWorkflowArguments("Build", baseContext, [], "Dev-Mode");
    assert.ok(args.includes("Dev-Mode"));
  });
});

// ---------------------------------------------------------------------------
// Suite: override-only argument emission
// ---------------------------------------------------------------------------

suite("deriveWorkflowArguments – override-only emission", () => {
  const baseContext = { modelId: "T2T1", targetId: "hw", componentId: "core" };

  test("checkbox on-override emits the bare flag (unchanged form)", () => {
    const resolved = [checkboxOpt("frozen", "--frozen", true, true, true, false)];
    const args = deriveWorkflowArguments("Build", baseContext, resolved, DEFAULT_PRESET_ID);
    assert.ok(args.includes("--frozen"));
    assert.ok(!args.includes("--frozen=false"));
  });

  test("checkbox off-override emits <flag>=false", () => {
    const resolved = [checkboxOpt("frozen", "--frozen", true, false, true, true)];
    const args = deriveWorkflowArguments("Build", baseContext, resolved, DEFAULT_PRESET_ID);
    assert.ok(args.includes("--frozen=false"));
  });

  test("a value equal to the preset-effective value emits nothing (isOverride false)", () => {
    const resolved = [checkboxOpt("frozen", "--frozen", true, true, false, true)];
    const args = deriveWorkflowArguments("Build", baseContext, resolved, DEFAULT_PRESET_ID);
    assert.ok(!args.some((a) => a.startsWith("--frozen")));
  });

  test("multistate override emits the unchanged <flag>=<value> form", () => {
    const states = [
      { id: "null", label: "Default", flag: "" },
      { id: "swo", label: "SWO", flag: "--dbg-console=swo" },
    ];
    const resolved = [multistateOpt("dbg-console", true, "swo", true, states, "null")];
    const args = deriveWorkflowArguments("Build", baseContext, resolved, DEFAULT_PRESET_ID);
    assert.ok(args.includes("--dbg-console=swo"));
  });

  test("multistate with no override emits nothing even if a non-null state is active", () => {
    const states = [
      { id: "null", label: "Default", flag: "" },
      { id: "swo", label: "SWO", flag: "--dbg-console=swo" },
    ];
    const resolved = [multistateOpt("dbg-console", true, "swo", false, states, "swo")];
    const args = deriveWorkflowArguments("Build", baseContext, resolved, DEFAULT_PRESET_ID);
    assert.ok(!args.includes("--dbg-console=swo"));
  });

  test("excludes flag for unavailable option even if isOverride is true", () => {
    const resolved = [checkboxOpt("frozen", "--frozen", false, true, true)];
    const args = deriveWorkflowArguments("Build", baseContext, resolved, DEFAULT_PRESET_ID);
    assert.ok(!args.some((a) => a.startsWith("--frozen")));
  });

  test("nothing is emitted for an unresolved multistate option", () => {
    const states = [
      { id: "true", label: "Enabled", flag: "--pyopt=true" },
      { id: "false", label: "Disabled", flag: "--pyopt=false" },
    ];
    const resolved = [unresolvedMultistateOpt("pyopt", true, states)];
    const args = deriveWorkflowArguments("Build", baseContext, resolved, DEFAULT_PRESET_ID);
    assert.ok(!args.some((a) => a.startsWith("--pyopt")));
  });

  test("nothing is emitted for a mismatched option", () => {
    const resolved = [mismatchOpt("frozen", "--frozen", true)];
    const args = deriveWorkflowArguments("Build", baseContext, resolved, DEFAULT_PRESET_ID);
    assert.ok(!args.some((a) => a.startsWith("--frozen")));
  });

  test("flags are emitted in manifest declaration order", () => {
    const resolved = [
      checkboxOpt("alpha", "--alpha", true, true, true, false),
      checkboxOpt("beta", "--beta", true, true, true, false),
    ];
    const args = deriveWorkflowArguments("Build", baseContext, resolved, DEFAULT_PRESET_ID);
    assert.deepStrictEqual(
      args.filter((a) => a.startsWith("--")),
      ["--alpha", "--beta"]
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: deriveCleanArguments — unaffected by presets
// ---------------------------------------------------------------------------

suite("deriveCleanArguments – Clean has no arguments, ever", () => {
  const baseContext = { modelId: "T2T1", targetId: "hw", componentId: "core" };

  test("returns empty args (cargo xtask clean has no configuration-derived arguments)", () => {
    const args = deriveCleanArguments(baseContext);
    assert.deepStrictEqual(args, [], "Clean must produce no arguments");
  });

  test("args do not include model, target, component, preset, or build-option flags", () => {
    const args = deriveCleanArguments(baseContext);
    assert.ok(!args.includes("T2T1"), "Clean must not include modelId");
    assert.ok(!args.includes("hw"), "Clean must not include targetId");
    assert.ok(!args.includes("core"), "Clean must not include componentId");
    assert.ok(!args.includes("-p"), "Clean must never receive a preset argument");
    assert.ok(!args.some((a) => a.startsWith("--")), "Clean args must not include option flags");
  });
});
