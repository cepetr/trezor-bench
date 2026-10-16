import * as assert from "assert";
import { parseRustAnalyzerConfig } from "../../../rust-analyzer/config-parser";

suite("parseRustAnalyzerConfig", () => {
  const hardware = `
[cargo]
features = ["model-t"]
target = "thumbv7em-none-eabihf"
allTargets = false

[check]
extraArgs = ["--target", "thumbv7em-none-eabihf"]
`;

  const emulator = `
[cargo]
features = ["model-t"]
allTargets = true
`;

  test("flattens supported keys from a hardware configuration", () => {
    assert.deepStrictEqual(parseRustAnalyzerConfig(hardware, false), {
      "cargo.features": ["model-t"],
      "cargo.target": "thumbv7em-none-eabihf",
      "cargo.allTargets": false,
      "check.extraArgs": ["--target", "thumbv7em-none-eabihf"],
    });
  });

  test("accepts emulator output without hardware-only keys", () => {
    assert.deepStrictEqual(parseRustAnalyzerConfig(emulator, true), {
      "cargo.features": ["model-t"],
      "cargo.allTargets": true,
    });
  });

  test("rejects absent cargo.target for hardware", () => {
    assert.throws(() => parseRustAnalyzerConfig(emulator, false), /cargo\.target/);
  });

  test("rejects cargo.target for emulator", () => {
    assert.throws(() => parseRustAnalyzerConfig(hardware, true), /cargo\.target/);
  });

  test("accepts check.extraArgs for emulator", () => {
    const source = `${emulator}\n[check]\nextraArgs = ["--exclude", "secmon"]\n`;
    assert.deepStrictEqual(parseRustAnalyzerConfig(source, true), {
      "cargo.features": ["model-t"],
      "cargo.allTargets": true,
      "check.extraArgs": ["--exclude", "secmon"],
    });
  });

  test("accepts absent check.extraArgs for hardware", () => {
    const source = `[cargo]\nfeatures = ["model-t"]\ntarget = "thumbv7em-none-eabihf"\n`;
    assert.deepStrictEqual(parseRustAnalyzerConfig(source, false), {
      "cargo.features": ["model-t"],
      "cargo.target": "thumbv7em-none-eabihf",
    });
  });

  test("rejects empty, unknown, nested, and malformed content", () => {
    for (const source of [
      "",
      "[other]\nvalue = true",
      "[cargo.extra]\nvalue = true",
      "[cargo\nfeatures = []",
    ]) {
      assert.throws(() => parseRustAnalyzerConfig(source, true));
    }
  });

  test("rejects wrong value types and non-string extra arguments", () => {
    assert.throws(
      () => parseRustAnalyzerConfig("[cargo]\nfeatures = [1]\n", true),
      /cargo\.features/
    );
    assert.throws(
      () => parseRustAnalyzerConfig("[cargo]\nallTargets = \"true\"\n", true),
      /cargo\.allTargets/
    );
    assert.throws(
      () => parseRustAnalyzerConfig("[check]\nextraArgs = [\"--target\", 1]\n", true),
      /check\.extraArgs/
    );
  });
});
