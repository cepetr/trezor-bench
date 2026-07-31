/**
 * Unit tests for preset-effective-value computation: the four-layer ordered
 * overlay and the raw-value -> option-value mapping table.
 *
 * specs/009-build-preset-support/data-model.md §2, §5 (research Decision 4, 8)
 */
import * as assert from "assert";
import * as vscode from "vscode";
import {
  buildPresetOverlay,
  computePresetEffectiveValue,
  computePresetEffectiveValues,
  presetMatchKey,
  samePresetEffectiveValue,
  shiftedPresetOptionKeys,
  PresetEffectiveValue,
} from "../../../presets/preset-resolution";
import { PresetFile, PresetFragment } from "../../../presets/preset-types";
import { BuildOption } from "../../../manifest/manifest-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHARED_URI = vscode.Uri.file("/workspace/xtask/tf-tools/presets.toml");
const USER_URI = vscode.Uri.file("/workspace/xtask/tf-tools/user-presets.toml");

const CTX = { modelId: "T2T1", projectId: "firmware", emulator: false };

function fragment(overrides: Partial<PresetFragment> & Pick<PresetFragment, "name" | "source">): PresetFragment {
  return { order: 0, filter: {}, values: {}, ...overrides };
}

function presetFile(overrides: Partial<PresetFile> & Pick<PresetFile, "source">): PresetFile {
  return {
    uri: overrides.source === "user" ? USER_URI : SHARED_URI,
    present: true,
    names: [],
    fragments: [],
    issues: [],
    ...overrides,
  };
}

function checkboxOption(id: string): BuildOption {
  return { key: id.replace(/-/g, "_"), id, label: id, flag: `--${id}`, kind: "checkbox" };
}

function multistateOption(
  id: string,
  states: Array<{ id: string; label: string; flag: string }>
): BuildOption {
  return {
    key: id.replace(/-/g, "_"),
    id,
    label: id,
    flag: `--${id}`,
    kind: "multistate",
    states,
  };
}

const DBG_CONSOLE_STATES = [
  { id: "null", label: "Default", flag: "" },
  { id: "swo", label: "SWO", flag: "--dbg-console=swo" },
  { id: "vcp", label: "VCP", flag: "--dbg-console=vcp" },
];

const PYOPT_STATES_NO_NULL = [
  { id: "true", label: "Enabled", flag: "--pyopt=true" },
  { id: "false", label: "Disabled", flag: "--pyopt=false" },
];

// ---------------------------------------------------------------------------
// presetMatchKey (research Decision 4)
// ---------------------------------------------------------------------------

suite("presetMatchKey", () => {
  test("uses option.id when present", () => {
    assert.strictEqual(presetMatchKey({ key: "x", id: "btc-only", label: "x", flag: "--btc-only", kind: "checkbox" }), "btc-only");
  });

  test("falls back to the flag with leading dashes stripped when id is absent", () => {
    assert.strictEqual(presetMatchKey({ key: "x", label: "x", flag: "--dbg-console", kind: "checkbox" }), "dbg-console");
  });
});

// ---------------------------------------------------------------------------
// buildPresetOverlay – four-layer precedence (FR-010, FR-011)
// ---------------------------------------------------------------------------

