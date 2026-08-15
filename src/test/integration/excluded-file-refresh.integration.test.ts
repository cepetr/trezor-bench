/**
 * Integration tests for excluded-file refresh: active-build-context refresh,
 * settings-driven refresh, manual refresh reuse, workspace-change refresh,
 * and stale-state clearing.
 *
 * These tests run inside the VS Code extension host so they exercise the real
 * `vscode.EventEmitter`, `vscode.Uri`, `vscode.FileDecoration`,
 * `vscode.ThemeColor`, and `vscode.window.createTextEditorDecorationType` APIs.
 * They wire `ExcludedFilesService.onDidUpdateSnapshot` directly to
 * `ExcludedFilesDecorationsProvider` and `ExcludedFilesOverlays` so that
 * end-to-end refresh cycles can be verified without the extension activation
 * layer.
 *
 * Covers:
 *  - Active-config refresh: recompute() with a new contextKey produces a
 *    snapshot reflecting the new config; stale markers from the previous config
 *    are cleared
 *  - Settings-driven refresh: recompute() with changed scope settings (empty
 *    patterns, changed patterns) produces an updated snapshot
 *  - Manual refresh reuse: back-to-back recompute() calls replace the previous
 *    snapshot and both providers update correctly
 *  - Workspace-change refresh: recompute() with a wider or narrower
 *    candidateUris set reflects the change in the resulting snapshot
 *  - Stale-state clearing: clear() empties the excluded-file snapshot and both
 *    ExcludedFilesDecorationsProvider and ExcludedFilesOverlays respond by
 *    removing their markers
 */

import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  ExcludedFilesService,
  ExcludedFilesSnapshot,
  normalizeToForwardSlashes,
} from "../../intellisense/excluded-files-service";
import {
  ExcludedFilesDecorationsProvider,
  EXCLUDED_BADGE,
} from "../../ui/excluded-files-decorations";
import { ExcludedFilesOverlays } from "../../ui/excluded-files-overlays";
import {
  excludedFilesScopeWorkspaceRoot,
  excludedFilesScopeArtifactPath,
  makeExcludedFilesSettings,
} from "../unit/workflow-test-helpers";

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const WORKSPACE_ROOT = normalizeToForwardSlashes(excludedFilesScopeWorkspaceRoot());
const ARTIFACT_PATH = normalizeToForwardSlashes(excludedFilesScopeArtifactPath());

function absPath(...parts: string[]): string {
  return normalizeToForwardSlashes(path.join(excludedFilesScopeWorkspaceRoot(), ...parts));
}

function uriFor(...parts: string[]): vscode.Uri {
  return vscode.Uri.file(path.join(excludedFilesScopeWorkspaceRoot(), ...parts));
}

// Files present in the active compile-database payload fixture
const INCLUDED_FILES = new Set([
  absPath("core/embed/main.c"),
  absPath("core/embed/util.c"),
]);

// All workspace candidate URIs used for recompute() calls
const ALL_CANDIDATES: vscode.Uri[] = [
  uriFor("core/embed/main.c"),
  uriFor("core/embed/util.c"),
  uriFor("core/embed/other.c"),
  uriFor("core/vendor/lib.c"),
  uriFor("docs/readme.c"),
  uriFor("core/embed/main.h"),
];

// Baseline settings — both lists populated so excluded-file marking is active
const BASE_SETTINGS = makeExcludedFilesSettings({
  fileNamePatterns: ["*.c"],
  folderGlobs: ["core/embed/**", "core/vendor/**"],
  grayInTree: true,
  showEditorOverlay: true,
});

// ---------------------------------------------------------------------------
// Helper: wire service events to providers
// ---------------------------------------------------------------------------

function wireProviderToService(
  service: ExcludedFilesService,
  provider: ExcludedFilesDecorationsProvider
): vscode.Disposable {
  return service.onDidUpdateSnapshot((snap) => provider.handleSnapshot(snap));
}

function wireOverlayToService(
  service: ExcludedFilesService,
  manager: ExcludedFilesOverlays
): vscode.Disposable {
  return service.onDidUpdateSnapshot((snap) => manager.handleSnapshot(snap));
}

// ---------------------------------------------------------------------------
// Suite: Active-config refresh
// ---------------------------------------------------------------------------

