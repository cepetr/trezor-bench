import * as assert from "assert";
import {
  initLogChannel,
  log,
  logArtifactActionBlocked,
  logRustAnalyzerConflicts,
  logManifestState,
  logWorkflowFailure,
  disposeLogChannel,
} from "../../../observability/log-channel";

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
});
