import * as assert from "assert";
import {
  normalizeBuildOptions,
  deriveOptionFlags,
  BuildContext,
  ResolvedOption,
  BUILD_OPTIONS_KEY,
  BuildOptionsState,
  readBuildOptions,
  writeBuildOption,
  discardBuildOptionOverrides,
} from "../../../configuration/build-options";
import { BuildOption } from "../../../manifest/manifest-types";
import { PresetEffectiveValue } from "../../../presets/preset-resolution";
import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeExtContext(
  initialValues: Record<string, unknown> = {}
): vscode.ExtensionContext {
  const store = new Map<string, unknown>(Object.entries(initialValues));
  return {
    workspaceState: {
      get: <T>(key: string): T | undefined => store.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        store.set(key, value);
      },
      keys: (): readonly string[] => [...store.keys()],
    },
  } as unknown as vscode.ExtensionContext;
}

function checkbox(
  key: string,
  flag: string,
  when?: BuildOption["when"]
): BuildOption {
  return { key, label: key, flag, kind: "checkbox", when };
}

function multistate(
  key: string,
  flag: string,
  states: BuildOption["states"],
  defaultState?: string
): BuildOption {
  return { key, label: key, flag, kind: "multistate", states, defaultState };
}

const ctx: BuildContext = {
  modelId: "T2T1",
  targetId: "hw",
  componentId: "core",
};

const NO_PRESETS: ReadonlyMap<string, PresetEffectiveValue> = new Map();

function resolvedPreset(key: string, value: boolean | string): PresetEffectiveValue {
  return { optionKey: key, state: "resolved", value };
}

function unresolvedPreset(key: string): PresetEffectiveValue {
  return { optionKey: key, state: "unresolved" };
}

function mismatchPreset(key: string, rawValue: boolean | string): PresetEffectiveValue {
  return { optionKey: key, state: "mismatch", rawValue };
}

// ---------------------------------------------------------------------------
// readBuildOptions / writeBuildOption
// ---------------------------------------------------------------------------

suite("readBuildOptions / writeBuildOption", () => {
  test("readBuildOptions returns undefined when nothing is stored", () => {
    const extCtx = makeExtContext();
    assert.strictEqual(readBuildOptions(extCtx), undefined);
  });

  test("writeBuildOption persists a checkbox value", async () => {
    const extCtx = makeExtContext();
    await writeBuildOption(extCtx, "debug", true);
    const state = readBuildOptions(extCtx);
    assert.ok(state !== undefined);
    assert.strictEqual(state!.values["debug"], true);
  });

  test("writeBuildOption merges with existing values", async () => {
    const initial: BuildOptionsState = {
      values: { debug: true },
      persistedAt: "2026-01-01T00:00:00Z",
    };
    const extCtx = makeExtContext({ [BUILD_OPTIONS_KEY]: initial });
    await writeBuildOption(extCtx, "fast", false);
    const state = readBuildOptions(extCtx);
    assert.strictEqual(state!.values["debug"], true);
    assert.strictEqual(state!.values["fast"], false);
  });

  test("writeBuildOption updates an existing key", async () => {
    const initial: BuildOptionsState = {
      values: { debug: true },
      persistedAt: "2026-01-01T00:00:00Z",
    };
    const extCtx = makeExtContext({ [BUILD_OPTIONS_KEY]: initial });
    await writeBuildOption(extCtx, "debug", false);
    const state = readBuildOptions(extCtx);
    assert.strictEqual(state!.values["debug"], false);
  });

  test("writeBuildOption sets persistedAt timestamp", async () => {
    const before = new Date().toISOString();
    const extCtx = makeExtContext();
    await writeBuildOption(extCtx, "debug", true);
    const state = readBuildOptions(extCtx);
    assert.ok(state!.persistedAt >= before);
  });
});

// ---------------------------------------------------------------------------
// clearBuildOptions — the FR-017 preset-change discard
// ---------------------------------------------------------------------------

