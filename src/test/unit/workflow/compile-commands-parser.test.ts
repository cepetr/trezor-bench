/**
 * Unit tests for compile-commands-parser.ts
 *
 * Covers:
 *  - parseCompileCommandsFile: returns undefined for missing / malformed input
 *  - parseCompileCommandsFile: parses a real fixture file correctly
 *  - parseCompileCommandsFile: first-entry-wins deduplication
 *  - parseEntry: relative path normalization against entry `directory`
 *  - parseEntry: -I flag extraction (attached and space-separated)
 *  - parseEntry: -D flag extraction
 *  - parseEntry: -include forced-include extraction
 *  - parseEntry: -std= standard extraction and preservation in remainingArgs
 *  - parseEntry: source file token is NOT included in remainingArgs
 *  - inferLanguageFamily: C++ via -std=c++
 *  - inferLanguageFamily: C++ via file extension
 *  - inferLanguageFamily: C++ via compiler name (g++ / clang++)
 *  - inferLanguageFamily: C via -std=c11
 *  - inferLanguageFamily: C via file extension (.c)
 *  - inferLanguageFamily: default C
 *  - buildBrowseSnapshot: de-duplicated union of source directories and include paths
 *  - buildBrowseSnapshot: compiler path from first entry
 *  - tokenizeCommandString: splits on whitespace
 *  - tokenizeCommandString: respects single quotes
 *  - tokenizeCommandString: respects double quotes with backslash escape
 */

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  parseCompileCommandsFile,
  parseEntry,
  inferLanguageFamily,
  buildBrowseSnapshot,
  tokenizeCommandString,
} from "../../../intellisense/compile-commands-parser";
import {
  primaryCoreFixturePath,
  emuCoreFixturePath,
  loadCompileCommandsFixture,
} from "../workflow-test-helpers";

// ---------------------------------------------------------------------------
// parseCompileCommandsFile – error cases
// ---------------------------------------------------------------------------

suite("parseCompileCommandsFile – error cases", () => {
  test("returns undefined for a non-existent file", () => {
    const result = parseCompileCommandsFile(
      "/nonexistent/compile_commands.cc.json",
      "T2T1::hw::core"
    );
    assert.strictEqual(result, undefined);
  });

  test("returns undefined when file contains a JSON object instead of array", () => {
    const tmp = os.tmpdir();
    const p = path.join(tmp, "not-array.cc.json");
    fs.writeFileSync(p, JSON.stringify({ entries: [] }));
    const result = parseCompileCommandsFile(p, "ctx");
    assert.strictEqual(result, undefined);
  });

  test("returns undefined when file contains invalid JSON", () => {
    const tmp = os.tmpdir();
    const p = path.join(tmp, "invalid.cc.json");
    fs.writeFileSync(p, "not-json!!!");
    const result = parseCompileCommandsFile(p, "ctx");
    assert.strictEqual(result, undefined);
  });

  test("returns a payload even for an empty JSON array", () => {
    const tmp = os.tmpdir();
    const p = path.join(tmp, "empty.cc.json");
    fs.writeFileSync(p, "[]");
    const result = parseCompileCommandsFile(p, "ctx");
    assert.ok(result !== undefined, "expected payload for empty array");
    assert.strictEqual(result.entriesByFile.size, 0);
  });
});

// ---------------------------------------------------------------------------
// parseCompileCommandsFile – real fixture
// ---------------------------------------------------------------------------

