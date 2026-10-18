/**
 * Unit tests for excluded-file refresh requests, payload-loss clearing,
 * and latest-state snapshot updates.
 *
 * Tests the ExcludedFilesService refresh cycle for keeping excluded markers
 * in sync with context changes.
 *
 * Covers:
 *  - Payload-loss clearing: recompute() with null artifactPath emits empty snapshot
 *  - Payload-loss clearing: clear() emits empty snapshot and clears includedFiles
 *  - Latest-state updates: second recompute() replaces first snapshot
 *  - Context-key change: snapshot updates contextKey on each recompute
 *  - Settings-change refresh: recompute() with new settings produces updated snapshot
 *  - Stale-state avoidance: clear() is idempotent (can be called multiple times)
 *  - onDidUpdateSnapshot fires for each recompute and clear call
 */

import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  ExcludedFilesService,
  ExcludedFilesSnapshot,
  normalizeToForwardSlashes,
} from "../../../intellisense/excluded-files-service";
import { gatherExcludedFileCandidates } from "../../../intellisense/excluded-files-refresh";
import {
  excludedFilesScopeWorkspaceRoot,
  makeExcludedFilesSettings,
} from "../workflow-test-helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_ROOT = normalizeToForwardSlashes(excludedFilesScopeWorkspaceRoot());

function absPath(...parts: string[]): string {
  return normalizeToForwardSlashes(path.join(excludedFilesScopeWorkspaceRoot(), ...parts));
}

function makeUri(relPath: string): vscode.Uri {
  return vscode.Uri.file(path.join(excludedFilesScopeWorkspaceRoot(), relPath));
}

const DEFAULT_SETTINGS = makeExcludedFilesSettings({
  fileNamePatterns: ["*.c"],
  folderGlobs: ["core/embed/**", "core/vendor/**"],
});

const INCLUDED_FILES = new Set([
  absPath("core/embed/main.c"),
  absPath("core/embed/util.c"),
]);

const CANDIDATE_URIS = [
  makeUri("core/embed/main.c"),
  makeUri("core/embed/util.c"),
  makeUri("core/embed/other.c"),
  makeUri("core/vendor/lib.c"),
  makeUri("docs/readme.c"),
];

// ---------------------------------------------------------------------------
// Suite: payload-loss clearing — recompute() with null artifactPath
// ---------------------------------------------------------------------------

suite("ExcludedFilesService — payload-loss clearing (null artifactPath)", () => {
  test("emits empty excludedFiles when artifactPath is null", () => {
    const svc = new ExcludedFilesService();
    let snap: ExcludedFilesSnapshot | undefined;
    svc.onDidUpdateSnapshot((s) => { snap = s; });

    svc.recompute(
      "T2T1/hw/core", null, INCLUDED_FILES, DEFAULT_SETTINGS, WORKSPACE_ROOT, CANDIDATE_URIS
    );

    assert.ok(snap);
    assert.strictEqual(snap!.excludedFiles.size, 0, "null artifact ⇒ no excluded files");
    svc.dispose();
  });

  test("fires onDidUpdateSnapshot even when artifact is null (so markers are cleared)", () => {
    const svc = new ExcludedFilesService();
    let fireCount = 0;
    svc.onDidUpdateSnapshot(() => { fireCount++; });

    svc.recompute(
      "T2T1/hw/core", null, new Set(), DEFAULT_SETTINGS, WORKSPACE_ROOT, []
    );

    assert.strictEqual(fireCount, 1, "event must fire even for null artifact refresh");
    svc.dispose();
  });
});

// ---------------------------------------------------------------------------
// Suite: payload-loss clearing — clear() method
// ---------------------------------------------------------------------------

suite("ExcludedFilesService — payload-loss clearing (clear())", () => {
  test("clear() empties excludedFiles and sets artifactPath to null", () => {
    const svc = new ExcludedFilesService();

    // Populate a non-empty snapshot first
    svc.recompute("T2T1/hw/core", "/some/artifact.json", new Set(), DEFAULT_SETTINGS, WORKSPACE_ROOT, CANDIDATE_URIS);

    const snapsBefore = svc.getSnapshot();
    assert.ok(snapsBefore.excludedFiles.size >= 0); // just check it ran

    let cleared: ExcludedFilesSnapshot | undefined;
    svc.onDidUpdateSnapshot((s) => { cleared = s; });
    svc.clear("T2T1/hw/core");

    assert.ok(cleared, "onDidUpdateSnapshot must fire after clear()");
    assert.strictEqual(cleared!.artifactPath, null);
    assert.strictEqual(cleared!.excludedFiles.size, 0);
    assert.strictEqual(cleared!.includedFiles.size, 0);
    svc.dispose();
  });

  test("clear() is idempotent — calling it twice does not throw", () => {
    const svc = new ExcludedFilesService();
    svc.clear("T2T1/hw/core");
    assert.doesNotThrow(() => svc.clear("T2T1/hw/core"));
    svc.dispose();
  });

  test("clear() updates the contextKey", () => {
    const svc = new ExcludedFilesService();
    let snap: ExcludedFilesSnapshot | undefined;
    svc.onDidUpdateSnapshot((s) => { snap = s; });

    svc.clear("T3W1/emu/prodtest");

    assert.ok(snap);
    assert.strictEqual(snap!.contextKey, "T3W1/emu/prodtest");
    svc.dispose();
  });
});