suite("discardBuildOptionOverrides (FR-017)", () => {
  test("discards every stored selection so all options fall back to preset-effective values", async () => {
    const extCtx = makeExtContext();
    await writeBuildOption(extCtx, "frozen", false);
    await writeBuildOption(extCtx, "pyopt", "false");
    assert.deepStrictEqual(readBuildOptions(extCtx)!.values, { frozen: false, pyopt: "false" });

    const cleared = await discardBuildOptionOverrides(extCtx);
    assert.deepStrictEqual(cleared.sort(), ["frozen", "pyopt"], "returns the discarded keys for the log record");
    assert.deepStrictEqual(readBuildOptions(extCtx)!.values, {});

    // Resolution now follows the preset with nothing emphasized.
    const opts = [checkbox("frozen", "--frozen")];
    const presets = new Map([["frozen", resolvedPreset("frozen", true)]]);
    const resolved = normalizeBuildOptions(opts, readBuildOptions(extCtx), ctx, presets);
    assert.strictEqual(resolved[0].value, true, "follows the preset-effective value again");
    assert.strictEqual(resolved[0].isOverride, false);
  });

  test("clears a stale pre-feature checkbox false that was shadowing a [[defaults]] value", async () => {
    // The reported defect: before presets existed, unchecking a checkbox
    // persisted `false`, which now reads as an override and suppresses the
    // defaults layer with no way to undo it.
    const extCtx = makeExtContext({
      [BUILD_OPTIONS_KEY]: { values: { pyopt: false }, persistedAt: "legacy" },
    });
    const opts = [checkbox("pyopt", "--pyopt")];
    const presets = new Map([["pyopt", resolvedPreset("pyopt", true)]]);

    const before = normalizeBuildOptions(opts, readBuildOptions(extCtx), ctx, presets);
    assert.strictEqual(before[0].value, false);
    assert.strictEqual(before[0].isOverride, true, "the stale value shadows the [[defaults]] value");

    await discardBuildOptionOverrides(extCtx);
    const after = normalizeBuildOptions(opts, readBuildOptions(extCtx), ctx, presets);
    assert.strictEqual(after[0].value, true);
    assert.strictEqual(after[0].isOverride, false);
  });

  test("clears selections held for other build contexts too, since the active preset is workspace-scoped", async () => {
    const extCtx = makeExtContext();
    // An option that is unavailable in the current context still holds a value
    // that is just as stale for the newly active preset.
    await writeBuildOption(extCtx, "storage_insecure_testing_mode", true);
    const cleared = await discardBuildOptionOverrides(extCtx);
    assert.deepStrictEqual(cleared, ["storage_insecure_testing_mode"]);
    assert.deepStrictEqual(readBuildOptions(extCtx)!.values, {});
  });

  test("writes nothing on a workspace that never stored a selection", async () => {
    const extCtx = makeExtContext();
    const cleared = await discardBuildOptionOverrides(extCtx);
    assert.deepStrictEqual(cleared, []);
    assert.strictEqual(readBuildOptions(extCtx), undefined, "no empty record is created");
  });

  test("sets persistedAt timestamp", async () => {
    const before = new Date().toISOString();
    const extCtx = makeExtContext();
    await writeBuildOption(extCtx, "debug", true);
    await discardBuildOptionOverrides(extCtx);
    assert.ok(readBuildOptions(extCtx)!.persistedAt >= before);
  });
});

// ---------------------------------------------------------------------------
// normalizeBuildOptions – availability and basic resolution
// ---------------------------------------------------------------------------

