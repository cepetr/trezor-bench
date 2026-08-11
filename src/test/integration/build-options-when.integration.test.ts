/**
 * Integration tests for Build Options when-expression gating,
 * grouped ordering, and hidden-value preservation.
 *
 * Runs inside the VS Code extension host via @vscode/test-electron.
 */
import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import { parseManifest } from "../../manifest/validate-manifest";
import {
  normalizeBuildOptions,
  deriveOptionFlags,
  BuildContext,
  BuildOptionsState,
} from "../../configuration/build-options";
import { evaluateWhenExpression } from "../../manifest/when-expressions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fixtureManifestSource(fixtureName: string): string {
  const fixturePath = path.resolve(
    __dirname,
    "../../../test-fixtures/manifests",
    fixtureName,
    "tbench.yaml"
  );
  return fs.readFileSync(fixturePath, "utf-8");
}

// ---------------------------------------------------------------------------
// Suite: options-grouped fixture
// ---------------------------------------------------------------------------

suite("Build Options – options-grouped fixture", () => {
  let parsed: ReturnType<typeof parseManifest>;

  setup(() => {
    parsed = parseManifest(fixtureManifestSource("options-grouped"));
  });

  test("fixture loads without structural errors", () => {
    assert.strictEqual(parsed.issues.filter((i) => i.severity === "error").length, 0);
    assert.ok(parsed.buildOptions.length > 0, "expected at least one option");
  });

  test("preserves manifest declaration order for options", () => {
    const labels = parsed.buildOptions.map((o) => o.label);
    // Per fixture: Debug Build (ungrouped), Fast (Build Tuning), Optimize (Build Tuning),
    // Experimental (Feature Flags), Verbosity (ungrouped), Strict (Build Tuning)
    assert.strictEqual(labels[0], "Debug Build");
    assert.strictEqual(labels[1], "Fast");
  });

  test("grouped options carry their group label", () => {
    const fast = parsed.buildOptions.find((o) => o.label === "Fast");
    assert.ok(fast, "expected Fast option");
    assert.strictEqual(fast!.group, "Build Tuning");
  });

  test("ungrouped option has no group", () => {
    const debug = parsed.buildOptions.find((o) => o.label === "Debug Build");
    assert.ok(debug, "expected Debug Build option");
    assert.strictEqual(debug!.group, undefined);
  });

  test("multistate Verbosity option is gated with when: target(hw)", () => {
    const verbosity = parsed.buildOptions.find((o) => o.label === "Verbosity");
    assert.ok(verbosity, "expected Verbosity option");
    assert.ok(verbosity!.when, "expected when expression");
    assert.deepStrictEqual(verbosity!.when, { type: "target", id: "hw" });
    assert.ok(verbosity!.states, "expected states");
  });

  test("Verbosity available for hw target, unavailable for emu", () => {
    const verbosity = parsed.buildOptions.find((o) => o.label === "Verbosity");
    assert.ok(verbosity?.when);
    const hwCtx: BuildContext = { modelId: "T2T1", targetId: "hw", componentId: "core" };
    const emuCtx: BuildContext = { modelId: "T2T1", targetId: "emu", componentId: "core" };
    assert.strictEqual(evaluateWhenExpression(verbosity.when, hwCtx), true);
    assert.strictEqual(evaluateWhenExpression(verbosity.when, emuCtx), false);
  });

  test("Verbosity option is available when resolved against hw context", () => {
    const hwCtx: BuildContext = { modelId: "T2T1", targetId: "hw", componentId: "core" };
    const resolved = normalizeBuildOptions(parsed.buildOptions, undefined, hwCtx);
    const verbosity = resolved.find((r) => r.option.label === "Verbosity");
    assert.ok(verbosity, "expected Verbosity in resolved list");
    assert.strictEqual(verbosity!.available, true);
  });

  test("Verbosity option is unavailable when resolved against emu context", () => {
    const emuCtx: BuildContext = { modelId: "T2T1", targetId: "emu", componentId: "core" };
    const resolved = normalizeBuildOptions(parsed.buildOptions, undefined, emuCtx);
    const verbosity = resolved.find((r) => r.option.label === "Verbosity");
    assert.ok(verbosity, "expected Verbosity in resolved list (even unavailable)");
    assert.strictEqual(verbosity!.available, false);
  });
});

// ---------------------------------------------------------------------------
// Suite: options-hidden-preserved fixture
// ---------------------------------------------------------------------------