// ---------------------------------------------------------------------------
// Suite: latest-state updates — second recompute replaces first
// ---------------------------------------------------------------------------

suite("ExcludedFilesService — latest-state snapshot updates", () => {
  test("second recompute() replaces the first snapshot", () => {
    const svc = new ExcludedFilesService();
    const snapshots: ExcludedFilesSnapshot[] = [];
    svc.onDidUpdateSnapshot((s) => snapshots.push(s));

    // First refresh: empty candidate list
    svc.recompute("T2T1/hw/core", "/path/v1.json", new Set(), DEFAULT_SETTINGS, WORKSPACE_ROOT, []);
    // Second refresh: with candidates
    svc.recompute("T2T1/hw/core", "/path/v2.json", INCLUDED_FILES, DEFAULT_SETTINGS, WORKSPACE_ROOT, CANDIDATE_URIS);

    assert.strictEqual(snapshots.length, 2, "two events must fire for two recompute calls");
    assert.strictEqual(snapshots[0].artifactPath, "/path/v1.json");
    assert.strictEqual(snapshots[1].artifactPath, "/path/v2.json");

    // getSnapshot() returns the latest
    const latest = svc.getSnapshot();
    assert.strictEqual(latest.artifactPath, "/path/v2.json");
    svc.dispose();
  });

  test("context-key change is reflected in subsequent snapshot", () => {
    const svc = new ExcludedFilesService();
    const snapshots: ExcludedFilesSnapshot[] = [];
    svc.onDidUpdateSnapshot((s) => snapshots.push(s));

    svc.recompute("T2T1/hw/core",  "/path/a.json", INCLUDED_FILES, DEFAULT_SETTINGS, WORKSPACE_ROOT, CANDIDATE_URIS);
    svc.recompute("T3W1/emu/core", "/path/b.json", INCLUDED_FILES, DEFAULT_SETTINGS, WORKSPACE_ROOT, CANDIDATE_URIS);

    assert.strictEqual(snapshots[0].contextKey, "T2T1/hw/core");
    assert.strictEqual(snapshots[1].contextKey, "T3W1/emu/core");
    svc.dispose();
  });

  test("settings-change refresh produces updated snapshot with new scope", () => {
    const svc = new ExcludedFilesService();
    const snapshots: ExcludedFilesSnapshot[] = [];
    svc.onDidUpdateSnapshot((s) => snapshots.push(s));

    // First refresh: grayInTree=true
    const settings1 = makeExcludedFilesSettings({ grayInTree: true });
    svc.recompute("T2T1/hw/core", "/path/a.json", INCLUDED_FILES, settings1, WORKSPACE_ROOT, CANDIDATE_URIS);

    // Second refresh: grayInTree=false (settings changed)
    const settings2 = makeExcludedFilesSettings({ grayInTree: false });
    svc.recompute("T2T1/hw/core", "/path/a.json", INCLUDED_FILES, settings2, WORKSPACE_ROOT, CANDIDATE_URIS);

    assert.strictEqual(snapshots.length, 2);
    assert.strictEqual(snapshots[0].settings.grayInTree, true);
    assert.strictEqual(snapshots[1].settings.grayInTree, false);
    svc.dispose();
  });

  test("clear() after populated state produces empty snapshot", () => {
    const svc = new ExcludedFilesService();

    // Populate: other.c and lib.c should be excluded
    svc.recompute("T2T1/hw/core", "/path/a.json", INCLUDED_FILES, DEFAULT_SETTINGS, WORKSPACE_ROOT, CANDIDATE_URIS);
    const populated = svc.getSnapshot();
    assert.ok(populated.excludedFiles.size > 0, "precondition: should have excluded files");

    // Now clear and verify the snapshot is empty
    let afterClear: ExcludedFilesSnapshot | undefined;
    svc.onDidUpdateSnapshot((s) => { afterClear = s; });
    svc.clear("T2T1/hw/core");

    assert.ok(afterClear, "onDidUpdateSnapshot must fire after clear()");
    assert.strictEqual(afterClear!.excludedFiles.size, 0, "excludedFiles must be empty after clear");
    assert.strictEqual(afterClear!.artifactPath, null, "artifactPath must be null after clear");
    svc.dispose();
  });

  test("recompute() after clear() restores excluded markers", () => {
    const svc = new ExcludedFilesService();

    // Populate, then clear
    svc.recompute("T2T1/hw/core", "/path/a.json", INCLUDED_FILES, DEFAULT_SETTINGS, WORKSPACE_ROOT, CANDIDATE_URIS);
    svc.clear("T2T1/hw/core");
    assert.strictEqual(svc.getSnapshot().excludedFiles.size, 0, "precondition: cleared");

    // Recompute again with same data
    let restored: ExcludedFilesSnapshot | undefined;
    svc.onDidUpdateSnapshot((s) => { restored = s; });
    svc.recompute("T2T1/hw/core", "/path/a.json", INCLUDED_FILES, DEFAULT_SETTINGS, WORKSPACE_ROOT, CANDIDATE_URIS);

    assert.ok(restored);
    assert.ok(restored!.excludedFiles.size > 0, "excluded markers must be restored after recompute following clear");
    svc.dispose();
  });
});

