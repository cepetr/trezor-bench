/**
 * Unit tests for ExcludedFileOverlaysManager state selection and clearing behavior.
 *
 * Covers:
 *  - `handleSnapshot()` clears all overlays when `showEditorOverlay` is false
 *  - `handleSnapshot()` clears all overlays when `excludedFiles` is empty
 *  - `handleSnapshot()` applies first-line decoration to excluded editors
 *  - `handleSnapshot()` clears decoration from non-excluded editors
 *  - applyToVisibleEditors() with no snapshot is a no-op (no errors)
 *  - applyToVisibleEditors() applies the last snapshot state to new editors
 *  - Multiple visible editors: excluded and non-excluded handled independently
 */

import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { ExcludedFileOverlaysManager } from "../../../ui/excluded-file-overlays";
import { normalizeToForwardSlashes } from "../../../intellisense/excluded-files-service";
import { ExcludedFilesSnapshot } from "../../../intellisense/excluded-files-service";
import { excludedFilesScopeWorkspaceRoot, makeExcludedFilesSettings } from "../workflow-test-helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function absPath(...parts: string[]): string {
  return normalizeToForwardSlashes(path.join(excludedFilesScopeWorkspaceRoot(), ...parts));
}

/**
 * A minimal stub TextEditor that records setDecorations calls.
 * Mutates vscode.window.visibleTextEditors to inject itself.
 */
function makeStubEditor(fsPath: string): {
  document: { uri: { fsPath: string }; lineAt: (line: number) => { range: { start: { line: number }; end: { line: number } } } };
  setDecorations: (type: unknown, ranges: unknown[]) => void;
  decorationCalls: Array<{ type: unknown; ranges: unknown[] }>;
} {
  const decorationCalls: Array<{ type: unknown; ranges: unknown[] }> = [];
  return {
    document: {
      uri: { fsPath },
      lineAt: (line: number) => ({
        range: { start: { line }, end: { line } } as unknown as vscode.Range,
      }),
    },
    setDecorations(type: unknown, ranges: unknown[]) {
      decorationCalls.push({ type, ranges });
    },
    decorationCalls,
  };
}

/**
 * Makes a snapshot with the given excluded and/or included paths and settings.
 */
function makeSnapshot(
  excludedPaths: string[],
  options: { showEditorOverlay?: boolean } = {}
): ExcludedFilesSnapshot {
  const { showEditorOverlay = true } = options;
  return {
    contextKey: "T2T1/hw/core",
    artifactPath: absPath("artifacts/model-t/compile_commands_core.cc.json"),
    settings: makeExcludedFilesSettings({ showEditorOverlay }),
    includedFiles: new Set<string>(),
    excludedFiles: new Set(excludedPaths),
  };
}

// ---------------------------------------------------------------------------
// Module-level window mock access
// ---------------------------------------------------------------------------
// The vscode-mock exposes `window.visibleTextEditors` as a mutable array.
// We replace it per test and restore after.
const windowMock: { visibleTextEditors: unknown[] } = (vscode as unknown as { window: { visibleTextEditors: unknown[] } }).window;

// ---------------------------------------------------------------------------
// Suite: handleSnapshot() — showEditorOverlay disabled
// ---------------------------------------------------------------------------

