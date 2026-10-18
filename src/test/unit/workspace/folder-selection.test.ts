/**
 * Unit tests for workspace folder selection in a multi-root window.
 */
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  describeFolderSelectionReason,
  isSameFolder,
  selectWorkspaceFolder,
} from "../../../workspace/folder-selection";

const DEFAULT_MANIFEST = "core/embed/xtask/tf-tools/manifest.yaml";

function folder(fsPath: string, index: number): vscode.WorkspaceFolder {
  return {
    uri: vscode.Uri.file(fsPath),
    name: path.basename(fsPath),
    index,
  } as vscode.WorkspaceFolder;
}

/** Presence probe that reports only the given absolute paths as existing. */
function existing(...paths: string[]): (fsPath: string) => boolean {
  const known = new Set(paths.map((p) => path.normalize(p)));
  return (fsPath) => known.has(path.normalize(fsPath));
}

suite("selectWorkspaceFolder", () => {
  const notes = folder("/ws/notes", 0);
  const firmware = folder("/ws/trezor-firmware", 1);
  const other = folder("/ws/other", 2);

  test("prefers tbench.toml in a later folder over a default manifest in an earlier one", () => {
    const selection = selectWorkspaceFolder(
      [notes, firmware],
      existing("/ws/notes/" + DEFAULT_MANIFEST, "/ws/trezor-firmware/tbench.toml")
    );
    assert.strictEqual(selection?.folder, firmware);
    assert.strictEqual(selection?.reason, "repository-config");
  });

  test("falls back to the default manifest when no folder has tbench.toml", () => {
    const selection = selectWorkspaceFolder(
      [notes, firmware],
      existing("/ws/trezor-firmware/" + DEFAULT_MANIFEST)
    );
    assert.strictEqual(selection?.folder, firmware);
    assert.strictEqual(selection?.reason, "default-manifest");
  });

  test("picks the first qualifying folder in workspace order", () => {
    const selection = selectWorkspaceFolder(
      [notes, firmware, other],
      existing("/ws/other/tbench.toml", "/ws/trezor-firmware/tbench.toml")
    );
    assert.strictEqual(selection?.folder, firmware);
  });

  test("uses the first folder as fallback when none qualify", () => {
    const selection = selectWorkspaceFolder([notes, firmware], existing());
    assert.strictEqual(selection?.folder, notes);
    assert.strictEqual(selection?.reason, "fallback");
  });

  test("selects a single folder", () => {
    const selection = selectWorkspaceFolder([notes], existing());
    assert.strictEqual(selection?.folder, notes);
  });

  test("returns undefined for empty and undefined folder lists", () => {
    assert.strictEqual(selectWorkspaceFolder([], existing()), undefined);
    assert.strictEqual(selectWorkspaceFolder(undefined, existing()), undefined);
  });

  test("checks presence only and does not read an invalid tbench.toml", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-selection-"));
    try {
      const first = path.join(root, "first");
      const second = path.join(root, "second");
      fs.mkdirSync(first);
      fs.mkdirSync(second);
      fs.writeFileSync(path.join(second, "tbench.toml"), "not = [valid toml");
      const selection = selectWorkspaceFolder([folder(first, 0), folder(second, 1)]);
      assert.strictEqual(selection?.folder.uri.fsPath, second);
      assert.strictEqual(selection?.reason, "repository-config");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

suite("isSameFolder", () => {
  test("compares folders by URI", () => {
    assert.strictEqual(isSameFolder(folder("/ws/a", 0), folder("/ws/a", 3)), true);
    assert.strictEqual(isSameFolder(folder("/ws/a", 0), folder("/ws/b", 0)), false);
  });
});

suite("describeFolderSelectionReason", () => {
  test("describes each reason", () => {
    assert.strictEqual(describeFolderSelectionReason("repository-config"), "tbench.toml found");
    assert.strictEqual(describeFolderSelectionReason("default-manifest"), "default manifest found");
    assert.strictEqual(
      describeFolderSelectionReason("fallback"),
      "no folder qualified; using the first folder"
    );
  });
});