suite("parseCompileCommandsFile – primary core fixture (model-t)", () => {
  let fixturePath: string;

  suiteSetup(() => {
    fixturePath = primaryCoreFixturePath();
  });

  test("returns a defined payload", () => {
    const result = parseCompileCommandsFile(fixturePath, "T2T1::hw::core");
    assert.ok(result !== undefined);
  });

  test("contextKey is preserved in the payload", () => {
    const result = parseCompileCommandsFile(fixturePath, "T2T1::hw::core");
    assert.strictEqual(result?.contextKey, "T2T1::hw::core");
  });

  test("artifactPath is preserved in the payload", () => {
    const result = parseCompileCommandsFile(fixturePath, "T2T1::hw::core");
    assert.strictEqual(result?.artifactPath, fixturePath);
  });

  test("fixture has 6 raw entries but only 5 unique files (first-entry-wins for embed/main.c)", () => {
    const raw = loadCompileCommandsFixture(fixturePath);
    assert.strictEqual(raw.length, 6, "fixture must have 6 raw entries");

    const result = parseCompileCommandsFile(fixturePath, "ctx");
    assert.strictEqual(result?.entriesByFile.size, 5, "expected 5 unique entries");
  });

  test("first occurrence of embed/main.c is indexed (not the duplicate)", () => {
    const result = parseCompileCommandsFile(fixturePath, "ctx");
    const mainEntry = result?.entriesByFile.get("/workspace/core/embed/main.c");
    assert.ok(mainEntry !== undefined, "expected main.c entry to exist");
    // First entry has TREZOR_MODEL_T and CONFIDENTIAL= but NOT DUPLICATE_ENTRY
    assert.ok(
      mainEntry.defines.includes("CONFIDENTIAL="),
      "expected first-entry-wins: CONFIDENTIAL= define should be present"
    );
    assert.ok(
      !mainEntry.defines.includes("DUPLICATE_ENTRY"),
      "expected first-entry-wins: DUPLICATE_ENTRY define should NOT be present"
    );
  });

  test("relative source file paths are normalized to absolute", () => {
    const result = parseCompileCommandsFile(fixturePath, "ctx");
    // All keys should be absolute paths
    for (const key of result!.entriesByFile.keys()) {
      assert.ok(path.isAbsolute(key), `key '${key}' should be absolute`);
    }
  });

  test("include paths are absolute", () => {
    const result = parseCompileCommandsFile(fixturePath, "ctx");
    const mainEntry = result?.entriesByFile.get("/workspace/core/embed/main.c");
    assert.ok(mainEntry !== undefined);
    for (const ip of mainEntry.includePaths) {
      assert.ok(path.isAbsolute(ip), `include path '${ip}' should be absolute`);
    }
  });

  test("embed/main.c has -std=c11 standard", () => {
    const result = parseCompileCommandsFile(fixturePath, "ctx");
    const mainEntry = result?.entriesByFile.get("/workspace/core/embed/main.c");
    assert.strictEqual(mainEntry?.standard, "c11");
  });

  test("sha256.cpp entry has c++ language family", () => {
    const result = parseCompileCommandsFile(fixturePath, "ctx");
    const cppEntry = result?.entriesByFile.get("/workspace/core/embed/crypto/sha256.cpp");
    assert.strictEqual(cppEntry?.languageFamily, "cpp");
  });

  test("embed/main.c entry has c language family", () => {
    const result = parseCompileCommandsFile(fixturePath, "ctx");
    const mainEntry = result?.entriesByFile.get("/workspace/core/embed/main.c");
    assert.strictEqual(mainEntry?.languageFamily, "c");
  });
});

// ---------------------------------------------------------------------------
// parseCompileCommandsFile – emulator fixture (with _emu suffix)
// ---------------------------------------------------------------------------

suite("parseCompileCommandsFile – emu core fixture (model-t, _emu suffix)", () => {
  test("returns 3 unique entries from emu fixture", () => {
    const fixturePath = emuCoreFixturePath();
    const result = parseCompileCommandsFile(fixturePath, "T2T1::emu::core");
    assert.strictEqual(result?.entriesByFile.size, 3);
  });

  test("emu entries have EMULATOR=1 define", () => {
    const fixturePath = emuCoreFixturePath();
    const result = parseCompileCommandsFile(fixturePath, "T2T1::emu::core");
    const mainEntry = result?.entriesByFile.get("/workspace/core/embed/main.c");
    assert.ok(mainEntry !== undefined);
    assert.ok(mainEntry.defines.includes("EMULATOR=1"), "expected EMULATOR=1 define");
  });
});

// ---------------------------------------------------------------------------
// parseEntry – flag extraction
// ---------------------------------------------------------------------------