suite("ExcludedFileOverlaysManager — showEditorOverlay disabled", () => {
  let originalEditors: unknown[];

  setup(() => {
    originalEditors = windowMock.visibleTextEditors;
  });

  teardown(() => {
    windowMock.visibleTextEditors = originalEditors;
  });

  test("clears decorations for excluded editor when showEditorOverlay is false", () => {
    const excludedPath = absPath("core/embed/other.c");
    const editor = makeStubEditor(excludedPath);
    windowMock.visibleTextEditors = [editor];

    const manager = new ExcludedFileOverlaysManager();
    manager.handleSnapshot(makeSnapshot([excludedPath], { showEditorOverlay: false }));

    assert.ok(editor.decorationCalls.length > 0, "setDecorations must be called when overlay is disabled");
    const lastCall = editor.decorationCalls[editor.decorationCalls.length - 1];
    assert.deepStrictEqual(lastCall.ranges, [], "overlay must be cleared when showEditorOverlay is false");
    manager.dispose();
  });

  test("clears decorations for all visible editors when showEditorOverlay is false", () => {
    const excludedPath = absPath("core/embed/other.c");
    const includedPath = absPath("core/embed/main.c");
    const excludedEditor = makeStubEditor(excludedPath);
    const includedEditor = makeStubEditor(includedPath);
    windowMock.visibleTextEditors = [excludedEditor, includedEditor];

    const manager = new ExcludedFileOverlaysManager();
    manager.handleSnapshot(makeSnapshot([excludedPath], { showEditorOverlay: false }));

    const lastExcluded = excludedEditor.decorationCalls[excludedEditor.decorationCalls.length - 1];
    const lastIncluded = includedEditor.decorationCalls[includedEditor.decorationCalls.length - 1];
    assert.deepStrictEqual(lastExcluded.ranges, [], "excluded editor must be cleared when overlay disabled");
    assert.deepStrictEqual(lastIncluded.ranges, [], "included editor must be cleared when overlay disabled");
    manager.dispose();
  });
});

// ---------------------------------------------------------------------------
// Suite: handleSnapshot() — excluded file gets overlay
// ---------------------------------------------------------------------------

suite("ExcludedFileOverlaysManager — excluded file receives overlay", () => {
  let originalEditors: unknown[];

  setup(() => {
    originalEditors = windowMock.visibleTextEditors;
  });

  teardown(() => {
    windowMock.visibleTextEditors = originalEditors;
  });

  test("applies decoration to excluded editor", () => {
    const excludedPath = absPath("core/embed/other.c");
    const editor = makeStubEditor(excludedPath);
    windowMock.visibleTextEditors = [editor];

    const manager = new ExcludedFileOverlaysManager();
    manager.handleSnapshot(makeSnapshot([excludedPath], { showEditorOverlay: true }));

    assert.ok(editor.decorationCalls.length > 0, "setDecorations must be called");
    const lastCall = editor.decorationCalls[editor.decorationCalls.length - 1];
    assert.ok(lastCall.ranges.length > 0, "decorator ranges must be non-empty for excluded file");
    manager.dispose();
  });

  test("decoration is applied to the first line only", () => {
    const excludedPath = absPath("core/embed/other.c");
    const editor = makeStubEditor(excludedPath);
    windowMock.visibleTextEditors = [editor];

    const manager = new ExcludedFileOverlaysManager();
    manager.handleSnapshot(makeSnapshot([excludedPath], { showEditorOverlay: true }));

    const lastCall = editor.decorationCalls[editor.decorationCalls.length - 1];
    assert.strictEqual(lastCall.ranges.length, 1, "exactly one decoration range for first line");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const range = lastCall.ranges[0] as any;
    assert.strictEqual(range.range.start.line, 0, "decoration starts on line 0");
    manager.dispose();
  });
});

// ---------------------------------------------------------------------------
// Suite: handleSnapshot() — non-excluded files get cleared
// ---------------------------------------------------------------------------

suite("ExcludedFileOverlaysManager — non-excluded files are cleared", () => {
  let originalEditors: unknown[];

  setup(() => {
    originalEditors = windowMock.visibleTextEditors;
  });

  teardown(() => {
    windowMock.visibleTextEditors = originalEditors;
  });

  test("clears decoration for editor whose file is NOT in excludedFiles", () => {
    const includedPath = absPath("core/embed/main.c");
    const editor = makeStubEditor(includedPath);
    windowMock.visibleTextEditors = [editor];

    const manager = new ExcludedFileOverlaysManager();
    // main.c is NOT in the excluded set
    manager.handleSnapshot(makeSnapshot([absPath("core/embed/other.c")], { showEditorOverlay: true }));

    const lastCall = editor.decorationCalls[editor.decorationCalls.length - 1];
    assert.deepStrictEqual(lastCall.ranges, [], "included file must have cleared decoration");
    manager.dispose();
  });

  test("clears decoration when excludedFiles is empty", () => {
    const editor = makeStubEditor(absPath("core/embed/main.c"));
    windowMock.visibleTextEditors = [editor];

    const manager = new ExcludedFileOverlaysManager();
    manager.handleSnapshot(makeSnapshot([], { showEditorOverlay: true }));

    const lastCall = editor.decorationCalls[editor.decorationCalls.length - 1];
    assert.deepStrictEqual(lastCall.ranges, [], "empty excludedFiles must clear decoration");
    manager.dispose();
  });
});