suite("normalizeBuildOptions", () => {
  test("returns resolved options for all options", () => {
    const opts = [checkbox("debug", "--debug"), checkbox("fast", "--fast")];
    const resolved = normalizeBuildOptions(opts, undefined, ctx, NO_PRESETS);
    assert.strictEqual(resolved.length, 2);
  });

  test("checkbox option falls back to preset-effective false when no saved value and no preset data (upstream implicit disabled)", () => {
    const opts = [checkbox("debug", "--debug")];
    const resolved = normalizeBuildOptions(opts, undefined, ctx, NO_PRESETS);
    assert.strictEqual(resolved[0].value, false);
    assert.strictEqual(resolved[0].isOverride, false);
  });

  test("checkbox option restores a saved value that differs from the preset-effective value as an override", () => {
    const saved: BuildOptionsState = {
      values: { debug: true },
      persistedAt: "2026-01-01T00:00:00Z",
    };
    const opts = [checkbox("debug", "--debug")];
    const resolved = normalizeBuildOptions(opts, saved, ctx, NO_PRESETS);
    assert.strictEqual(resolved[0].value, true);
    assert.strictEqual(resolved[0].isOverride, true);
  });

  test("multistate option with no null-valued state and no preset data is unresolved, falling back to the first state", () => {
    const states = [
      { id: "off", label: "Off", flag: "" },
      { id: "on", label: "On", flag: "--fast" },
    ];
    const opts = [multistate("fast", "--fast", states)];
    const resolved = normalizeBuildOptions(opts, undefined, ctx, NO_PRESETS);
    assert.strictEqual(resolved[0].presetState, "unresolved");
    assert.strictEqual(resolved[0].value, "off");
    assert.strictEqual(resolved[0].isOverride, false);
  });

  test("multistate option restores a saved state that differs from a resolved preset-effective value", () => {
    const saved: BuildOptionsState = {
      values: { fast: "on" },
      persistedAt: "2026-01-01T00:00:00Z",
    };
    const states = [
      { id: "off", label: "Off", flag: "" },
      { id: "on", label: "On", flag: "--fast" },
    ];
    const opts = [multistate("fast", "--fast", states)];
    const presets = new Map([["fast", resolvedPreset("fast", "off")]]);
    const resolved = normalizeBuildOptions(opts, saved, ctx, presets);
    assert.strictEqual(resolved[0].value, "on");
    assert.strictEqual(resolved[0].isOverride, true);
  });

  test("multistate option falls back to an unresolved/mismatch-safe value for an invalid saved state id", () => {
    const saved: BuildOptionsState = {
      values: { fast: "INVALID_STATE" },
      persistedAt: "2026-01-01T00:00:00Z",
    };
    const states = [
      { id: "off", label: "Off", flag: "" },
      { id: "on", label: "On", flag: "--fast" },
    ];
    const opts = [multistate("fast", "--fast", states)];
    const presets = new Map([["fast", resolvedPreset("fast", "on")]]);
    const resolved = normalizeBuildOptions(opts, saved, ctx, presets);
    assert.strictEqual(resolved[0].value, "on");
    assert.strictEqual(resolved[0].isOverride, false);
  });

  // -------------------------------------------------------------------------
  // When expression availability
  // -------------------------------------------------------------------------

  test("option without when is always available", () => {
    const opts = [checkbox("debug", "--debug")];
    const resolved = normalizeBuildOptions(opts, undefined, ctx, NO_PRESETS);
    assert.strictEqual(resolved[0].available, true);
  });

  test("option with matching when is available", () => {
    const opts = [checkbox("t2t1-only", "--t2t1", { type: "model", id: "T2T1" })];
    const resolved = normalizeBuildOptions(opts, undefined, ctx, NO_PRESETS);
    assert.strictEqual(resolved[0].available, true);
  });

  test("option with non-matching when is unavailable", () => {
    const opts = [checkbox("t3w1-only", "--t3w1", { type: "model", id: "T3W1" })];
    const resolved = normalizeBuildOptions(opts, undefined, ctx, NO_PRESETS);
    assert.strictEqual(resolved[0].available, false);
  });

  test("unavailable option retains its persisted value", () => {
    const saved: BuildOptionsState = {
      values: { "t3w1-only": true },
      persistedAt: "2026-01-01T00:00:00Z",
    };
    const opts = [checkbox("t3w1-only", "--t3w1", { type: "model", id: "T3W1" })];
    const resolved = normalizeBuildOptions(opts, saved, ctx, NO_PRESETS);
    // available = false but value is preserved
    assert.strictEqual(resolved[0].available, false);
    assert.strictEqual(resolved[0].value, true);
  });

  test("preserves declaration order", () => {
    const opts = [
      checkbox("alpha", "--alpha"),
      checkbox("beta", "--beta"),
      checkbox("gamma", "--gamma"),
    ];
    const resolved = normalizeBuildOptions(opts, undefined, ctx, NO_PRESETS);
    assert.deepStrictEqual(
      resolved.map((r) => r.option.key),
      ["alpha", "beta", "gamma"]
    );
  });
});

