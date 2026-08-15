/**
 * Unit tests for CpptoolsBackend in cpptools-backend.ts
 *
 * Covers:
 *  - getLastPayload before and after applyPayload
 *  - canProvideConfiguration: false before payload, true after
 *  - provideConfigurations: per-file includePath, defines, intelliSenseMode, standard,
 *    forcedIncludes, compilerPath, compilerArgs
 *  - provideConfigurations: returns empty array for unknown URI
 *  - canProvideBrowseConfiguration: false before payload, true after
 *  - provideBrowseConfiguration: browsePath, compilerPath from snapshot
 *  - canProvideBrowseConfigurationsPerFolder: always false
 *  - clearPayload: getLastPayload becomes undefined
 *  - clearPayload: canProvideConfiguration becomes false
 *  - PROVIDER_SETTING_FIX: correct section, key, and value
 *  - resolveIntelliSenseMode: gcc-c, gcc-cpp, clang-c, clang-cpp
 */

import * as assert from "assert";
import * as vscode from "vscode";
import {
  CpptoolsBackend,
  PROVIDER_SETTING_FIX,
} from "../../../intellisense/cpptools-backend";
import { ProviderPayload, ParsedCompileEntry, BrowseConfigurationSnapshot } from "../../../intellisense/intellisense-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  filePath: string,
  overrides: Partial<ParsedCompileEntry> = {}
): ParsedCompileEntry {
  return {
    filePath,
    directory: "/workspace",
    compilerPath: "arm-none-eabi-gcc",
    arguments: ["-Wall"],
    includePaths: ["/workspace/include"],
    defines: ["TREZOR_MODEL_T"],
    forcedIncludes: ["/workspace/config.h"],
    languageFamily: "c",
    standard: "c11",
    rawIndex: 0,
    ...overrides,
  };
}

function makePayload(entries: ParsedCompileEntry[]): ProviderPayload {
  const entriesByFile = new Map<string, ParsedCompileEntry>();
  for (const e of entries) {
    entriesByFile.set(e.filePath, e);
  }
  const browseSnapshot: BrowseConfigurationSnapshot = {
    browsePaths: entries.flatMap(e => e.includePaths),
    compilerPath: entries[0]?.compilerPath,
    compilerArgs: entries[0]?.arguments ?? [],
  };
  return {
    artifactPath: "/workspace/compile_commands.cc.json",
    contextKey: "T2T1::hw::core",
    entriesByFile,
    browseSnapshot,
  };
}

function makeUri(fsPath: string): vscode.Uri {
  return vscode.Uri.file(fsPath);
}

// ---------------------------------------------------------------------------
// getLastPayload
// ---------------------------------------------------------------------------

suite("CpptoolsBackend – getLastPayload", () => {
  test("returns undefined before any payload is applied", () => {
    const backend = new CpptoolsBackend(() => undefined);
    assert.strictEqual(backend.getLastPayload(), undefined);
  });

  test("returns the applied payload after applyPayload", () => {
    const backend = new CpptoolsBackend(() => undefined);
    const payload = makePayload([makeEntry("/workspace/main.c")]);
    backend.applyPayload(payload);
    assert.strictEqual(backend.getLastPayload(), payload);
  });

  test("returns undefined after clearPayload", () => {
    const backend = new CpptoolsBackend(() => undefined);
    backend.applyPayload(makePayload([makeEntry("/workspace/main.c")]));
    backend.clearPayload();
    assert.strictEqual(backend.getLastPayload(), undefined);
  });
});

// ---------------------------------------------------------------------------
// activate – registration and late replay
// ---------------------------------------------------------------------------