// ---------------------------------------------------------------------------
// Suite: handleSnapshot() — mixed excluded/non-excluded editors
// ---------------------------------------------------------------------------

suite("ExcludedFileOverlaysManager — mixed excluded and non-excluded editors", () => {
  let originalEditors: unknown[];

  setup(() => {
    originalEditors = windowMock.visibleTextEditors;
  });

  teardown(() => {
    windowMock.visibleTextEditors = originalEditors;
  });

  test("applies overlay to excluded and clears non-excluded in same call", () => {
    const excludedPath = absPath("core/embed/other.c");
    const includedPath = absPath("core/embed/main.c");
    const excludedEditor = makeStubEditor(excludedPath);
    const includedEditor = makeStubEditor(includedPath);
    windowMock.visibleTextEditors = [excludedEditor, includedEditor];

    const manager = new ExcludedFileOverlaysManager();
    manager.handleSnapshot(makeSnapshot([excludedPath], { showEditorOverlay: true }));

    const lastExcluded = excludedEditor.decorationCalls[excludedEditor.decorationCalls.length - 1];
    const lastIncluded = includedEditor.decorationCalls[includedEditor.decorationCalls.length - 1];
    assert.ok(lastExcluded.ranges.length > 0, "excluded editor must have decoration");
    assert.deepStrictEqual(lastIncluded.ranges, [], "included editor must have cleared decoration");
    manager.dispose();
  });
});

// ---------------------------------------------------------------------------
// Suite: applyToVisibleEditors() — no snapshot is a no-op
// ---------------------------------------------------------------------------

suite("ExcludedFileOverlaysManager — applyToVisibleEditors() with no snapshot", () => {
  let originalEditors: unknown[];

  setup(() => {
    originalEditors = windowMock.visibleTextEditors;
  });

  teardown(() => {
    windowMock.visibleTextEditors = originalEditors;
  });

  test("does not call setDecorations when no snapshot has been applied", () => {
    const editor = makeStubEditor(absPath("core/embed/other.c"));
    windowMock.visibleTextEditors = [editor];

    const manager = new ExcludedFileOverlaysManager();
    manager.applyToVisibleEditors(); // called without handleSnapshot first

    assert.strictEqual(editor.decorationCalls.length, 0, "setDecorations must not be called before any snapshot");
    manager.dispose();
  });
});

// ---------------------------------------------------------------------------
// Suite: applyToVisibleEditors() — respects current snapshot
// ---------------------------------------------------------------------------

suite("ExcludedFileOverlaysManager — applyToVisibleEditors() uses latest snapshot", () => {
  let originalEditors: unknown[];

  setup(() => {
    originalEditors = windowMock.visibleTextEditors;
  });

  teardown(() => {
    windowMock.visibleTextEditors = originalEditors;
  });

  test("applies overlay when called after snapshot with excluded file", () => {
    const excludedPath = absPath("core/embed/other.c");
    const manager = new ExcludedFileOverlaysManager();

    // Apply snapshot with empty editors first
    windowMock.visibleTextEditors = [];
    manager.handleSnapshot(makeSnapshot([excludedPath], { showEditorOverlay: true }));

    // Now add an editor and call applyToVisibleEditors()
    const editor = makeStubEditor(excludedPath);
    windowMock.visibleTextEditors = [editor];
    manager.applyToVisibleEditors();

    assert.ok(editor.decorationCalls.length > 0, "setDecorations must be called by applyToVisibleEditors");
    const lastCall = editor.decorationCalls[editor.decorationCalls.length - 1];
    assert.ok(lastCall.ranges.length > 0, "decoration must be applied to excluded file");
    manager.dispose();
  });
});