suite("parseEntry – flag extraction", () => {
  function makeRawEntry(command: string, file: string = "src/foo.c", directory: string = "/workspace") {
    return { directory, command, file };
  }

  test("extracts -I attached flag", () => {
    const entry = makeRawEntry("gcc -Iinclude/headers -c src/foo.c");
    const parsed = parseEntry(entry, 0);
    assert.ok(parsed !== undefined);
    assert.ok(
      parsed.includePaths.some(p => p.endsWith("include/headers")),
      `expected include/headers in includePaths, got: ${parsed.includePaths}`
    );
  });

  test("extracts -I space-separated flag", () => {
    const entry = makeRawEntry("gcc -I include/headers -c src/foo.c");
    const parsed = parseEntry(entry, 0);
    assert.ok(parsed !== undefined);
    assert.ok(
      parsed.includePaths.some(p => p.endsWith("include/headers")),
      `expected include/headers in includePaths, got: ${parsed.includePaths}`
    );
  });

  test("extracts -D attached define", () => {
    const entry = makeRawEntry("gcc -DFOO=1 -DBAR -c src/foo.c");
    const parsed = parseEntry(entry, 0);
    assert.ok(parsed !== undefined);
    assert.ok(parsed.defines.includes("FOO=1"), "expected FOO=1 in defines");
    assert.ok(parsed.defines.includes("BAR"), "expected BAR in defines");
  });

  test("extracts -D space-separated define", () => {
    const entry = makeRawEntry("gcc -D FOO=1 -c src/foo.c");
    const parsed = parseEntry(entry, 0);
    assert.ok(parsed !== undefined);
    assert.ok(parsed.defines.includes("FOO=1"), "expected FOO=1 in defines");
  });

  test("extracts -include forced include", () => {
    const entry = makeRawEntry("gcc -include config/product.h -c src/foo.c");
    const parsed = parseEntry(entry, 0);
    assert.ok(parsed !== undefined);
    assert.ok(
      parsed.forcedIncludes.some(fi => fi.endsWith("config/product.h")),
      `expected config/product.h in forcedIncludes, got: ${parsed.forcedIncludes}`
    );
  });

  test("source file token is not included in remainingArgs", () => {
    const entry = makeRawEntry("gcc -std=c11 -Wall -c src/foo.c");
    const parsed = parseEntry(entry, 0);
    assert.ok(parsed !== undefined);
    assert.ok(
      !parsed.arguments.includes("src/foo.c"),
      "source file should not appear in remainingArgs"
    );
    assert.ok(
      !parsed.arguments.includes("/workspace/src/foo.c"),
      "absolute source file should not appear in remainingArgs"
    );
  });

  test("-std= flag is preserved in remainingArgs", () => {
    const entry = makeRawEntry("gcc -std=gnu11 -c src/foo.c");
    const parsed = parseEntry(entry, 0);
    assert.ok(parsed !== undefined);
    assert.ok(parsed.arguments.includes("-std=gnu11"), "expected -std=gnu11 in remainingArgs");
  });

  test("rawIndex is recorded correctly", () => {
    const entry = makeRawEntry("gcc -c src/foo.c");
    const parsed = parseEntry(entry, 7);
    assert.strictEqual(parsed?.rawIndex, 7);
  });

  test("compilerPath is the first token", () => {
    const entry = makeRawEntry("arm-none-eabi-gcc -c src/foo.c");
    const parsed = parseEntry(entry, 0);
    assert.strictEqual(parsed?.compilerPath, "arm-none-eabi-gcc");
  });

  test("returns undefined for entry with empty command", () => {
    const entry = { directory: "/workspace", command: "", file: "src/foo.c" };
    const parsed = parseEntry(entry, 0);
    assert.strictEqual(parsed, undefined);
  });

  test("directory is resolved to absolute path", () => {
    const entry = { directory: "/workspace", command: "gcc -c src/foo.c", file: "src/foo.c" };
    const parsed = parseEntry(entry, 0);
    assert.strictEqual(parsed?.directory, "/workspace");
  });
});

// ---------------------------------------------------------------------------
// inferLanguageFamily
// ---------------------------------------------------------------------------