suite("CpptoolsBackend – activate", () => {
  test("registers the provider when async api accessor resolves", async () => {
    let registeredProvider: unknown;
    const api = {
      registerCustomConfigurationProvider(provider: unknown) {
        registeredProvider = provider;
      },
      notifyReady() {},
      didChangeCustomConfiguration() {},
      didChangeCustomBrowseConfiguration() {},
      dispose() {},
    };

    const backend = new CpptoolsBackend(async () => api);
    await backend.activate();

    assert.strictEqual(registeredProvider, backend);
  });

  test("replays payload notifications after late registration", async () => {
    const calls: string[] = [];
    const api = {
      registerCustomConfigurationProvider() {
        calls.push("register");
      },
      notifyReady() {
        calls.push("notifyReady");
      },
      didChangeCustomConfiguration() {
        calls.push("didChangeCustomConfiguration");
      },
      didChangeCustomBrowseConfiguration() {
        calls.push("didChangeCustomBrowseConfiguration");
      },
      dispose() {},
    };

    const backend = new CpptoolsBackend(async () => api);
    backend.applyPayload(makePayload([makeEntry("/workspace/main.c")]));

    await backend.activate();

    assert.deepStrictEqual(calls, [
      "register",
      "notifyReady",
      "didChangeCustomConfiguration",
      "didChangeCustomBrowseConfiguration",
    ]);
  });

  test("returns without registration when api accessor resolves to undefined", async () => {
    const backend = new CpptoolsBackend(async () => undefined);
    await backend.activate();
    assert.strictEqual(backend.getLastPayload(), undefined);
  });

  test("does not throw when v7 api acquisition is unsupported", async () => {
    const backend = new CpptoolsBackend(async () => {
      throw new RangeError("Invalid version");
    });

    await assert.doesNotReject(async () => {
      await backend.activate();
    });
  });
});

// ---------------------------------------------------------------------------
// canProvideConfiguration
// ---------------------------------------------------------------------------

suite("CpptoolsBackend – canProvideConfiguration", () => {
  test("returns false before any payload is applied", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const result = await backend.canProvideConfiguration(makeUri("/workspace/main.c"));
    assert.strictEqual(result, false);
  });

  test("returns true for a URI present in the payload", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    backend.applyPayload(makePayload([makeEntry("/workspace/main.c")]));
    const result = await backend.canProvideConfiguration(makeUri("/workspace/main.c"));
    assert.strictEqual(result, true);
  });

  test("returns false for a URI not present in the payload", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    backend.applyPayload(makePayload([makeEntry("/workspace/main.c")]));
    const result = await backend.canProvideConfiguration(makeUri("/workspace/unknown.c"));
    assert.strictEqual(result, false);
  });

  test("returns false for a header when only the including source file is indexed", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    backend.applyPayload(makePayload([makeEntry("/workspace/core/embed/main.c")]));
    const result = await backend.canProvideConfiguration(makeUri("/workspace/core/embed/mpu.h"));
    assert.strictEqual(result, false);
  });

  test("returns false after clearPayload", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    backend.applyPayload(makePayload([makeEntry("/workspace/main.c")]));
    backend.clearPayload();
    const result = await backend.canProvideConfiguration(makeUri("/workspace/main.c"));
    assert.strictEqual(result, false);
  });
});

// ---------------------------------------------------------------------------
// provideConfigurations – per-file fields
// ---------------------------------------------------------------------------

