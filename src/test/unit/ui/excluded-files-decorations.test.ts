/**
 * Unit tests for the Explorer file-decoration provider of the Excluded-File
 * Visibility feature.
 *
 * Covers `provideFileDecoration` results (badge, tooltip, optional gray
 * color) and the `handleSnapshot` refresh logic: targeted URI refreshes for
 * membership changes, full refreshes for context/artifact/settings changes,
 * and no event when nothing changed.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import {
  ExcludedFilesDecorationsProvider,
  EXCLUDED_BADGE,
  EXCLUDED_TOOLTIP,
} from "../../../ui/excluded-files-decorations";
import { makeExcludedFilesSnapshot, makeExcludedFilesSettings } from "../workflow-test-helpers";

const CANCELLATION_TOKEN = {} as vscode.CancellationToken;

/** Collects every onDidChangeFileDecorations emission for assertions. */
function trackEvents(provider: ExcludedFilesDecorationsProvider): Array<vscode.Uri | vscode.Uri[] | undefined> {
  const events: Array<vscode.Uri | vscode.Uri[] | undefined> = [];
  provider.onDidChangeFileDecorations((e) => events.push(e));
  return events;
}

function fsPathsOf(event: vscode.Uri | vscode.Uri[] | undefined): string[] {
  assert.ok(Array.isArray(event), "expected a URI-array emission");
  return event.map((u) => u.fsPath).sort();
}

// ---------------------------------------------------------------------------
// Suite: provideFileDecoration
// ---------------------------------------------------------------------------

suite("ExcludedFilesDecorationsProvider — provideFileDecoration", () => {
  test("returns undefined before any snapshot arrives", () => {
    const provider = new ExcludedFilesDecorationsProvider();
    const decoration = provider.provideFileDecoration(
      vscode.Uri.file("/workspace/core/embed/foo.c"),
      CANCELLATION_TOKEN
    );
    assert.strictEqual(decoration, undefined);
    provider.dispose();
  });

  test("returns badge, tooltip, and gray color for an excluded file", () => {
    const excluded = "/workspace/core/embed/foo.c";
    const provider = new ExcludedFilesDecorationsProvider();
    provider.handleSnapshot(makeExcludedFilesSnapshot({ excludedFiles: new Set([excluded]) }));

    const decoration = provider.provideFileDecoration(vscode.Uri.file(excluded), CANCELLATION_TOKEN);
    assert.ok(decoration, "excluded file must be decorated");
    assert.strictEqual(decoration.badge, EXCLUDED_BADGE);
    assert.strictEqual(decoration.tooltip, EXCLUDED_TOOLTIP);
    assert.ok(decoration.color, "grayInTree=true must set a theme color");
    provider.dispose();
  });

  test("omits the color when grayInTree is disabled", () => {
    const excluded = "/workspace/core/embed/foo.c";
    const provider = new ExcludedFilesDecorationsProvider();
    provider.handleSnapshot(
      makeExcludedFilesSnapshot({
        settings: makeExcludedFilesSettings({ grayInTree: false }),
        excludedFiles: new Set([excluded]),
      })
    );

    const decoration = provider.provideFileDecoration(vscode.Uri.file(excluded), CANCELLATION_TOKEN);
    assert.ok(decoration, "excluded file must be decorated");
    assert.strictEqual(decoration.color, undefined);
    provider.dispose();
  });

  test("returns undefined for a file that is not excluded", () => {
    const provider = new ExcludedFilesDecorationsProvider();
    provider.handleSnapshot(
      makeExcludedFilesSnapshot({ excludedFiles: new Set(["/workspace/core/embed/foo.c"]) })
    );

    const decoration = provider.provideFileDecoration(
      vscode.Uri.file("/workspace/core/embed/included.c"),
      CANCELLATION_TOKEN
    );
    assert.strictEqual(decoration, undefined);
    provider.dispose();
  });
});

// ---------------------------------------------------------------------------
// Suite: handleSnapshot refresh events
// ---------------------------------------------------------------------------

suite("ExcludedFilesDecorationsProvider — handleSnapshot", () => {
  test("fires the newly excluded URIs on the first snapshot", () => {
    const provider = new ExcludedFilesDecorationsProvider();
    const events = trackEvents(provider);

    provider.handleSnapshot(
      makeExcludedFilesSnapshot({ excludedFiles: new Set(["/workspace/core/embed/foo.c"]) })
    );

    assert.strictEqual(events.length, 1);
    assert.deepStrictEqual(fsPathsOf(events[0]), ["/workspace/core/embed/foo.c"]);
    provider.dispose();
  });

  test("fires nothing for a first snapshot with no excluded files", () => {
    const provider = new ExcludedFilesDecorationsProvider();
    const events = trackEvents(provider);

    provider.handleSnapshot(makeExcludedFilesSnapshot());

    assert.strictEqual(events.length, 0);
    provider.dispose();
  });

  test("fires both added and removed URIs on a membership change", () => {
    const provider = new ExcludedFilesDecorationsProvider();
    provider.handleSnapshot(
      makeExcludedFilesSnapshot({ excludedFiles: new Set(["/workspace/core/embed/old.c"]) })
    );
    const events = trackEvents(provider);

    provider.handleSnapshot(
      makeExcludedFilesSnapshot({ excludedFiles: new Set(["/workspace/core/embed/new.c"]) })
    );

    assert.strictEqual(events.length, 1);
    assert.deepStrictEqual(fsPathsOf(events[0]), [
      "/workspace/core/embed/new.c",
      "/workspace/core/embed/old.c",
    ]);
    provider.dispose();
  });

  test("fires nothing when the snapshot is unchanged", () => {
    const provider = new ExcludedFilesDecorationsProvider();
    provider.handleSnapshot(
      makeExcludedFilesSnapshot({ excludedFiles: new Set(["/workspace/core/embed/foo.c"]) })
    );
    const events = trackEvents(provider);

    provider.handleSnapshot(
      makeExcludedFilesSnapshot({ excludedFiles: new Set(["/workspace/core/embed/foo.c"]) })
    );

    assert.strictEqual(events.length, 0);
    provider.dispose();
  });

  test("fires a full refresh (undefined) when the context key changes", () => {
    const provider = new ExcludedFilesDecorationsProvider();
    provider.handleSnapshot(makeExcludedFilesSnapshot({ contextKey: "T2T1/hw/core" }));
    const events = trackEvents(provider);

    provider.handleSnapshot(makeExcludedFilesSnapshot({ contextKey: "T3B1/hw/core" }));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0], undefined);
    provider.dispose();
  });

  test("fires a full refresh (undefined) when the artifact path changes", () => {
    const provider = new ExcludedFilesDecorationsProvider();
    provider.handleSnapshot(makeExcludedFilesSnapshot({ artifactPath: "/workspace/a.json" }));
    const events = trackEvents(provider);

    provider.handleSnapshot(makeExcludedFilesSnapshot({ artifactPath: "/workspace/b.json" }));

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0], undefined);
    provider.dispose();
  });

  test("fires a full refresh (undefined) when only grayInTree changes", () => {
    const provider = new ExcludedFilesDecorationsProvider();
    provider.handleSnapshot(makeExcludedFilesSnapshot());
    const events = trackEvents(provider);

    provider.handleSnapshot(
      makeExcludedFilesSnapshot({ settings: makeExcludedFilesSettings({ grayInTree: false }) })
    );

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0], undefined);
    provider.dispose();
  });
});