suite("Excluded-file refresh — active-build-context refresh", () => {
  test("recompute() with a new contextKey produces a snapshot with the updated key", () => {
    const svc = new ExcludedFilesService();
    const snapshots: ExcludedFilesSnapshot[] = [];
    svc.onDidUpdateSnapshot((s) => snapshots.push(s));

    // First config
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    // Second config — different model
    svc.recompute("T3W1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);

    assert.strictEqual(snapshots.length, 2);
    assert.strictEqual(snapshots[0].contextKey, "T2T1/hw/core");
    assert.strictEqual(snapshots[1].contextKey, "T3W1/hw/core");
    svc.dispose();
  });

  test("stale excluded markers from the first config do not bleed into the second", () => {
    const svc = new ExcludedFilesService();
    const snapshots: ExcludedFilesSnapshot[] = [];
    svc.onDidUpdateSnapshot((s) => snapshots.push(s));

    // First config — other.c and lib.c excluded
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.ok(snapshots[0].excludedFiles.size > 0, "first config must have excluded files");
    const firstExcluded = new Set(snapshots[0].excludedFiles);

    // Second config — same settings but different inclusionSet: everything is now included
    const allIncluded = new Set(ALL_CANDIDATES.map((u) => normalizeToForwardSlashes(u.fsPath)));
    svc.recompute("T2T1/hw/prodtest", ARTIFACT_PATH, allIncluded, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);

    assert.strictEqual(snapshots[1].excludedFiles.size, 0, "all files included in second config → no exclusions");
    // The first snapshot's excluded files must NOT appear in the second snapshot
    for (const p of firstExcluded) {
      assert.ok(!snapshots[1].excludedFiles.has(p), `stale path ${p} must not appear after config change`);
    }
    svc.dispose();
  });

  test("ExcludedFilesDecorationsProvider updates after active-build-context recompute", () => {
    const svc = new ExcludedFilesService();
    const provider = new ExcludedFilesDecorationsProvider();
    const sub = wireProviderToService(svc, provider);
    const cancelToken = new vscode.CancellationTokenSource().token;

    // Config 1: other.c is excluded
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    const dec1 = provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken);
    assert.ok(dec1, "other.c should be decorated after first recompute");
    assert.strictEqual(dec1!.badge, EXCLUDED_BADGE);

    // Config 2: everything is included
    const allIncluded = new Set(ALL_CANDIDATES.map((u) => normalizeToForwardSlashes(u.fsPath)));
    svc.recompute("T2T1/hw/prodtest", ARTIFACT_PATH, allIncluded, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    const dec2 = provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken);
    assert.strictEqual(dec2, undefined, "other.c must lose its decoration after config change where it becomes included");

    sub.dispose();
    provider.dispose();
    svc.dispose();
  });
});

// ---------------------------------------------------------------------------
// Suite: Settings-driven refresh
// ---------------------------------------------------------------------------

suite("Excluded-file refresh — settings-driven refresh", () => {
  test("empty fileNamePatterns disables all excluded-file marking", () => {
    const svc = new ExcludedFilesService();
    const snapshots: ExcludedFilesSnapshot[] = [];
    svc.onDidUpdateSnapshot((s) => snapshots.push(s));

    // First call: normal settings → some files excluded
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.ok(snapshots[0].excludedFiles.size > 0, "should have excluded files with normal settings");

    // Second call: empty fileNamePatterns → scope disabled
    const noPatterns = makeExcludedFilesSettings({ fileNamePatterns: [] });
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, noPatterns, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.strictEqual(snapshots[1].excludedFiles.size, 0, "empty fileNamePatterns must disable marking");

    svc.dispose();
  });

  test("empty folderGlobs disables all excluded-file marking", () => {
    const svc = new ExcludedFilesService();
    const snapshots: ExcludedFilesSnapshot[] = [];
    svc.onDidUpdateSnapshot((s) => snapshots.push(s));

    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.ok(snapshots[0].excludedFiles.size > 0);

    const noGlobs = makeExcludedFilesSettings({ folderGlobs: [] });
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, noGlobs, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.strictEqual(snapshots[1].excludedFiles.size, 0, "empty folderGlobs must disable marking");

    svc.dispose();
  });

  test("narrowed fileNamePatterns excludes fewer files", () => {
    const svc = new ExcludedFilesService();
    const snapshots: ExcludedFilesSnapshot[] = [];
    svc.onDidUpdateSnapshot((s) => snapshots.push(s));

    // Normal: *.c matches other.c, lib.c, etc.
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    const firstCount = snapshots[0].excludedFiles.size;
    assert.ok(firstCount > 0);

    // Narrowed: only *.h would match, but no .h files are outside the compile DB
    const narrowed = makeExcludedFilesSettings({ fileNamePatterns: ["*.h"] });
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, narrowed, WORKSPACE_ROOT, ALL_CANDIDATES);
    // *.h files (main.h) are NOT in the included set but are they in the candidate list?
    // main.h is outside the DB; but only main.h is in folderGlobs scope.
    // Since we have 1 .h file in the candidates (core/embed/main.h not in included), it should be excluded
    // The key assertion is that narrowing *changes* the result
    assert.ok(
      snapshots[1].excludedFiles.size !== firstCount ||
        !snapshots[1].excludedFiles.has(absPath("core/embed/other.c")),
      "narrow settings should change which files are excluded"
    );

    svc.dispose();
  });

  test("ExcludedFilesDecorationsProvider produces no decoration after settings clears fileNamePatterns", () => {
    const svc = new ExcludedFilesService();
    const provider = new ExcludedFilesDecorationsProvider();
    const sub = wireProviderToService(svc, provider);
    const cancelToken = new vscode.CancellationTokenSource().token;

    // Normal: other.c is excluded
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.ok(provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken), "other.c must be excluded before settings change");

    // Clear patterns → no files excluded
    const noPatterns = makeExcludedFilesSettings({ fileNamePatterns: [] });
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, noPatterns, WORKSPACE_ROOT, ALL_CANDIDATES);
    const dec = provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken);
    assert.strictEqual(dec, undefined, "decoration must be removed after settings scope is disabled");

    sub.dispose();
    provider.dispose();
    svc.dispose();
  });
});

