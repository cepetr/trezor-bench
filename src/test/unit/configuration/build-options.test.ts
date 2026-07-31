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
  dropBuildOptionOverrides,
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
// dropBuildOptionOverrides — the FR-017 per-option prune
// ---------------------------------------------------------------------------

suite("dropBuildOptionOverrides (FR-017)", () => {
  test("drops only the named keys, so an override whose baseline held survives", async () => {
    const extCtx = makeExtContext();
    await writeBuildOption(extCtx, "frozen", false);
    await writeBuildOption(extCtx, "pyopt", "false");

    // Only pyopt's calculated value moved with the new (preset, context) pair.
    const dropped = await dropBuildOptionOverrides(extCtx, ["pyopt"]);
    assert.deepStrictEqual(dropped, ["pyopt"], "returns the dropped keys for the log record");
    assert.deepStrictEqual(readBuildOptions(extCtx)!.values, { frozen: false });

    // The dropped option follows the preset again; the kept one still overrides.
    const opts = [checkbox("frozen", "--frozen"), multistate("pyopt", "--pyopt", [
      { id: "true", label: "Enabled", flag: "--pyopt=true" },
      { id: "false", label: "Disabled", flag: "--pyopt=false" },
    ])];
    const presets = new Map([
      ["frozen", resolvedPreset("frozen", true)],
      ["pyopt", resolvedPreset("pyopt", "true")],
    ]);
    const resolved = normalizeBuildOptions(opts, readBuildOptions(extCtx), ctx, presets);
    assert.strictEqual(resolved[0].value, false, "the surviving override still wins");
    assert.strictEqual(resolved[0].isOverride, true);
    assert.strictEqual(resolved[1].value, "true", "the dropped one follows the preset-effective value");
    assert.strictEqual(resolved[1].isOverride, false);
  });

  test("drops every override when every calculated value moved", async () => {
    const extCtx = makeExtContext();
    await writeBuildOption(extCtx, "frozen", false);
    await writeBuildOption(extCtx, "pyopt", "false");
    const dropped = await dropBuildOptionOverrides(extCtx, ["frozen", "pyopt"]);
    assert.deepStrictEqual(dropped, ["frozen", "pyopt"]);
    assert.deepStrictEqual(readBuildOptions(extCtx)!.values, {});
  });

  test("clears a stale pre-feature checkbox false once that option's baseline moves", async () => {
    // The Phase 7 defect: before presets existed, unchecking a checkbox
    // persisted `false`, which now reads as an override and suppresses the
    // defaults layer with no way to undo it. It is still cleared here, because
    // an option whose newly calculated value the stored value would shadow is
    // by definition an option whose value moved.
    const extCtx = makeExtContext({
      [BUILD_OPTIONS_KEY]: { values: { pyopt: false }, persistedAt: "legacy" },
    });
    const opts = [checkbox("pyopt", "--pyopt")];
    const presets = new Map([["pyopt", resolvedPreset("pyopt", true)]]);

    const before = normalizeBuildOptions(opts, readBuildOptions(extCtx), ctx, presets);
    assert.strictEqual(before[0].value, false);
    assert.strictEqual(before[0].isOverride, true, "the stale value shadows the [[defaults]] value");

    await dropBuildOptionOverrides(extCtx, ["pyopt"]);
    const after = normalizeBuildOptions(opts, readBuildOptions(extCtx), ctx, presets);
    assert.strictEqual(after[0].value, true);
    assert.strictEqual(after[0].isOverride, false);
  });

  test("drops selections held for options hidden in the active context", async () => {
    const extCtx = makeExtContext();
    // An unavailable option still holds a value authored against the same
    // moving baseline, so it is pruned on the same rule as a visible one.
    await writeBuildOption(extCtx, "storage_insecure_testing_mode", true);
    const dropped = await dropBuildOptionOverrides(extCtx, ["storage_insecure_testing_mode"]);
    assert.deepStrictEqual(dropped, ["storage_insecure_testing_mode"]);
    assert.deepStrictEqual(readBuildOptions(extCtx)!.values, {});
  });

  test("ignores keys with nothing stored and writes nothing when none of them is", async () => {
    const extCtx = makeExtContext();
    assert.deepStrictEqual(await dropBuildOptionOverrides(extCtx, ["frozen"]), []);
    assert.strictEqual(readBuildOptions(extCtx), undefined, "no empty record is created");

    await writeBuildOption(extCtx, "frozen", false);
    const stored = readBuildOptions(extCtx)!;
    assert.deepStrictEqual(await dropBuildOptionOverrides(extCtx, ["pyopt", "btc_only"]), []);
    assert.strictEqual(readBuildOptions(extCtx), stored, "the record is left untouched");
  });

  test("writes nothing when the key list is empty", async () => {
    const extCtx = makeExtContext();
    await writeBuildOption(extCtx, "frozen", false);
    const stored = readBuildOptions(extCtx)!;
    assert.deepStrictEqual(await dropBuildOptionOverrides(extCtx, []), []);
    assert.strictEqual(readBuildOptions(extCtx), stored);
  });

  test("sets persistedAt timestamp", async () => {
    const before = new Date().toISOString();
    const extCtx = makeExtContext();
    await writeBuildOption(extCtx, "debug", true);
    await dropBuildOptionOverrides(extCtx, ["debug"]);
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

    // A different presetValue re-runs the comparison. Pruning the overrides
    // whose baseline moved is the refresh seam's job (FR-017, see the
    // dropBuildOptionOverrides suite above); normalizeBuildOptions never writes.
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