suite("inferLanguageFamily", () => {
  test("returns cpp when -std=c++17", () => {
    assert.strictEqual(inferLanguageFamily("c++17", "/src/foo.c", "gcc"), "cpp");
  });

  test("returns cpp when -std=gnu++14", () => {
    assert.strictEqual(inferLanguageFamily("gnu++14", "/src/foo.c", "gcc"), "cpp");
  });

  test("returns c when -std=c11", () => {
    assert.strictEqual(inferLanguageFamily("c11", "/src/foo.cpp", "g++"), "c");
  });

  test("returns c when -std=gnu11", () => {
    assert.strictEqual(inferLanguageFamily("gnu11", "/src/foo.cpp", "g++"), "c");
  });

  test("returns cpp for .cpp extension (no std)", () => {
    assert.strictEqual(inferLanguageFamily(undefined, "/src/foo.cpp", "gcc"), "cpp");
  });

  test("returns cpp for .cxx extension (no std)", () => {
    assert.strictEqual(inferLanguageFamily(undefined, "/src/foo.cxx", "gcc"), "cpp");
  });

  test("returns cpp for .cc extension (no std)", () => {
    assert.strictEqual(inferLanguageFamily(undefined, "/src/foo.cc", "gcc"), "cpp");
  });

  test("returns cpp for uppercase .C extension (no std)", () => {
    assert.strictEqual(inferLanguageFamily(undefined, "/src/foo.C", "gcc"), "cpp");
  });

  test("returns c for .c extension (no std)", () => {
    assert.strictEqual(inferLanguageFamily(undefined, "/src/foo.c", "gcc"), "c");
  });

  test("returns cpp when compiler is g++ (no std, no cpp extension)", () => {
    assert.strictEqual(inferLanguageFamily(undefined, "/src/foo.c", "g++"), "cpp");
  });

  test("returns cpp when compiler is arm-none-eabi-g++", () => {
    assert.strictEqual(inferLanguageFamily(undefined, "/src/foo.c", "arm-none-eabi-g++"), "cpp");
  });

  test("returns cpp when compiler is clang++", () => {
    assert.strictEqual(inferLanguageFamily(undefined, "/src/foo.c", "clang++"), "cpp");
  });

  test("returns c as default when no std, .c extension, gcc compiler", () => {
    assert.strictEqual(inferLanguageFamily(undefined, "/src/main.c", "arm-none-eabi-gcc"), "c");
  });
});

// ---------------------------------------------------------------------------
// buildBrowseSnapshot
// ---------------------------------------------------------------------------