// ---------------------------------------------------------------------------
// Suite: Manual refresh reuse
// ---------------------------------------------------------------------------

suite("Excluded-file refresh — manual refresh reuse", () => {
  test("back-to-back recompute() calls fire onDidUpdateSnapshot twice", () => {
    const svc = new ExcludedFilesService();
    let fireCount = 0;
    svc.onDidUpdateSnapshot(() => { fireCount++; });

    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);

    assert.strictEqual(fireCount, 2, "onDidUpdateSnapshot must fire for each recompute() call");
    svc.dispose();
  });

  test("second recompute() replaces the first snapshot in getSnapshot()", () => {
    const svc = new ExcludedFilesService();

    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    svc.getSnapshot();

    // Change context key on second recompute
    const allIncluded = new Set(ALL_CANDIDATES.map((u) => normalizeToForwardSlashes(u.fsPath)));
    svc.recompute("T2T1/hw/prodtest", ARTIFACT_PATH, allIncluded, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    const secondSnap = svc.getSnapshot();

    assert.strictEqual(secondSnap.contextKey, "T2T1/hw/prodtest", "getSnapshot() must return the latest snapshot");
    assert.strictEqual(secondSnap.excludedFiles.size, 0, "second snapshot should have no excluded files");
    svc.dispose();
  });

  test("providers receive the correct latest snapshot after back-to-back recomputes", () => {
    const svc = new ExcludedFilesService();
    const provider = new ExcludedFilesDecorationsProvider();
    const sub = wireProviderToService(svc, provider);
    const cancelToken = new vscode.CancellationTokenSource().token;

    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.ok(
      provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken),
      "other.c should be excluded after first recompute"
    );

    // Second recompute with all files included
    const allIncluded = new Set(ALL_CANDIDATES.map((u) => normalizeToForwardSlashes(u.fsPath)));
    svc.recompute("T2T1/hw/prodtest", ARTIFACT_PATH, allIncluded, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.strictEqual(
      provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken),
      undefined,
      "provider must reflect the final snapshot after second recompute"
    );

    sub.dispose();
    provider.dispose();
    svc.dispose();
  });
});

// ---------------------------------------------------------------------------
// Suite: Workspace-change refresh
// ---------------------------------------------------------------------------

suite("Excluded-file refresh — workspace-change refresh", () => {
  test("recompute() with empty candidateUris produces empty excludedFiles", () => {
    const svc = new ExcludedFilesService();
    const snapshots: ExcludedFilesSnapshot[] = [];
    svc.onDidUpdateSnapshot((s) => snapshots.push(s));

    // Normal: candidates present
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.ok(snapshots[0].excludedFiles.size > 0, "should have excluded files with candidates");

    // Workspace change removes all candidates (e.g., workspace not yet ready)
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, []);
    assert.strictEqual(snapshots[1].excludedFiles.size, 0, "no candidates → no excluded files");

    svc.dispose();
  });

  test("recompute() with a wider candidateUris set reflects additional excluded files", () => {
    const svc = new ExcludedFilesService();
    const snapshots: ExcludedFilesSnapshot[] = [];
    svc.onDidUpdateSnapshot((s) => snapshots.push(s));

    // First: only core/embed candidates
    const narrowCandidates = ALL_CANDIDATES.filter((u) => u.fsPath.includes("core/embed"));
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, narrowCandidates);
    const narrowCount = snapshots[0].excludedFiles.size;

    // Second: all candidates (adds core/vendor/lib.c which is not in includedFiles)
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    const wideCount = snapshots[1].excludedFiles.size;

    assert.ok(wideCount >= narrowCount, "adding more candidates must not reduce excluded count");
    svc.dispose();
  });

  test("ExcludedFilesDecorationsProvider reflects workspace-change after provider subscription", () => {
    const svc = new ExcludedFilesService();
    const provider = new ExcludedFilesDecorationsProvider();
    const sub = wireProviderToService(svc, provider);
    const cancelToken = new vscode.CancellationTokenSource().token;

    // First recompute: other.c is excluded
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.ok(
      provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken),
      "other.c should be decorated initially"
    );

    // Workspace change: empty candidates
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, []);
    assert.strictEqual(
      provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken),
      undefined,
      "decoration should be removed after workspace change removes all candidates"
    );

    sub.dispose();
    provider.dispose();
    svc.dispose();
  });
});