suite("Build Options – options-hidden-preserved fixture", () => {
  let parsed: ReturnType<typeof parseManifest>;

  setup(() => {
    parsed = parseManifest(fixtureManifestSource("options-hidden-preserved"));
  });

  test("fixture loads without errors", () => {
    assert.strictEqual(parsed.issues.filter((i) => i.severity === "error").length, 0);
    assert.strictEqual(parsed.hasWorkflowBlockingIssues, false);
  });

  test("all() when expression gates T3W1+hw option correctly", () => {
    const t3w1HwOpt = parsed.buildOptions.find((o) => o.label === "T3W1 Hardware Only");
    assert.ok(t3w1HwOpt?.when, "expected T3W1 Hardware Only option with when");

    const matchCtx: BuildContext = { modelId: "T3W1", targetId: "hw", componentId: "core" };
    const noMatchCtx: BuildContext = { modelId: "T2T1", targetId: "hw", componentId: "core" };

    assert.strictEqual(evaluateWhenExpression(t3w1HwOpt.when!, matchCtx), true);
    assert.strictEqual(evaluateWhenExpression(t3w1HwOpt.when!, noMatchCtx), false);
  });

  test("any() when expression gates T2T1-or-emu option correctly", () => {
    const opt = parsed.buildOptions.find((o) => o.label === "Emu or T2T1");
    assert.ok(opt?.when, "expected Emu or T2T1 option with when");

    // T2T1 model
    assert.strictEqual(
      evaluateWhenExpression(opt.when!, { modelId: "T2T1", targetId: "hw", componentId: "core" }),
      true
    );
    // emu target
    assert.strictEqual(
      evaluateWhenExpression(opt.when!, { modelId: "T3W1", targetId: "emu", componentId: "core" }),
      true
    );
    // neither
    assert.strictEqual(
      evaluateWhenExpression(opt.when!, { modelId: "T3W1", targetId: "hw", componentId: "core" }),
      false
    );
  });

  test("hidden option retains persisted value after context switch makes it unavailable", () => {
    // Start with T2T1 context and select Legacy Mode (only for T2T1)
    const savedForT2T1: BuildOptionsState = {
      values: { legacy: true }, // "legacy" key from "--legacy" flag
      persistedAt: "2026-01-01T00:00:00Z",
    };

    // Switch to T3W1 context
    const t3w1Ctx: BuildContext = { modelId: "T3W1", targetId: "hw", componentId: "core" };
    const resolved = normalizeBuildOptions(parsed.buildOptions, savedForT2T1, t3w1Ctx);

    const legacy = resolved.find((r) => r.option.label === "Legacy Mode");
    assert.ok(legacy, "expected Legacy Mode in resolved list");
    assert.strictEqual(legacy!.available, false, "Legacy Mode should be unavailable for T3W1");
    assert.strictEqual(legacy!.value, true, "persisted value should be preserved");
  });

  test("hidden option reactivates when context switches back", () => {
    const saved: BuildOptionsState = {
      values: { legacy: true },
      persistedAt: "2026-01-01T00:00:00Z",
    };

    // Restore T2T1 context
    const t2t1Ctx: BuildContext = { modelId: "T2T1", targetId: "hw", componentId: "core" };
    const resolved = normalizeBuildOptions(parsed.buildOptions, saved, t2t1Ctx);

    const legacy = resolved.find((r) => r.option.label === "Legacy Mode");
    assert.ok(legacy);
    assert.strictEqual(legacy!.available, true, "Legacy Mode should be available for T2T1");
    assert.strictEqual(legacy!.value, true, "preserved value should be active");
  });
});

// ---------------------------------------------------------------------------
// Suite: invalid-when fixture
// ---------------------------------------------------------------------------

