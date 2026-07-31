/**
 * Unit tests for the pure preset TOML parser/validator.
 *
 * parsePresetFile() never touches the filesystem. It turns raw TOML text
 * into fragments plus validation issues, matching the shape contract in
 * specs/009-build-preset-support/contracts/preset-files.md.
 */
import * as assert from "assert";
import { parsePresetFile } from "../../../presets/parse-presets";

// ---------------------------------------------------------------------------
// TOML syntax errors
// ---------------------------------------------------------------------------

suite("parsePresetFile – TOML syntax errors", () => {
  test("returns a toml-parse error issue with a line/column range", () => {
    const result = parsePresetFile("[[defaults]\nfrozen = true\n", "shared");
    assert.strictEqual(result.fragments.length, 0);
    assert.strictEqual(result.names.length, 0);
    assert.strictEqual(result.issues.length, 1);
    assert.strictEqual(result.issues[0].severity, "error");
    assert.strictEqual(result.issues[0].code, "toml-parse");
    assert.ok(result.issues[0].range, "expected a range for the syntax error");
  });
});

// ---------------------------------------------------------------------------
// Shape validation (research Decision 6)
// ---------------------------------------------------------------------------

suite("parsePresetFile – shape validation", () => {
  test("reports invalid-filter when a top-level value is not an array of tables", () => {
    const result = parsePresetFile('some-scalar = "oops"\n', "shared");
    const issue = result.issues.find((i) => i.code === "invalid-filter");
    assert.ok(issue, "expected an invalid-filter issue");
    assert.strictEqual(issue?.severity, "error");
  });

  test("reports invalid-filter when when is not a table", () => {
    const result = parsePresetFile('[[test]]\nwhen = "always"\n', "shared");
    const issue = result.issues.find((i) => i.code === "invalid-filter");
    assert.ok(issue, "expected an invalid-filter issue for non-table when");
  });

  test("reports invalid-filter for an unknown when field", () => {
    const result = parsePresetFile('[[test]]\nwhen = { arch = "arm" }\n', "shared");
    const issue = result.issues.find((i) => i.code === "invalid-filter");
    assert.ok(issue, "expected an invalid-filter issue for unknown when field");
  });

  test("reports invalid-filter when when.model is not an array of strings", () => {
    const result = parsePresetFile('[[test]]\nwhen = { model = "T2T1" }\n', "shared");
    const issue = result.issues.find((i) => i.code === "invalid-filter");
    assert.ok(issue, "expected an invalid-filter issue for non-array when.model");
  });

  test("reports invalid-filter when when.project is not an array of strings", () => {
    const result = parsePresetFile('[[test]]\nwhen = { project = [1, 2] }\n', "shared");
    const issue = result.issues.find((i) => i.code === "invalid-filter");
    assert.ok(issue, "expected an invalid-filter issue for non-string-array when.project");
  });

  test("reports invalid-filter when when.emulator is not a boolean", () => {
    const result = parsePresetFile('[[test]]\nwhen = { emulator = "true" }\n', "shared");
    const issue = result.issues.find((i) => i.code === "invalid-filter");
    assert.ok(issue, "expected an invalid-filter issue for non-boolean when.emulator");
  });

  test("accepts a well-formed when table with no issues", () => {
    const result = parsePresetFile(
      '[[dev]]\nwhen = { model = ["T2T1"], project = ["firmware"], emulator = false }\nfrozen = true\n',
      "shared"
    );
    assert.strictEqual(result.issues.length, 0);
    assert.strictEqual(result.fragments.length, 1);
    assert.deepStrictEqual(result.fragments[0].filter.models, ["T2T1"]);
    assert.deepStrictEqual(result.fragments[0].filter.projects, ["firmware"]);
    assert.strictEqual(result.fragments[0].filter.emulator, false);
  });
});

// ---------------------------------------------------------------------------
// Reserved name handling (research Decision 7)
// ---------------------------------------------------------------------------

suite("parsePresetFile – reserved preset name", () => {
  test("[[default]] produces a reserved-preset-name warning that does not block", () => {
    const result = parsePresetFile("[[default]]\nfrozen = true\n", "shared");
    const issue = result.issues.find((i) => i.code === "reserved-preset-name");
    assert.ok(issue, "expected a reserved-preset-name issue");
    assert.strictEqual(issue?.severity, "warning");
    assert.ok(
      result.issues.every((i) => i.severity !== "error"),
      "reserved-preset-name must not itself be an error"
    );
  });

  test("[[default]] is excluded from names", () => {
    const result = parsePresetFile("[[default]]\nfrozen = true\n\n[[test]]\nfrozen = false\n", "shared");
    assert.deepStrictEqual(result.names, ["test"]);
  });

  test("[[defaults]] is excluded from names but its fragments are kept", () => {
    const result = parsePresetFile("[[defaults]]\nfrozen = true\n", "shared");
    assert.deepStrictEqual(result.names, []);
    assert.strictEqual(result.fragments.length, 1);
    assert.strictEqual(result.fragments[0].name, "defaults");
  });
});

