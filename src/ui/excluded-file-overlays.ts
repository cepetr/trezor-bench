/**
 * Editor overlay manager for the Excluded-File Visibility feature.
 *
 * Applies a first-line warning `TextEditorDecorationType` to open editors
 * whose files are currently excluded from the active build configuration and
 * clears it as soon as a file is no longer excluded or the
 * `tbench.excludedFiles.showEditorOverlay` preference is disabled.
 *
 * Implementation notes:
 *  - One shared `TextEditorDecorationType` is created at construction time
 *    and reused across editors for efficiency.
 *  - `applyToVisibleEditors()` is called via `handleSnapshot()` and from the
 *    `onDidChangeVisibleTextEditors` event handler wired in extension.ts.
 *  - `handleSnapshot()` immediately clears all overlays when
 *    `showEditorOverlay` is false or when `excludedFiles` is empty, which
 *    clears stale overlays without requiring a separate clear call.
 *  - Overlay rendering is handled here for excluded editors.
 */

import * as vscode from "vscode";
import { ExcludedFilesSnapshot } from "../intellisense/excluded-files-service";
import { normalizeToForwardSlashes } from "../intellisense/excluded-files-service";
import { EXCLUDED_TOOLTIP } from "./excluded-file-decorations";

// ---------------------------------------------------------------------------
// ExcludedFileOverlaysManager
// ---------------------------------------------------------------------------

/**
 * Manages the first-line warning overlay for open excluded editors.
 *
 * Create one instance and register with the extension disposable list.
 * Call `handleSnapshot()` whenever `ExcludedFilesService` emits a new snapshot,
 * and call `applyToVisibleEditors()` from the `onDidChangeVisibleTextEditors`
 * event to pick up newly opened editors.
 */
export class ExcludedFileOverlaysManager {
  private _snapshot: ExcludedFilesSnapshot | undefined;

  /**
   * Single shared decoration type for first-line warning overlays.
   * The "after" content approach renders inline text on the first line.
   */
  private readonly _decorationType: vscode.TextEditorDecorationType;

  constructor() {
    this._decorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      after: {
        contentText: `  ⚠ ${EXCLUDED_TOOLTIP}`,
        color: new vscode.ThemeColor("editorWarning.foreground"),
        margin: "0 0 0 1em",
        fontStyle: "italic",
      },
    });
  }

  dispose(): void {
    this._decorationType.dispose();
  }

  /**
   * Called by the extension wiring whenever `ExcludedFilesService` emits a
   * new snapshot.  Updates stored snapshot and refreshes visible editors.
   */
  handleSnapshot(snapshot: ExcludedFilesSnapshot): void {
    this._snapshot = snapshot;
    this.applyToVisibleEditors();
  }

  /**
  * Applies or clears the first-line overlay for all currently visible text
  * editors based on the latest snapshot. No-ops when no snapshot is present.
  * Refresh the overlay state for all tracked editors.
   */
  applyToVisibleEditors(): void {
    const snapshot = this._snapshot;
    if (!snapshot) {
      return;
    }

    for (const editor of vscode.window.visibleTextEditors) {
      this._applyToEditor(editor, snapshot);
    }
  }

  private _applyToEditor(
    editor: vscode.TextEditor,
    snapshot: ExcludedFilesSnapshot
  ): void {
    // Keep the decoration state aligned with the current exclusion snapshot.
    // Stub: clear any existing overlay so the editor is clean.
    if (!snapshot.settings.showEditorOverlay) {
      editor.setDecorations(this._decorationType, []);
      return;
    }

    const normalized = normalizeToForwardSlashes(editor.document.uri.fsPath);
    if (!snapshot.excludedFiles.has(normalized)) {
      editor.setDecorations(this._decorationType, []);
      return;
    }

    // Apply a first-line whole-line decoration to explain excluded-file status.
    const firstLine = editor.document.lineAt(0);
    const range = firstLine.range;
    const decoration: vscode.DecorationOptions = {
      range,
      hoverMessage: EXCLUDED_TOOLTIP,
    };
    editor.setDecorations(this._decorationType, [decoration]);
  }
}