suite("buildPresetOverlay – layer precedence", () => {
  test("layers apply in order: shared defaults, user defaults, shared preset, user preset", () => {
    const shared = presetFile({
      source: "shared",
      fragments: [
        fragment({ name: "defaults", source: "shared", order: 0, values: { frozen: true, pyopt: true } }),
        fragment({ name: "dev", source: "shared", order: 0, values: { pyopt: false } }),
      ],
    });
    const user = presetFile({
      source: "user",
      fragments: [
        fragment({ name: "defaults", source: "user", order: 0, values: { frozen: false } }),
        fragment({ name: "dev", source: "user", order: 0, values: { "btc-only": true } }),
      ],
    });

    const overlay = buildPresetOverlay(shared, user, "dev", CTX);

    // user defaults overrides shared defaults for "frozen"
    assert.strictEqual(overlay.get("frozen")?.rawValue, false);
    // shared "dev" overrides shared defaults for "pyopt"
    assert.strictEqual(overlay.get("pyopt")?.rawValue, false);
    // user "dev" contributes a key no other layer set
    assert.strictEqual(overlay.get("btc-only")?.rawValue, true);
  });

  test("a later matching fragment in the same layer replaces one key and leaves others intact", () => {
    const shared = presetFile({
      source: "shared",
      fragments: [
        fragment({ name: "defaults", source: "shared", order: 0, values: { frozen: true, pyopt: true } }),
        fragment({ name: "defaults", source: "shared", order: 1, values: { frozen: false } }),
      ],
    });
    const user = presetFile({ source: "user" });

    const overlay = buildPresetOverlay(shared, user, "default", CTX);
    assert.strictEqual(overlay.get("frozen")?.rawValue, false, "later fragment replaces frozen");
    assert.strictEqual(overlay.get("pyopt")?.rawValue, true, "pyopt is retained from the earlier fragment");
  });

  test("layers 3 and 4 (named preset) are skipped when the active preset is default", () => {
    const shared = presetFile({
      source: "shared",
      fragments: [
        fragment({ name: "defaults", source: "shared", order: 0, values: { frozen: true } }),
        fragment({ name: "test", source: "shared", order: 0, values: { frozen: false } }),
      ],
    });
    const user = presetFile({ source: "user" });

    const overlay = buildPresetOverlay(shared, user, "default", CTX);
    assert.strictEqual(overlay.get("frozen")?.rawValue, true, "named-preset layer must not apply for Default");
  });

  test("non-matching fragments contribute nothing", () => {
    const shared = presetFile({
      source: "shared",
      fragments: [
        fragment({
          name: "defaults",
          source: "shared",
          order: 0,
          filter: { projects: ["bootloader"] },
          values: { frozen: true },
        }),
      ],
    });
    const user = presetFile({ source: "user" });
    const overlay = buildPresetOverlay(shared, user, "default", CTX);
    assert.strictEqual(overlay.has("frozen"), false);
  });
});

// ---------------------------------------------------------------------------
// Raw-value -> option-value mapping (data-model.md §2)
// ---------------------------------------------------------------------------

suite("computePresetEffectiveValue – checkbox", () => {
  const option = checkboxOption("frozen");

  test("boolean raw value -> resolved", () => {
    const overlay = new Map([["frozen", { rawValue: true, sourceUri: SHARED_URI }]]);
    const result = computePresetEffectiveValue(option, overlay);
    assert.strictEqual(result.state, "resolved");
    assert.strictEqual(result.value, true);
  });

  test("non-boolean raw value -> mismatch", () => {
    const overlay = new Map([["frozen", { rawValue: "yes" as unknown as boolean, sourceUri: SHARED_URI }]]);
    const result = computePresetEffectiveValue(option, overlay);
    assert.strictEqual(result.state, "mismatch");
    assert.strictEqual(result.rawValue, "yes");
    assert.strictEqual(result.sourceUri, SHARED_URI);
  });

  test("absent -> resolved false (upstream implicit disabled)", () => {
    const overlay = new Map();
    const result = computePresetEffectiveValue(option, overlay);
    assert.strictEqual(result.state, "resolved");
    assert.strictEqual(result.value, false);
  });
});

suite("computePresetEffectiveValue – multistate", () => {
  const dbgConsole = multistateOption("dbg-console", DBG_CONSOLE_STATES);
  const pyoptNoNull = multistateOption("pyopt", PYOPT_STATES_NO_NULL);

  test("value matching a state id -> resolved", () => {
    const overlay = new Map([["dbg-console", { rawValue: "swo", sourceUri: SHARED_URI }]]);
    const result = computePresetEffectiveValue(dbgConsole, overlay);
    assert.strictEqual(result.state, "resolved");
    assert.strictEqual(result.value, "swo");
  });

  test("value matching no state id -> mismatch", () => {
    const overlay = new Map([["dbg-console", { rawValue: "uart", sourceUri: SHARED_URI }]]);
    const result = computePresetEffectiveValue(dbgConsole, overlay);
    assert.strictEqual(result.state, "mismatch");
    assert.strictEqual(result.rawValue, "uart");
    assert.strictEqual(result.sourceUri, SHARED_URI);
  });

  test("absent with a null-valued state declared -> resolved to that state id", () => {
    const overlay = new Map();
    const result = computePresetEffectiveValue(dbgConsole, overlay);
    assert.strictEqual(result.state, "resolved");
    assert.strictEqual(result.value, "null");
  });

  test("absent with no null-valued state -> unresolved", () => {
    const overlay = new Map();
    const result = computePresetEffectiveValue(pyoptNoNull, overlay);
    assert.strictEqual(result.state, "unresolved");
    assert.strictEqual(result.value, undefined);
  });

  test("boolean-like raw values map to 'true'/'false' state ids", () => {
    const overlay = new Map([["pyopt", { rawValue: true, sourceUri: SHARED_URI }]]);
    const result = computePresetEffectiveValue(pyoptNoNull, overlay);
    assert.strictEqual(result.state, "resolved");
    assert.strictEqual(result.value, "true");
  });
});