// ---------------------------------------------------------------------------
// Unknown option keys (research Decision 5)
// ---------------------------------------------------------------------------

suite("parsePresetFile – unknown option keys", () => {
  test("keys unrecognized by any manifest are parsed and retained without any issue", () => {
    const result = parsePresetFile("[[defaults]]\nasan = true\nfrozen = true\n", "shared");
    assert.strictEqual(result.issues.length, 0);
    assert.deepStrictEqual(result.fragments[0].values, { asan: true, frozen: true });
  });
});

// ---------------------------------------------------------------------------
// Declaration order (FR-003, FR-011)
// ---------------------------------------------------------------------------

suite("parsePresetFile – declaration order", () => {
  test("names reflect first-declaration order, excluding defaults", () => {
    const result = parsePresetFile(
      "[[test]]\nfrozen = true\n\n[[defaults]]\npyopt = true\n\n[[dev]]\nfrozen = false\n",
      "shared"
    );
    assert.deepStrictEqual(result.names, ["test", "dev"]);
  });

  test("fragment order preserves file order within a (source, name) group", () => {
    const result = parsePresetFile(
      "[[test]]\nfrozen = true\n\n[[test]]\nfrozen = false\n",
      "shared"
    );
    const testFragments = result.fragments.filter((f) => f.name === "test");
    assert.strictEqual(testFragments.length, 2);
    assert.strictEqual(testFragments[0].order, 0);
    assert.strictEqual(testFragments[1].order, 1);
    assert.strictEqual(testFragments[0].values.frozen, true);
    assert.strictEqual(testFragments[1].values.frozen, false);
  });

  test("every fragment records its declared source", () => {
    const result = parsePresetFile("[[test]]\nfrozen = true\n", "user");
    assert.strictEqual(result.fragments[0].source, "user");
  });
});

// ---------------------------------------------------------------------------
// headerLine anchoring (research Decision 15)
// ---------------------------------------------------------------------------

suite("parsePresetFile – headerLine anchoring", () => {
  test("captures the 0-based line of each [[name]] header", () => {
    const source = "# comment\n[[test]]\nfrozen = true\n\n[[dev]]\nfrozen = false\n";
    const result = parsePresetFile(source, "shared");
    const test = result.fragments.find((f) => f.name === "test");
    const dev = result.fragments.find((f) => f.name === "dev");
    assert.strictEqual(test?.headerLine, 1);
    assert.strictEqual(dev?.headerLine, 4);
  });

  test("captures a distinct headerLine per repeated fragment", () => {
    const source = "[[test]]\nfrozen = true\n\n[[test]]\nfrozen = false\n";
    const result = parsePresetFile(source, "shared");
    const testFragments = result.fragments.filter((f) => f.name === "test");
    assert.strictEqual(testFragments[0].headerLine, 0);
    assert.strictEqual(testFragments[1].headerLine, 3);
  });
});

// ---------------------------------------------------------------------------
// Real upstream shape (research Decision 5, Decision 6)
// ---------------------------------------------------------------------------

suite("parsePresetFile – upstream presets.toml shape", () => {
  test("loads the documented upstream shape with zero error issues", () => {
    const source = `
[[defaults]]
when = { emulator = true }
dbg-console = "swo"
source-lines = true

[[defaults]]
when = { emulator = false }
frozen = true
pyopt = true
asan = true

[[test]]
debug = true
pyopt = true

[[dev]]
when = { emulator = false, project = ["firmware", "kernel"] }
dbg-console = "swo"
debug = true
pyopt = false
`.trim();

    const result = parsePresetFile(source, "shared");
    const errors = result.issues.filter((i) => i.severity === "error");
    assert.strictEqual(errors.length, 0, `expected no errors, got: ${JSON.stringify(errors)}`);
    assert.deepStrictEqual(result.names, ["test", "dev"]);

    const dev = result.fragments.find((f) => f.name === "dev");
    assert.deepStrictEqual(dev?.filter.projects, ["firmware", "kernel"]);
    assert.strictEqual(dev?.values.asan, undefined);

    const secondDefaults = result.fragments.filter((f) => f.name === "defaults")[1];
    assert.strictEqual(secondDefaults.values.asan, true);
  });
});