suite("Build Options – invalid-when fixture", () => {
  test("marks hasWorkflowBlockingIssues for a manifest with invalid when expressions", () => {
    const parsed = parseManifest(fixtureManifestSource("invalid-when"));
    assert.strictEqual(parsed.hasWorkflowBlockingIssues, true);
    assert.ok(
      parsed.issues.some((i) => i.code === "invalid-when"),
      "expected invalid-when diagnostic"
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: deriveOptionFlags integration
// ---------------------------------------------------------------------------

suite("Build Options – effective flag derivation", () => {
  test("derives flags only for available and enabled options", () => {
    const parsed = parseManifest(fixtureManifestSource("options-hidden-preserved"));

    // T2T1 + hw: Legacy Mode and Hardware Perf should both be available
    const saved: BuildOptionsState = {
      values: { legacy: true, hw_perf: true },
      persistedAt: "2026-01-01T00:00:00Z",
    };
    const ctx: BuildContext = { modelId: "T2T1", targetId: "hw", componentId: "core" };
    const resolved = normalizeBuildOptions(parsed.buildOptions, saved, ctx);
    const flags = deriveOptionFlags(resolved);

    assert.ok(flags.includes("--legacy"), "expected --legacy flag");
    assert.ok(flags.includes("--hw-perf"), "expected --hw-perf flag"); // key: hw_perf
    // Next Gen is for T3W1 only — should not appear
    assert.ok(!flags.includes("--next-gen"), "should not include --next-gen");
  });

  test("unavailable option with persisted true value does not produce a flag", () => {
    const parsed = parseManifest(fixtureManifestSource("options-hidden-preserved"));

    // Legacy Mode is only for T2T1 — persisted as true but context is T3W1
    const saved: BuildOptionsState = {
      values: { legacy: true },
      persistedAt: "2026-01-01T00:00:00Z",
    };
    const t3w1Ctx: BuildContext = { modelId: "T3W1", targetId: "hw", componentId: "core" };
    const resolved = normalizeBuildOptions(parsed.buildOptions, saved, t3w1Ctx);

    const legacy = resolved.find((r) => r.option.label === "Legacy Mode");
    assert.ok(legacy, "expected Legacy Mode in resolved options");
    assert.strictEqual(legacy!.available, false, "Legacy Mode should be unavailable for T3W1");
    assert.strictEqual(legacy!.value, true, "persisted value should still be true");

    const flags = deriveOptionFlags(resolved);
    assert.ok(!flags.includes("--legacy"), "unavailable option must not produce --legacy flag");
  });
});

// ---------------------------------------------------------------------------
// Suite: regression – multi-hop hidden value preservation
// ---------------------------------------------------------------------------

suite("Build Options – multi-hop hidden value preservation", () => {
  let parsed: ReturnType<typeof parseManifest>;

  setup(() => {
    parsed = parseManifest(fixtureManifestSource("options-hidden-preserved"));
  });

  test("value survives T2T1 → T3W1 → T2T1 context round-trip", () => {
    // Step 1: select Legacy Mode in T2T1 context
    const t2t1Ctx: BuildContext = { modelId: "T2T1", targetId: "hw", componentId: "core" };
    const initialSaved: BuildOptionsState = {
      values: { legacy: true },
      persistedAt: "2026-01-01T00:00:00Z",
    };

    // Step 2: switch to T3W1 — value should be preserved but unavailable
    const t3w1Ctx: BuildContext = { modelId: "T3W1", targetId: "hw", componentId: "core" };
    const midResolved = normalizeBuildOptions(parsed.buildOptions, initialSaved, t3w1Ctx);
    const midLegacy = midResolved.find((r) => r.option.label === "Legacy Mode");
    assert.ok(midLegacy);
    assert.strictEqual(midLegacy!.available, false);
    assert.strictEqual(midLegacy!.value, true, "value preserved at T3W1 hop");

    // Simulate persisting mid-state (value retained even though unavailable)
    const midSaved: BuildOptionsState = {
      values: { legacy: midLegacy!.value as boolean },
      persistedAt: "2026-01-01T00:00:01Z",
    };

    // Step 3: switch back to T2T1 — value must still be true
    const finalResolved = normalizeBuildOptions(parsed.buildOptions, midSaved, t2t1Ctx);
    const finalLegacy = finalResolved.find((r) => r.option.label === "Legacy Mode");
    assert.ok(finalLegacy);
    assert.strictEqual(finalLegacy!.available, true, "Legacy Mode available again for T2T1");
    assert.strictEqual(finalLegacy!.value, true, "preserved value survives full round-trip");
  });

  test("value survives three-hop chain: T2T1 → T3W1 → T2T1 → T3W1", () => {
    const t2t1Ctx: BuildContext = { modelId: "T2T1", targetId: "hw", componentId: "core" };
    const t3w1Ctx: BuildContext = { modelId: "T3W1", targetId: "hw", componentId: "core" };

    // Start: selected in T2T1
    let saved: BuildOptionsState = { values: { legacy: true }, persistedAt: "2026-01-01T00:00:00Z" };

    // Hop 1: T2T1 → T3W1
    let resolved = normalizeBuildOptions(parsed.buildOptions, saved, t3w1Ctx);
    let opt = resolved.find((r) => r.option.label === "Legacy Mode")!;
    assert.strictEqual(opt.value, true);
    saved = { values: { legacy: opt.value as boolean }, persistedAt: saved.persistedAt };

    // Hop 2: T3W1 → T2T1
    resolved = normalizeBuildOptions(parsed.buildOptions, saved, t2t1Ctx);
    opt = resolved.find((r) => r.option.label === "Legacy Mode")!;
    assert.strictEqual(opt.available, true);
    assert.strictEqual(opt.value, true);
    saved = { values: { legacy: opt.value as boolean }, persistedAt: saved.persistedAt };

    // Hop 3: T2T1 → T3W1 again — value must still be true
    resolved = normalizeBuildOptions(parsed.buildOptions, saved, t3w1Ctx);
    opt = resolved.find((r) => r.option.label === "Legacy Mode")!;
    assert.strictEqual(opt.available, false);
    assert.strictEqual(opt.value, true, "value survives three-hop chain");
  });
});