suite("buildBrowseSnapshot", () => {
  function makeEntry(
    filePath: string,
    includePaths: string[],
    compilerPath: string,
    remainingArgs: string[] = []
  ) {
    return {
      filePath,
      directory: "/workspace",
      compilerPath,
      arguments: remainingArgs,
      includePaths,
      defines: [],
      forcedIncludes: [],
      languageFamily: "c" as const,
      standard: "c11",
      rawIndex: 0,
    };
  }

  test("returns empty browsePaths for empty entries list", () => {
    const snap = buildBrowseSnapshot([]);
    assert.deepStrictEqual(snap.browsePaths, []);
  });

  test("compilerPath is undefined for empty entries list", () => {
    const snap = buildBrowseSnapshot([]);
    assert.strictEqual(snap.compilerPath, undefined);
  });

  test("browsePaths includes source directories and include paths from all entries", () => {
    const entries = [
      makeEntry("/workspace/a.c", ["/workspace/include", "/workspace/vendor"], "gcc"),
      makeEntry("/workspace/src/b.c", ["/workspace/include", "/workspace/common"], "gcc"),
    ];
    const snap = buildBrowseSnapshot(entries);
    assert.deepStrictEqual(snap.browsePaths, [
      "/workspace",
      "/workspace/include",
      "/workspace/vendor",
      "/workspace/src",
      "/workspace/common",
    ]);
  });

  test("compilerPath comes from the first entry", () => {
    const entries = [
      makeEntry("/workspace/a.c", [], "arm-none-eabi-gcc"),
      makeEntry("/workspace/b.c", [], "g++"),
    ];
    const snap = buildBrowseSnapshot(entries);
    assert.strictEqual(snap.compilerPath, "arm-none-eabi-gcc");
  });

  test("browse paths are de-duplicated (first-seen order)", () => {
    const entries = [
      makeEntry("/workspace/a.c", ["/workspace/include"], "gcc"),
      makeEntry("/workspace/b.c", ["/workspace/include", "/workspace/extra"], "gcc"),
    ];
    const snap = buildBrowseSnapshot(entries);
    assert.strictEqual(snap.browsePaths.length, 3);
    assert.ok(snap.browsePaths.includes("/workspace"));
    assert.ok(snap.browsePaths.includes("/workspace/include"));
    assert.ok(snap.browsePaths.includes("/workspace/extra"));
  });

  test("source directories are de-duplicated before include paths", () => {
    const entries = [
      makeEntry("/workspace/core/main.c", ["/workspace/include"], "gcc"),
      makeEntry("/workspace/core/embed/foo.c", ["/workspace/include"], "gcc"),
      makeEntry("/workspace/core/embed/bar.c", ["/workspace/vendor"], "gcc"),
    ];
    const snap = buildBrowseSnapshot(entries);
    assert.deepStrictEqual(snap.browsePaths, [
      "/workspace/core",
      "/workspace/include",
      "/workspace/core/embed",
      "/workspace/vendor",
    ]);
  });

  test("compilerArgs comes from the first entry", () => {
    const entries = [
      makeEntry("/workspace/a.c", [], "gcc", ["-Wall", "-O2"]),
      makeEntry("/workspace/b.c", [], "gcc", ["-Wextra"]),
    ];
    const snap = buildBrowseSnapshot(entries);
    assert.deepStrictEqual(snap.compilerArgs, ["-Wall", "-O2"]);
  });
});

// ---------------------------------------------------------------------------
// tokenizeCommandString
// ---------------------------------------------------------------------------

suite("tokenizeCommandString", () => {
  test("splits on whitespace", () => {
    const tokens = tokenizeCommandString("gcc -Iinclude -c foo.c");
    assert.deepStrictEqual(tokens, ["gcc", "-Iinclude", "-c", "foo.c"]);
  });

  test("handles multiple consecutive spaces", () => {
    const tokens = tokenizeCommandString("gcc  -c   foo.c");
    assert.deepStrictEqual(tokens, ["gcc", "-c", "foo.c"]);
  });

  test("handles single-quoted path with spaces", () => {
    const tokens = tokenizeCommandString("gcc -I'path with spaces' -c foo.c");
    assert.deepStrictEqual(tokens, ["gcc", "-Ipath with spaces", "-c", "foo.c"]);
  });

  test("handles double-quoted path with spaces", () => {
    const tokens = tokenizeCommandString('gcc -I"path with spaces" -c foo.c');
    assert.deepStrictEqual(tokens, ["gcc", "-Ipath with spaces", "-c", "foo.c"]);
  });

  test("handles backslash escape in double-quoted string", () => {
    const tokens = tokenizeCommandString('gcc -I"path\\"with\\"quotes" -c foo.c');
    assert.deepStrictEqual(tokens, ['gcc', '-Ipath"with"quotes', '-c', 'foo.c']);
  });

  test("returns empty array for empty string", () => {
    const tokens = tokenizeCommandString("");
    assert.deepStrictEqual(tokens, []);
  });

  test("returns empty array for whitespace-only string", () => {
    const tokens = tokenizeCommandString("   ");
    assert.deepStrictEqual(tokens, []);
  });

  test("single token with no whitespace", () => {
    const tokens = tokenizeCommandString("gcc");
    assert.deepStrictEqual(tokens, ["gcc"]);
  });
});

// ---------------------------------------------------------------------------
// Regression: mixed-language compile database
// ---------------------------------------------------------------------------