// ---------------------------------------------------------------------------
// Suite: onDidUpdateSnapshot fires for every state change
// ---------------------------------------------------------------------------

suite("ExcludedFilesService — event emission discipline", () => {
  test("onDidUpdateSnapshot fires once per recompute() call", () => {
    const svc = new ExcludedFilesService();
    let count = 0;
    svc.onDidUpdateSnapshot(() => { count++; });

    svc.recompute("T2T1/hw/core", "/a.json", INCLUDED_FILES, DEFAULT_SETTINGS, WORKSPACE_ROOT, CANDIDATE_URIS);
    svc.recompute("T2T1/hw/core", "/b.json", INCLUDED_FILES, DEFAULT_SETTINGS, WORKSPACE_ROOT, CANDIDATE_URIS);
    svc.recompute("T2T1/hw/core", "/c.json", INCLUDED_FILES, DEFAULT_SETTINGS, WORKSPACE_ROOT, []);

    assert.strictEqual(count, 3, "three recompute calls must produce three events");
    svc.dispose();
  });

  test("onDidUpdateSnapshot fires once per clear() call", () => {
    const svc = new ExcludedFilesService();
    let count = 0;
    svc.onDidUpdateSnapshot(() => { count++; });

    svc.clear("T2T1/hw/core");
    svc.clear("T2T1/hw/core");

    assert.strictEqual(count, 2, "two clear calls must produce two events");
    svc.dispose();
  });
});

// ---------------------------------------------------------------------------
// Suite: candidate gathering is bound to the selected folder
// ---------------------------------------------------------------------------

suite("gatherExcludedFileCandidates — multi-root windows", () => {
  const workspaceMock = vscode.workspace as unknown as {
    findFiles?: (pattern: { base: unknown; pattern: string }) => Promise<vscode.Uri[]>;
  };
  let originalFindFiles: typeof workspaceMock.findFiles;

  setup(() => {
    originalFindFiles = workspaceMock.findFiles;
  });

  teardown(() => {
    workspaceMock.findFiles = originalFindFiles;
  });

  test("searches only under the selected folder and never marks files of another folder", async () => {
    const selected = {
      uri: vscode.Uri.file("/ws/trezor-firmware"),
      name: "trezor-firmware",
      index: 1,
    } as vscode.WorkspaceFolder;
    const otherRoot = "/ws/notes";
    const bases: unknown[] = [];

    // Behaves like a multi-root findFiles: results depend on the pattern base.
    workspaceMock.findFiles = async (pattern) => {
      bases.push(pattern.base);
      const base = pattern.base as vscode.WorkspaceFolder;
      return base.uri.fsPath === otherRoot
        ? [vscode.Uri.file(`${otherRoot}/core/embed/main.c`)]
        : [vscode.Uri.file(`${base.uri.fsPath}/core/embed/main.c`)];
    };

    const found = await gatherExcludedFileCandidates(
      makeExcludedFilesSettings({ fileNamePatterns: ["*.c"], folderGlobs: ["core/embed/**"] }),
      selected
    );

    assert.deepStrictEqual(bases, [selected]);
    assert.deepStrictEqual(
      found.map((uri) => uri.fsPath),
      ["/ws/trezor-firmware/core/embed/main.c"]
    );
  });
});