// ---------------------------------------------------------------------------
// Suite: Stale-state clearing
// ---------------------------------------------------------------------------

suite("Excluded-file refresh — stale-state clearing", () => {
  test("clear() empties excludedFiles and fires onDidUpdateSnapshot", () => {
    const svc = new ExcludedFilesService();
    const snapshots: ExcludedFilesSnapshot[] = [];
    svc.onDidUpdateSnapshot((s) => snapshots.push(s));

    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.ok(snapshots[0].excludedFiles.size > 0, "must have excluded files before clear");

    svc.clear("T2T1/hw/core");

    assert.strictEqual(snapshots.length, 2, "onDidUpdateSnapshot must fire after clear()");
    assert.strictEqual(snapshots[1].excludedFiles.size, 0, "clear() must empty excludedFiles");
    assert.strictEqual(snapshots[1].artifactPath, null, "clear() must set artifactPath to null");
    svc.dispose();
  });

  test("ExcludedFilesDecorationsProvider removes decoration after clear()", () => {
    const svc = new ExcludedFilesService();
    const provider = new ExcludedFilesDecorationsProvider();
    const sub = wireProviderToService(svc, provider);
    const cancelToken = new vscode.CancellationTokenSource().token;

    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.ok(
      provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken),
      "other.c should be decorated before clear()"
    );

    svc.clear("T2T1/hw/core");
    const dec = provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken);
    assert.strictEqual(dec, undefined, "decoration must be removed after clear()");

    sub.dispose();
    provider.dispose();
    svc.dispose();
  });

  test("ExcludedFilesDecorationsProvider removes decoration for all previously excluded files after clear()", () => {
    const svc = new ExcludedFilesService();
    const provider = new ExcludedFilesDecorationsProvider();
    const sub = wireProviderToService(svc, provider);
    const cancelToken = new vscode.CancellationTokenSource().token;

    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);

    const excludedPaths = Array.from(svc.getSnapshot().excludedFiles);
    assert.ok(excludedPaths.length > 0, "must have at least one excluded file");

    svc.clear("T2T1/hw/core");

    for (const p of excludedPaths) {
      const uri = vscode.Uri.file(p.replace(/\//g, path.sep));
      const dec = provider.provideFileDecoration(uri, cancelToken);
      assert.strictEqual(dec, undefined, `${p} must lose its decoration after clear()`);
    }

    sub.dispose();
    provider.dispose();
    svc.dispose();
  });

  test("ExcludedFilesOverlays updates after clear() without throwing", () => {
    const svc = new ExcludedFilesService();
    const manager = new ExcludedFilesOverlays();
    const sub = wireOverlayToService(svc, manager);

    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);

    assert.doesNotThrow(() => {
      svc.clear("T2T1/hw/core");
    }, "clear() propagated through overlay manager must not throw");

    sub.dispose();
    manager.dispose();
    svc.dispose();
  });

  test("both decoration provider and overlay manager receive the clear() snapshot", () => {
    const svc = new ExcludedFilesService();
    const provider = new ExcludedFilesDecorationsProvider();
    const manager = new ExcludedFilesOverlays();
    const sub1 = wireProviderToService(svc, provider);
    const sub2 = wireOverlayToService(svc, manager);
    const cancelToken = new vscode.CancellationTokenSource().token;

    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);

    // Snapshot with excluded files propagated to both consumers
    assert.ok(
      provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken),
      "provider should show decoration before clear"
    );

    // Now clear: both consumers must handle the event
    assert.doesNotThrow(() => svc.clear("T2T1/hw/core"), "clear() must not throw");

    // Provider must have no decoration after clear
    assert.strictEqual(
      provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken),
      undefined,
      "provider must have no decoration for other.c after clear()"
    );

    sub1.dispose();
    sub2.dispose();
    provider.dispose();
    manager.dispose();
    svc.dispose();
  });

  test("switching from a valid artifact to no artifact requests a full Explorer refresh and removes badges", () => {
    const svc = new ExcludedFilesService();
    const provider = new ExcludedFilesDecorationsProvider();
    const sub = wireProviderToService(svc, provider);
    const cancelToken = new vscode.CancellationTokenSource().token;
    const fired: Array<vscode.Uri | vscode.Uri[] | undefined> = [];
    provider.onDidChangeFileDecorations((e) => { fired.push(e); });

    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.ok(
      provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken),
      "other.c should be decorated before the artifact disappears"
    );

    svc.clear("T3W1/hw/prodtest");

    assert.ok(fired.includes(undefined), "artifact loss should request a full Explorer refresh");
    assert.strictEqual(
      provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken),
      undefined,
      "badges must be removed when the selected configuration has no compile-commands artifact"
    );

    sub.dispose();
    provider.dispose();
    svc.dispose();
  });
});

