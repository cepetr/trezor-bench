import * as assert from "assert";
import {
  initLogChannel,
  log,
  logArtifactActionBlocked,
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
      logWorkflowFailure("Build", "manifest file (tf-tools.yaml) was not found");
      logArtifactActionBlocked("Flash", "manifest file is missing");
    });
  });

  test("logManifestState covers missing and invalid states", () => {
    const manifestUri = { fsPath: "/workspace/tf-tools.yaml" } as import("vscode").Uri;

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
});