suite("parseCompileCommandsFile – mixed-language regression", () => {
  function writeTmpDb(entries: object[]): string {
    const tmpPath = path.join(os.tmpdir(), `mixed-lang-${Date.now()}.cc.json`);
    fs.writeFileSync(tmpPath, JSON.stringify(entries), "utf-8");
    return tmpPath;
  }

  test("C file gets 'c' language family in mixed database", () => {
    const db = [
      { directory: "/ws", file: "/ws/main.c", command: "arm-none-eabi-gcc -DBOARD=1 -c /ws/main.c" },
      { directory: "/ws", file: "/ws/crypto.cpp", command: "arm-none-eabi-g++ -std=c++17 -c /ws/crypto.cpp" },
    ];
    const dbPath = writeTmpDb(db);
    const result = parseCompileCommandsFile(dbPath, "T2T1::hw::core");
    const cEntry = result?.entriesByFile.get("/ws/main.c");
    assert.strictEqual(cEntry?.languageFamily, "c");
  });

  test("C++ file gets 'cpp' language family in mixed database", () => {
    const db = [
      { directory: "/ws", file: "/ws/main.c", command: "arm-none-eabi-gcc -DBOARD=1 -c /ws/main.c" },
      { directory: "/ws", file: "/ws/crypto.cpp", command: "arm-none-eabi-g++ -std=c++17 -c /ws/crypto.cpp" },
    ];
    const dbPath = writeTmpDb(db);
    const result = parseCompileCommandsFile(dbPath, "T2T1::hw::core");
    const cppEntry = result?.entriesByFile.get("/ws/crypto.cpp");
    assert.strictEqual(cppEntry?.languageFamily, "cpp");
  });

  test("both C and C++ entries are present and have independent defines", () => {
    const db = [
      { directory: "/ws", file: "/ws/main.c", command: "gcc -DPLATFORM=HW -c /ws/main.c" },
      { directory: "/ws", file: "/ws/utils.cpp", command: "g++ -DCXX_FEATURE=1 -c /ws/utils.cpp" },
    ];
    const dbPath = writeTmpDb(db);
    const result = parseCompileCommandsFile(dbPath, "ctx");
    assert.strictEqual(result?.entriesByFile.size, 2);
    const cEntry = result?.entriesByFile.get("/ws/main.c");
    const cppEntry = result?.entriesByFile.get("/ws/utils.cpp");
    assert.ok(cEntry?.defines.includes("PLATFORM=HW"), "C entry should have PLATFORM=HW");
    assert.ok(cppEntry?.defines.includes("CXX_FEATURE=1"), "C++ entry should have CXX_FEATURE=1");
    assert.ok(!cEntry?.defines.includes("CXX_FEATURE=1"), "C entry must not have C++ defines");
  });

  test("C entry with explicit -std=c11 in mixed database keeps c language family", () => {
    const db = [
      { directory: "/ws", file: "/ws/compat.cpp", command: "g++ -std=c11 -c /ws/compat.cpp" },
    ];
    const dbPath = writeTmpDb(db);
    const result = parseCompileCommandsFile(dbPath, "ctx");
    // -std takes priority over extension
    const entry = result?.entriesByFile.get("/ws/compat.cpp");
    assert.strictEqual(entry?.languageFamily, "c", "-std=c11 should win over .cpp extension");
  });

  test("real primary core fixture for hw target has files with differing language families", () => {
    const fixturePath = primaryCoreFixturePath();
    const result = parseCompileCommandsFile(fixturePath, "T2T1::hw::core");
    const cEntry = result?.entriesByFile.get("/workspace/core/embed/main.c");
    const cppEntry = result?.entriesByFile.get("/workspace/core/embed/crypto/sha256.cpp");
    assert.strictEqual(cEntry?.languageFamily, "c");
    assert.strictEqual(cppEntry?.languageFamily, "cpp");
  });

  test("emu fixture context key encodes _emu target suffix semantics", () => {
    const fixturePath = emuCoreFixturePath();
    const result = parseCompileCommandsFile(fixturePath, "T2T1::emu::core");
    assert.strictEqual(result?.contextKey, "T2T1::emu::core");
    // Emu fixture adds EMULATOR=1
    const mainEntry = result?.entriesByFile.get("/workspace/core/embed/main.c");
    assert.ok(mainEntry?.defines.includes("EMULATOR=1"), "emu entries should have EMULATOR=1");
  });
});
