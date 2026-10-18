import * as assert from "assert";
import {
  initLogChannel,
  log,
  logArtifactActionBlocked,
  logRustAnalyzerConflicts,
  logRustAnalyzerFailure,
  logManifestState,
  logWorkflowFailure,
  disposeLogChannel,
  logFolderSelection,
  logFolderSelectionChange,
} from "../../../observability/log-channel";
import * as vscode from "vscode";

suite("log-channel", () => {
  teardown(() => {
    disposeLogChannel();
  });

  test("initLogChannel and log helpers run without throwing", () => {
    assert.doesNotThrow(() => {
      initLogChannel();
      log("test message");
      logWorkflowFailure("Build", "manifest file (tbench.yaml) was not found");
      logArtifactActionBlocked("Flash", "manifest file is missing");
    });
  });

  test("logManifestState covers missing and invalid states", () => {
    const manifestUri = { fsPath: "/workspace/tbench.yaml" } as import("vscode").Uri;

    assert.doesNotThrow(() => {
      logManifestState({ status: "missing", manifestUri });
      logManifestState({
        status: "invalid",
        manifestUri,
        validationIssues: [
          {
            severity: "error",
            code: "yaml-parse",
            message: "Unexpected token",
          },
        ],
        loadedAt: new Date(),
      });
    });
  });

  test("reports Rust Analyzer setting conflicts without throwing", () => {
    assert.doesNotThrow(() => {
      logRustAnalyzerConflicts([{
        key: "cargo.features",
        values: [{ scope: "workspace", value: ["authored"] }],
      }]);
    });
  });

  test("reports Rust Analyzer refresh failures with context without throwing", () => {
    assert.doesNotThrow(() => {
      logRustAnalyzerFailure({
        stage: "generation",
        message: "generator failed",
        inputs: {
          modelId: "T2T1",
          targetId: "hardware",
          emulator: false,
          presetId: "release",
          effectiveFlags: ["--usb"],
        },
        stderr: "cargo failed",
      });
    });
  });

  suite("folder selection lines", () => {
    const windowMock = vscode.window as unknown as {
      createOutputChannel: (name: string) => unknown;
    };
    let originalCreate: typeof windowMock.createOutputChannel;
    let lines: string[];

    const folder = (fsPath: string) =>
      ({ uri: vscode.Uri.file(fsPath), name: "f", index: 0 }) as vscode.WorkspaceFolder;

    setup(() => {
      originalCreate = windowMock.createOutputChannel;
      lines = [];
      windowMock.createOutputChannel = () => ({
        appendLine: (line: string) => lines.push(line),
        show: () => {},
        dispose: () => {},
      });
    });

    teardown(() => {
      disposeLogChannel();
      windowMock.createOutputChannel = originalCreate;
    });

    test("logFolderSelection writes the folder and the reason", () => {
      logFolderSelection({ folder: folder("/ws/fw"), reason: "repository-config" });
      logFolderSelection({ folder: folder("/ws/fw"), reason: "default-manifest" });
      logFolderSelection({ folder: folder("/ws/notes"), reason: "fallback" });

      assert.ok(lines[0].endsWith("Selected workspace folder: /ws/fw — tbench.toml found"));
      assert.ok(lines[1].endsWith("Selected workspace folder: /ws/fw — default manifest found"));
      assert.ok(
        lines[2].endsWith(
          "Selected workspace folder: /ws/notes — no folder qualified; using the first folder"
        )
      );
    });

    test("logFolderSelectionChange writes the previous and the new folder", () => {
      logFolderSelectionChange(folder("/ws/notes"), {
        folder: folder("/ws/fw"),
        reason: "repository-config",
      });
      logFolderSelectionChange(folder("/ws/fw"), undefined);

      assert.ok(
        lines[0].endsWith(
          "Workspace folder selection changed: /ws/notes → /ws/fw — tbench.toml found; reload the window to continue."
        )
      );
      assert.ok(
        lines[1].endsWith(
          "Workspace folder selection changed: /ws/fw → none; reload the window to continue."
        )
      );
    });
  });
});