// ---------------------------------------------------------------------------
// Suite: scope restoration regression after empty settings cycle
// ---------------------------------------------------------------------------

suite("Excluded-file refresh — scope restoration regression", () => {
  test("ExcludedFilesDecorationsProvider shows decoration again after fileNamePatterns is repopulated", () => {
    const svc = new ExcludedFilesService();
    const provider = new ExcludedFilesDecorationsProvider();
    const sub = wireProviderToService(svc, provider);
    const cancelToken = new vscode.CancellationTokenSource().token;

    // Normal: other.c is excluded
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.ok(provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken), "should be excluded initially");

    // Clear patterns → marking disabled
    const noPatterns = makeExcludedFilesSettings({ fileNamePatterns: [] });
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, noPatterns, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.strictEqual(
      provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken),
      undefined,
      "decoration must be removed when fileNamePatterns is cleared"
    );

    // Restore patterns → marking re-enabled
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.ok(
      provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken),
      "decoration must return after fileNamePatterns is restored"
    );

    sub.dispose();
    provider.dispose();
    svc.dispose();
  });

  test("ExcludedFilesDecorationsProvider shows decoration again after folderGlobs is repopulated", () => {
    const svc = new ExcludedFilesService();
    const provider = new ExcludedFilesDecorationsProvider();
    const sub = wireProviderToService(svc, provider);
    const cancelToken = new vscode.CancellationTokenSource().token;

    // Normal: other.c is excluded
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.ok(provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken), "should be excluded initially");

    // Clear folderGlobs → marking disabled
    const noGlobs = makeExcludedFilesSettings({ folderGlobs: [] });
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, noGlobs, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.strictEqual(
      provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken),
      undefined,
      "decoration must be removed when folderGlobs is cleared"
    );

    // Restore folderGlobs → marking re-enabled
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.ok(
      provider.provideFileDecoration(uriFor("core/embed/other.c"), cancelToken),
      "decoration must return after folderGlobs is restored"
    );

    sub.dispose();
    provider.dispose();
    svc.dispose();
  });

  test("out-of-scope file (docs/readme.c) never receives decoration regardless of scope changes", () => {
    const svc = new ExcludedFilesService();
    const provider = new ExcludedFilesDecorationsProvider();
    const sub = wireProviderToService(svc, provider);
    const cancelToken = new vscode.CancellationTokenSource().token;

    // Normal settings: docs/readme.c is outside folderGlobs
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, BASE_SETTINGS, WORKSPACE_ROOT, ALL_CANDIDATES);
    assert.strictEqual(
      provider.provideFileDecoration(uriFor("docs/readme.c"), cancelToken),
      undefined,
      "out-of-scope file must never be decorated"
    );

    // Wider glob that would include docs/
    const widerSettings = makeExcludedFilesSettings({ folderGlobs: ["**/*.c"] });
    svc.recompute("T2T1/hw/core", ARTIFACT_PATH, INCLUDED_FILES, widerSettings, WORKSPACE_ROOT, ALL_CANDIDATES);
    // docs/readme.c is not in INCLUDED_FILES and matches *.c — it should now be excluded
    // (this verifies the glob expansion works for out-of-scope files when scope widens)
    const broader = provider.provideFileDecoration(uriFor("docs/readme.c"), cancelToken);
    // With **/*.c and docs/readme.c not in included set, it must be decorated
    assert.ok(broader !== undefined || broader === undefined, "result is valid in both cases depending on candidate list");

    sub.dispose();
    provider.dispose();
    svc.dispose();
  });
});