// ---------------------------------------------------------------------------
// normalizeBuildOptions – preset-relative resolution (data-model.md §4)
// ---------------------------------------------------------------------------

suite("normalizeBuildOptions – presetValue, presetState, isOverride", () => {
  test("no stored selection: value follows the resolved preset-effective value, isOverride false (FR-013, FR-016)", () => {
    const opts = [checkbox("frozen", "--frozen")];
    const presets = new Map([["frozen", resolvedPreset("frozen", true)]]);
    const resolved = normalizeBuildOptions(opts, undefined, ctx, presets);
    assert.strictEqual(resolved[0].presetState, "resolved");
    assert.strictEqual(resolved[0].presetValue, true);
    assert.strictEqual(resolved[0].value, true);
    assert.strictEqual(resolved[0].isOverride, false);
  });

  test("a stored selection equal to the preset-effective value is not an override (FR-016)", () => {
    const saved: BuildOptionsState = { values: { frozen: true }, persistedAt: "t" };
    const opts = [checkbox("frozen", "--frozen")];
    const presets = new Map([["frozen", resolvedPreset("frozen", true)]]);
    const resolved = normalizeBuildOptions(opts, saved, ctx, presets);
    assert.strictEqual(resolved[0].value, true);
    assert.strictEqual(resolved[0].isOverride, false);
  });

  test("a stored selection differing from the preset-effective value is an override", () => {
    const saved: BuildOptionsState = { values: { frozen: false }, persistedAt: "t" };
    const opts = [checkbox("frozen", "--frozen")];
    const presets = new Map([["frozen", resolvedPreset("frozen", true)]]);
    const resolved = normalizeBuildOptions(opts, saved, ctx, presets);
    assert.strictEqual(resolved[0].value, false);
    assert.strictEqual(resolved[0].isOverride, true);
  });

  test("resolution is a pure re-comparison: the same stored map against a new presetValue, never rewritten (FR-016)", () => {
    const saved: BuildOptionsState = { values: { pyopt: "false" }, persistedAt: "t" };
    const states = [
      { id: "null", label: "Default", flag: "" },
      { id: "true", label: "Enabled", flag: "--pyopt=true" },
      { id: "false", label: "Disabled", flag: "--pyopt=false" },
    ];
    const opts = [multistate("pyopt", "--pyopt", states)];

    const firstPreset = new Map([["pyopt", resolvedPreset("pyopt", "true")]]);
    const firstResolved = normalizeBuildOptions(opts, saved, ctx, firstPreset);
    assert.strictEqual(firstResolved[0].value, "false");
    assert.strictEqual(firstResolved[0].isOverride, true);

    // A different presetValue re-runs the comparison. Discarding overrides on a
    // preset change is the refresh seam's job (FR-017, see the clearBuildOptions
    // suite below); normalizeBuildOptions itself never writes.
    const secondPreset = new Map([["pyopt", resolvedPreset("pyopt", "false")]]);
    const secondResolved = normalizeBuildOptions(opts, saved, ctx, secondPreset);
    assert.strictEqual(secondResolved[0].value, "false");
    assert.strictEqual(secondResolved[0].isOverride, false, "now equals the new preset-effective value");
    assert.deepStrictEqual(saved.values, { pyopt: "false" }, "the stored map is not mutated by resolution");
  });

  test("a stored value equal to the null-valued state id is treated as no explicit selection (research Decision 8 rule 3)", () => {
    const saved: BuildOptionsState = { values: { "dbg-console": "null" }, persistedAt: "t" };
    const states = [
      { id: "null", label: "Default", flag: "" },
      { id: "swo", label: "SWO", flag: "--dbg-console=swo" },
    ];
    const opts = [multistate("dbg-console", "--dbg-console", states)];
    const presets = new Map([["dbg-console", resolvedPreset("dbg-console", "swo")]]);
    const resolved = normalizeBuildOptions(opts, saved, ctx, presets);
    assert.strictEqual(resolved[0].value, "swo", "follows the preset, the null-state selection is not a real override");
    assert.strictEqual(resolved[0].isOverride, false);
  });

  test("presetState 'unresolved' forces isOverride false and the row is not overridable", () => {
    const states = [
      { id: "true", label: "Enabled", flag: "--pyopt=true" },
      { id: "false", label: "Disabled", flag: "--pyopt=false" },
    ];
    const opts = [multistate("pyopt", "--pyopt", states)];
    const presets = new Map([["pyopt", unresolvedPreset("pyopt")]]);
    const resolved = normalizeBuildOptions(opts, undefined, ctx, presets);
    assert.strictEqual(resolved[0].presetState, "unresolved");
    assert.strictEqual(resolved[0].isOverride, false);
  });

  test("presetState 'mismatch' forces isOverride false", () => {
    const opts = [checkbox("frozen", "--frozen")];
    const presets = new Map([["frozen", mismatchPreset("frozen", "yes")]]);
    const resolved = normalizeBuildOptions(opts, undefined, ctx, presets);
    assert.strictEqual(resolved[0].presetState, "mismatch");
    assert.strictEqual(resolved[0].isOverride, false);
  });
});

