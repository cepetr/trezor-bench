/**
 * Unit tests for folder-list change handling in a multi-root window.
 */
import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  evaluateFolderChange,
  registerFolderChangeWiring,
} from "../../../workspace/folder-change-wiring";
import { FolderSelection } from "../../../workspace/folder-selection";

const DEFAULT_MANIFEST = "core/embed/xtask/tf-tools/manifest.yaml";

function folder(fsPath: string, index: number): vscode.WorkspaceFolder {
  return { uri: vscode.Uri.file(fsPath), name: path.basename(fsPath), index } as vscode.WorkspaceFolder;
}

function existing(...paths: string[]): (fsPath: string) => boolean {
  const known = new Set(paths.map((p) => path.normalize(p)));
  return (fsPath) => known.has(path.normalize(fsPath));
}

suite("evaluateFolderChange", () => {
  const notes = folder("/ws/notes", 0);
  const firmware = folder("/ws/trezor-firmware", 1);
  const other = folder("/ws/other", 2);

  test("is unchanged when a non-qualifying folder is appended", () => {
    const outcome = evaluateFolderChange(
      notes,
      [notes, folder("/ws/extra", 1)],
      existing()
    );
    assert.strictEqual(outcome, "unchanged");
  });

  test("is unchanged when folders are reordered but the same folder is still selected", () => {
    const outcome = evaluateFolderChange(
      firmware,
      [folder("/ws/trezor-firmware", 0), folder("/ws/notes", 1)],
      existing("/ws/trezor-firmware/tbench.toml")
    );
    assert.strictEqual(outcome, "unchanged");
  });

  test("selects the new folder when a qualifying folder is added before a fallback selection", () => {
    const outcome = evaluateFolderChange(
      notes,
      [firmware, notes],
      existing("/ws/trezor-firmware/" + DEFAULT_MANIFEST)
    );
    assert.notStrictEqual(outcome, "unchanged");
    assert.strictEqual((outcome as { next?: FolderSelection }).next?.folder, firmware);
  });

  test("selects a different folder when reordering puts another qualifying folder first", () => {
    const outcome = evaluateFolderChange(
      firmware,
      [other, firmware],
      existing("/ws/other/tbench.toml", "/ws/trezor-firmware/tbench.toml")
    );
    assert.notStrictEqual(outcome, "unchanged");
    assert.strictEqual((outcome as { next?: FolderSelection }).next?.folder, other);
  });

  test("selects another folder when the selected folder is removed", () => {
    const outcome = evaluateFolderChange(firmware, [notes], existing());
    assert.notStrictEqual(outcome, "unchanged");
    assert.strictEqual((outcome as { next?: FolderSelection }).next?.folder, notes);
  });

  test("selects none when the last folder is removed", () => {
    assert.deepStrictEqual(evaluateFolderChange(firmware, [], existing()), { next: undefined });
    assert.deepStrictEqual(evaluateFolderChange(firmware, undefined, existing()), {
      next: undefined,
    });
  });
});

suite("registerFolderChangeWiring", () => {
  const workspaceMock = vscode.workspace as unknown as {
    workspaceFolders: vscode.WorkspaceFolder[] | undefined;
    fireDidChangeWorkspaceFolders(): void;
  };
  let originalFolders: vscode.WorkspaceFolder[] | undefined;
  let subscriptions: vscode.Disposable[];
  let unchanged: number;
  let released: Array<FolderSelection | undefined>;

  const current = folder("/ws/folder-change-current", 0);

  setup(() => {
    originalFolders = workspaceMock.workspaceFolders;
    subscriptions = [];
    unchanged = 0;
    released = [];
    registerFolderChangeWiring(
      { subscriptions } as unknown as vscode.ExtensionContext,
      current,
      {
        onUnchanged: () => unchanged++,
        onRelease: (next) => released.push(next),
      }
    );
  });

  teardown(() => {
    workspaceMock.workspaceFolders = originalFolders;
    subscriptions.forEach((subscription) => subscription.dispose());
  });

  test("calls onUnchanged when the same folder is still selected", () => {
    workspaceMock.workspaceFolders = [current, folder("/ws/folder-change-extra", 1)];
    workspaceMock.fireDidChangeWorkspaceFolders();

    assert.strictEqual(unchanged, 1);
    assert.strictEqual(released.length, 0);
  });

  test("calls onRelease exactly once and ignores later events", () => {
    workspaceMock.workspaceFolders = [];
    workspaceMock.fireDidChangeWorkspaceFolders();
    workspaceMock.workspaceFolders = [current];
    workspaceMock.fireDidChangeWorkspaceFolders();
    workspaceMock.fireDidChangeWorkspaceFolders();

    assert.deepStrictEqual(released, [undefined]);
    assert.strictEqual(unchanged, 0);
  });
});