suite("computePresetEffectiveValues – unknown keys contribute nothing", () => {
  test("a preset key matching no manifest option is ignored without affecting other options", () => {
    const options = [checkboxOption("frozen")];
    const shared = presetFile({
      source: "shared",
      fragments: [fragment({ name: "defaults", source: "shared", values: { asan: true, frozen: true } })],
    });
    const user = presetFile({ source: "user" });
    const result = computePresetEffectiveValues(options, shared, user, "default", CTX);
    assert.strictEqual(result.get("frozen")?.state, "resolved");
    assert.strictEqual(result.get("frozen")?.value, true);
    assert.strictEqual(result.size, 1, "only known options produce an entry");
  });
});

// ---------------------------------------------------------------------------
// samePresetEffectiveValue / shiftedPresetOptionKeys (FR-017)
//
// The per-option override prune: an override survives a (preset, context)
// change exactly when its calculated baseline did not move.
// ---------------------------------------------------------------------------

suite("samePresetEffectiveValue (FR-017)", () => {
  const resolved = (value: boolean | string): PresetEffectiveValue => ({
    optionKey: "frozen",
    state: "resolved",
    value,
  });

  test("two resolved calculations are equal only when the value is equal", () => {
    assert.strictEqual(samePresetEffectiveValue(resolved(true), resolved(true)), true);
    assert.strictEqual(samePresetEffectiveValue(resolved(true), resolved(false)), false);
    assert.strictEqual(samePresetEffectiveValue(resolved("swo"), resolved("swo")), true);
    assert.strictEqual(samePresetEffectiveValue(resolved("swo"), resolved("vcp")), false);
  });

  test("a resolved false and a resolved 'false' are different calculations", () => {
    assert.strictEqual(samePresetEffectiveValue(resolved(false), resolved("false")), false);
  });

  test("differing states are never equal, even when neither carries a value", () => {
    const unresolved: PresetEffectiveValue = { optionKey: "pyopt", state: "unresolved" };
    const mismatch: PresetEffectiveValue = { optionKey: "pyopt", state: "mismatch", rawValue: "nope" };
    assert.strictEqual(samePresetEffectiveValue(unresolved, mismatch), false);
    assert.strictEqual(samePresetEffectiveValue(unresolved, resolved("true")), false);
  });

  test("two unresolved calculations are equal", () => {
    assert.strictEqual(
      samePresetEffectiveValue(
        { optionKey: "pyopt", state: "unresolved" },
        { optionKey: "pyopt", state: "unresolved" }
      ),
      true
    );
  });

  test("two mismatches are equal only when the unrepresentable raw value is equal", () => {
    const a: PresetEffectiveValue = { optionKey: "dbg_console", state: "mismatch", rawValue: "nope" };
    const b: PresetEffectiveValue = { optionKey: "dbg_console", state: "mismatch", rawValue: "nope" };
    const c: PresetEffectiveValue = { optionKey: "dbg_console", state: "mismatch", rawValue: "other" };
    assert.strictEqual(samePresetEffectiveValue(a, b), true);
    assert.strictEqual(samePresetEffectiveValue(a, c), false);
  });

  test("a present/absent pair is never equal, and two absents are", () => {
    assert.strictEqual(samePresetEffectiveValue(resolved(true), undefined), false);
    assert.strictEqual(samePresetEffectiveValue(undefined, resolved(true)), false);
    assert.strictEqual(samePresetEffectiveValue(undefined, undefined), true);
  });
});