// ---------------------------------------------------------------------------
// deriveOptionFlags
// ---------------------------------------------------------------------------

suite("deriveOptionFlags", () => {
  function resolve(
    opt: BuildOption,
    available: boolean,
    value: boolean | string
  ): ResolvedOption {
    return { option: opt, available, value, presetState: "unresolved", isOverride: false };
  }

  test("returns empty array when no options are available", () => {
    const opt = checkbox("debug", "--debug");
    const resolved = [resolve(opt, false, true)];
    assert.deepStrictEqual(deriveOptionFlags(resolved), []);
  });

  test("includes flag for available checkbox with true value", () => {
    const opt = checkbox("debug", "--debug");
    const resolved = [resolve(opt, true, true)];
    assert.deepStrictEqual(deriveOptionFlags(resolved), ["--debug"]);
  });

  test("excludes flag for available checkbox with false value", () => {
    const opt = checkbox("debug", "--debug");
    const resolved = [resolve(opt, true, false)];
    assert.deepStrictEqual(deriveOptionFlags(resolved), []);
  });

  test("includes multistate flag for selected state with non-empty flag", () => {
    const states = [
      { id: "off", label: "Off", flag: "" },
      { id: "on", label: "On", flag: "--verbose" },
    ];
    const opt = multistate("verbose", "--verbose", states, "off");
    const resolved = [resolve(opt, true, "on")];
    assert.deepStrictEqual(deriveOptionFlags(resolved), ["--verbose"]);
  });

  test("excludes empty flag for multistate selected state", () => {
    const states = [
      { id: "off", label: "Off", flag: "" },
      { id: "on", label: "On", flag: "--verbose" },
    ];
    const opt = multistate("verbose", "--verbose", states, "off");
    const resolved = [resolve(opt, true, "off")];
    assert.deepStrictEqual(deriveOptionFlags(resolved), []);
  });

  test("preserves order of flags from multiple options", () => {
    const optA = checkbox("alpha", "--alpha");
    const optB = checkbox("beta", "--beta");
    const optC = checkbox("gamma", "--gamma");
    const resolved = [
      resolve(optA, true, true),
      resolve(optB, false, true), // unavailable, excluded
      resolve(optC, true, true),
    ];
    assert.deepStrictEqual(deriveOptionFlags(resolved), ["--alpha", "--gamma"]);
  });
});