suite("CpptoolsBackend – provideConfigurations", () => {
  test("returns empty array when no payload is set", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const items = await backend.provideConfigurations([makeUri("/workspace/main.c")]);
    assert.deepStrictEqual(items, []);
  });

  test("returns empty array for URI not in the payload", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    backend.applyPayload(makePayload([makeEntry("/workspace/main.c")]));
    const items = await backend.provideConfigurations([makeUri("/workspace/unknown.c")]);
    assert.deepStrictEqual(items, []);
  });

  test("returns empty array for a header that is not indexed in the payload", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    backend.applyPayload(makePayload([makeEntry("/workspace/core/embed/main.c")]));
    const items = await backend.provideConfigurations([makeUri("/workspace/core/embed/mpu.h")]);
    assert.deepStrictEqual(items, []);
  });

  test("returns correct includePath for a known URI", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const entry = makeEntry("/workspace/main.c", { includePaths: ["/workspace/include", "/workspace/vendor"] });
    backend.applyPayload(makePayload([entry]));
    const items = await backend.provideConfigurations([makeUri("/workspace/main.c")]);
    assert.strictEqual(items.length, 1);
    assert.deepStrictEqual(items[0].configuration.includePath, ["/workspace/include", "/workspace/vendor"]);
  });

  test("returns correct defines for a known URI", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const entry = makeEntry("/workspace/main.c", { defines: ["TREZOR_MODEL_T", "NDEBUG"] });
    backend.applyPayload(makePayload([entry]));
    const items = await backend.provideConfigurations([makeUri("/workspace/main.c")]);
    assert.strictEqual(items.length, 1);
    assert.deepStrictEqual(items[0].configuration.defines, ["TREZOR_MODEL_T", "NDEBUG"]);
  });

  test("returns 'c11' standard for a .c entry with -std=c11", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const entry = makeEntry("/workspace/main.c", { standard: "c11" });
    backend.applyPayload(makePayload([entry]));
    const items = await backend.provideConfigurations([makeUri("/workspace/main.c")]);
    assert.strictEqual(items[0].configuration.standard, "c11");
  });

  test("returns forcedInclude for a .c entry", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const entry = makeEntry("/workspace/main.c", { forcedIncludes: ["/workspace/config.h"] });
    backend.applyPayload(makePayload([entry]));
    const items = await backend.provideConfigurations([makeUri("/workspace/main.c")]);
    assert.deepStrictEqual(items[0].configuration.forcedInclude, ["/workspace/config.h"]);
  });

  test("returns compilerPath for a .c entry", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const entry = makeEntry("/workspace/main.c", { compilerPath: "arm-none-eabi-gcc" });
    backend.applyPayload(makePayload([entry]));
    const items = await backend.provideConfigurations([makeUri("/workspace/main.c")]);
    assert.strictEqual(items[0].configuration.compilerPath, "arm-none-eabi-gcc");
  });

  test("returns gcc-c intelliSenseMode for C entry with gcc compiler", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const entry = makeEntry("/workspace/main.c", {
      compilerPath: "arm-none-eabi-gcc",
      languageFamily: "c",
    });
    backend.applyPayload(makePayload([entry]));
    const items = await backend.provideConfigurations([makeUri("/workspace/main.c")]);
    assert.strictEqual(items[0].configuration.intelliSenseMode, "gcc-c");
  });

  test("returns gcc-cpp intelliSenseMode for C++ entry with g++ compiler", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const entry = makeEntry("/workspace/sha256.cpp", {
      compilerPath: "arm-none-eabi-g++",
      languageFamily: "cpp",
    });
    backend.applyPayload(makePayload([entry]));
    const items = await backend.provideConfigurations([makeUri("/workspace/sha256.cpp")]);
    assert.strictEqual(items[0].configuration.intelliSenseMode, "gcc-cpp");
  });

  test("returns clang-c intelliSenseMode for C entry with clang compiler", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const entry = makeEntry("/workspace/main.c", {
      compilerPath: "clang",
      languageFamily: "c",
    });
    backend.applyPayload(makePayload([entry]));
    const items = await backend.provideConfigurations([makeUri("/workspace/main.c")]);
    assert.strictEqual(items[0].configuration.intelliSenseMode, "clang-c");
  });

  test("returns clang-cpp intelliSenseMode for C++ entry with clang++ compiler", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const entry = makeEntry("/workspace/foo.cpp", {
      compilerPath: "clang++",
      languageFamily: "cpp",
    });
    backend.applyPayload(makePayload([entry]));
    const items = await backend.provideConfigurations([makeUri("/workspace/foo.cpp")]);
    assert.strictEqual(items[0].configuration.intelliSenseMode, "clang-cpp");
  });

  test("handles multiple URIs in a single call", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const entries = [
      makeEntry("/workspace/a.c"),
      makeEntry("/workspace/b.c", { defines: ["B_DEFINE"] }),
    ];
    backend.applyPayload(makePayload(entries));
    const items = await backend.provideConfigurations([
      makeUri("/workspace/a.c"),
      makeUri("/workspace/b.c"),
      makeUri("/workspace/unknown.c"),
    ]);
    assert.strictEqual(items.length, 2);
    assert.ok(items.some(i => i.uri.fsPath === "/workspace/a.c"));
    assert.ok(items.some(i => i.uri.fsPath === "/workspace/b.c"));
  });
});