suite("shiftedPresetOptionKeys (FR-017)", () => {
  // Mirrors test-fixtures/workspaces/preset-valid/: the [[defaults]] fragments
  // are conditioned on `emulator`, `[[dev]]` moves dbg-console and pyopt, and
  // `[[local]]` touches only btc-only — so the same options move or hold
  // depending on which half of the pair changed.
  const OPTIONS = [
    checkboxOption("frozen"),
    checkboxOption("btc-only"),
    multistateOption("dbg-console", DBG_CONSOLE_STATES),
    multistateOption("pyopt", [
      { id: "null", label: "Default", flag: "" },
      ...PYOPT_STATES_NO_NULL,
    ]),
  ];

  const SHARED = presetFile({
    source: "shared",
    names: ["test", "dev"],
    fragments: [
      fragment({ name: "defaults", source: "shared", filter: { emulator: true }, values: { "dbg-console": "swo" } }),
      fragment({ name: "defaults", source: "shared", filter: { emulator: false }, values: { frozen: true, pyopt: true } }),
      fragment({ name: "test", source: "shared", values: { "btc-only": true, pyopt: true } }),
      fragment({
        name: "dev",
        source: "shared",
        filter: { emulator: false, projects: ["firmware"] },
        values: { "dbg-console": "swo", pyopt: false },
      }),
    ],
  });
  const USER = presetFile({
    source: "user",
    names: ["local", "test"],
    fragments: [
      fragment({ name: "local", source: "user", values: { "btc-only": false } }),
      fragment({ name: "test", source: "user", values: { frozen: false } }),
    ],
  });

  const EMU_CTX = { ...CTX, emulator: true };

  function effective(presetId: string, context = CTX): ReadonlyMap<string, PresetEffectiveValue> {
    return computePresetEffectiveValues(OPTIONS, SHARED, USER, presetId, context);
  }

  test("returns nothing when neither half of the pair moved a value", () => {
    assert.deepStrictEqual(shiftedPresetOptionKeys(effective("default"), effective("default")), []);
  });

  test("returns only the options the new preset calculates differently", () => {
    // default -> dev moves dbg-console (null -> swo) and pyopt (true -> false)
    // but leaves frozen and btc-only where the [[defaults]] layer put them.
    assert.deepStrictEqual(shiftedPresetOptionKeys(effective("default"), effective("dev")), [
      "dbg_console",
      "pyopt",
    ]);
  });

  test("returns nothing for a preset whose fragments calculate the same values", () => {
    // [[local]] sets btc-only = false, which is already the absent-checkbox value.
    assert.deepStrictEqual(shiftedPresetOptionKeys(effective("default"), effective("local")), []);
  });

  test("returns the options a context change moved, with the preset id fixed", () => {
    // Crossing the emulator boundary swaps which [[defaults]] fragment applies:
    // frozen true -> false, pyopt "true" -> "null", dbg-console "null" -> "swo".
    assert.deepStrictEqual(shiftedPresetOptionKeys(effective("default"), effective("default", EMU_CTX)), [
      "frozen",
      "dbg_console",
      "pyopt",
    ]);
  });

  test("returns nothing for a context change no fragment filters on", () => {
    const otherModel = { ...CTX, modelId: "T3W1" };
    assert.deepStrictEqual(shiftedPresetOptionKeys(effective("default"), effective("default", otherModel)), []);
  });

  test("keys are reported in before-then-after order", () => {
    const before = new Map<string, PresetEffectiveValue>([
      ["a", { optionKey: "a", state: "resolved", value: true }],
      ["b", { optionKey: "b", state: "resolved", value: true }],
    ]);
    const after = new Map<string, PresetEffectiveValue>([
      ["b", { optionKey: "b", state: "resolved", value: false }],
      ["c", { optionKey: "c", state: "resolved", value: true }],
    ]);
    // `a` vanished, `b` moved, `c` appeared — all three no longer stand.
    assert.deepStrictEqual(shiftedPresetOptionKeys(before, after), ["a", "b", "c"]);
  });
});