// ---------------------------------------------------------------------------
// canProvideBrowseConfiguration
// ---------------------------------------------------------------------------

suite("CpptoolsBackend – canProvideBrowseConfiguration", () => {
  test("returns false before any payload is applied", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const result = await backend.canProvideBrowseConfiguration();
    assert.strictEqual(result, false);
  });

  test("returns true after applyPayload", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    backend.applyPayload(makePayload([makeEntry("/workspace/main.c")]));
    const result = await backend.canProvideBrowseConfiguration();
    assert.strictEqual(result, true);
  });

  test("returns false after clearPayload", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    backend.applyPayload(makePayload([makeEntry("/workspace/main.c")]));
    backend.clearPayload();
    const result = await backend.canProvideBrowseConfiguration();
    assert.strictEqual(result, false);
  });
});

// ---------------------------------------------------------------------------
// provideBrowseConfiguration
// ---------------------------------------------------------------------------

suite("CpptoolsBackend – provideBrowseConfiguration", () => {
  test("returns empty browsePath when no payload is set", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const result = await backend.provideBrowseConfiguration();
    assert.deepStrictEqual(result.browsePath, []);
  });

  test("returns browsePaths from the payload browse snapshot", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const entry = makeEntry("/workspace/main.c", { includePaths: ["/workspace/include", "/workspace/vendor"] });
    const payload = makePayload([entry]);
    backend.applyPayload(payload);
    const result = await backend.provideBrowseConfiguration();
    assert.ok(result.browsePath.includes("/workspace/include"), "expected /workspace/include in browsePath");
    assert.ok(result.browsePath.includes("/workspace/vendor"), "expected /workspace/vendor in browsePath");
  });

  test("returns compilerPath from browse snapshot", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const entry = makeEntry("/workspace/main.c", { compilerPath: "arm-none-eabi-gcc" });
    backend.applyPayload(makePayload([entry]));
    const result = await backend.provideBrowseConfiguration();
    assert.strictEqual(result.compilerPath, "arm-none-eabi-gcc");
  });

  test("returns empty browsePath after clearPayload", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    backend.applyPayload(makePayload([makeEntry("/workspace/main.c")]));
    backend.clearPayload();
    const result = await backend.provideBrowseConfiguration();
    assert.deepStrictEqual(result.browsePath, []);
  });
});

// ---------------------------------------------------------------------------
// canProvideBrowseConfigurationsPerFolder
// ---------------------------------------------------------------------------

suite("CpptoolsBackend – canProvideBrowseConfigurationsPerFolder", () => {
  test("always returns false", async () => {
    const backend = new CpptoolsBackend(() => undefined);
    const result = await backend.canProvideBrowseConfigurationsPerFolder();
    assert.strictEqual(result, false);
  });
});

// ---------------------------------------------------------------------------
// PROVIDER_SETTING_FIX
// ---------------------------------------------------------------------------

suite("PROVIDER_SETTING_FIX", () => {
  test("section is C_Cpp", () => {
    assert.strictEqual(PROVIDER_SETTING_FIX.section, "C_Cpp");
  });

  test("key is default.configurationProvider", () => {
    assert.strictEqual(PROVIDER_SETTING_FIX.key, "default.configurationProvider");
  });

  test("correctValue is cepetr.tbench", () => {
    assert.strictEqual(PROVIDER_SETTING_FIX.correctValue, "cepetr.tbench");
  });
});
