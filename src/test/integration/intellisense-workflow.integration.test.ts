/**
 * Integration tests for `Refresh IntelliSense` command contribution and execution.
 * Runs inside the VS Code extension host via @vscode/test-electron.
 *
 * Covers:
 *  - The `tbench.refreshIntelliSense` command is registered after extension activation
 *  - Invoking the command resolves without throwing
 *  - IntelliSenseService scheduleRefresh via the "manual" trigger works end-to-end
 */

import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { IntelliSenseService } from "../../intellisense/intellisense-service";
import { ManifestStateLoaded } from "../../manifest/manifest-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Waits for the pending refresh chain to drain. */
function drainRefresh(ms = 80): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ensure the tbench extension is activated before running command tests. */
async function activateExtension(): Promise<boolean> {
  const ext = vscode.extensions.getExtension("cepetr.tbench");
  if (!ext) {
    return false;
  }
  if (!ext.isActive) {
    await ext.activate();
  }
  return ext.isActive;
}

// ---------------------------------------------------------------------------
// Suite: tbench.refreshIntelliSense command
// ---------------------------------------------------------------------------

suite("tbench.refreshIntelliSense – command registration and execution", () => {
  test("extension cepetr.tbench is available in development host", async () => {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    assert.ok(ext, "expected cepetr.tbench extension to be available in the test host");
  });

  test("extension activates without error", async () => {
    const activated = await activateExtension();
    assert.strictEqual(activated, true, "expected extension to activate");
  });

  test("tbench.refreshIntelliSense is registered as a VS Code command", async () => {
    await activateExtension();
    const cmds = await vscode.commands.getCommands(/* filterInternal */ false);
    assert.ok(
      cmds.includes("tbench.refreshIntelliSense"),
      "expected 'tbench.refreshIntelliSense' to be registered in VS Code commands"
    );
  });

  test("executing tbench.refreshIntelliSense resolves without throwing", async () => {
    await activateExtension();
    let threw = false;
    try {
      await vscode.commands.executeCommand("tbench.refreshIntelliSense");
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, false, "expected executeCommand to resolve without error");
  });

  test("other tbench commands are also registered after activation", async () => {
    await activateExtension();
    const cmds = await vscode.commands.getCommands(false);
    const requiredCmds = ["tbench.build", "tbench.clippy", "tbench.check", "tbench.clean", "tbench.showLogs"];
    for (const cmd of requiredCmds) {
      assert.ok(cmds.includes(cmd), `expected '${cmd}' to be registered`);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: IntelliSenseService with "manual" trigger (equivalent to command)
// ---------------------------------------------------------------------------

suite("IntelliSenseService – manual refresh trigger", () => {
  /** Yields to the microtask queue to let pending refresh resolve. */
  function drainMicrotasks(): Promise<void> {
    return drainRefresh(50);
  }

  function makeManifest(): ManifestStateLoaded {
    return {
      status: "loaded",
      manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
      models: [{ kind: "model", id: "model-t2t1", name: "T2T1", artifactFolder: "artifacts-t2t1" }],
      targets: [{ kind: "target", id: "hw", name: "Hardware", shortName: "HW" }],
      components: [{ kind: "component", id: "component-core", name: "Core", artifactName: "cc-core" }],
      buildOptions: [],
      hasWorkflowBlockingIssues: false,
      hasDebugBlockingIssues: false,
      validationIssues: [],
      loadedAt: new Date(),
    };
  }

  test("scheduleRefresh('manual-refresh') populates getLastReadiness", async () => {
    const svc = new IntelliSenseService();
    svc.scheduleRefresh("manual-refresh");
    await drainMicrotasks();
    assert.ok(svc.getLastReadiness() !== null, "expected readiness after manual refresh");
  });

  test("scheduleRefresh('manual-refresh') fires onDidRefresh event", async () => {
    const svc = new IntelliSenseService();
    let firedWith: [unknown, unknown] | null = null;
    svc.onDidRefresh(([artifact, readiness]) => {
      firedWith = [artifact, readiness];
    });
    svc.scheduleRefresh("manual-refresh");
    await drainMicrotasks();
    assert.ok(firedWith !== null, "expected onDidRefresh to fire on manual refresh");
  });

  test("manual refresh after config change produces consistent readiness", async () => {
    const svc = new IntelliSenseService();
    svc.setManifest(makeManifest());
    svc.setBuildContext({ modelId: "model-t2t1", targetId: "hw", componentId: "component-core" });
    svc.setArtifactsRoot(path.join(__dirname, "../../../../test-fixtures/workspaces/intellisense-missing-artifact"));

    svc.scheduleRefresh("build-selection-change");
    await drainMicrotasks();
    const afterConfig = svc.getLastReadiness();

    svc.scheduleRefresh("manual-refresh");
    await drainMicrotasks();
    const afterManual = svc.getLastReadiness();

    assert.ok(afterConfig !== null, "expected readiness after config-change");
    assert.ok(afterManual !== null, "expected readiness after manual");
    // Both should see the same provider state
    assert.strictEqual(afterManual!.warningState, afterConfig!.warningState);
  });

  test("manual refresh after artifacts path cleared shows null artifact", async () => {
    const svc = new IntelliSenseService();
    svc.setManifest(makeManifest());
    svc.setBuildContext({ modelId: "model-t2t1", targetId: "hw", componentId: "component-core" });
    svc.setArtifactsRoot(""); // Cleared path

    svc.scheduleRefresh("manual-refresh");
    await drainMicrotasks();

    // With empty artifactsRoot, no valid inputs — artifact should be null or missing
    const artifact = svc.getLastArtifact();
    // Either null (no context resolved) or status "missing" — both are acceptable
    if (artifact !== null) {
      assert.strictEqual(artifact.status, "missing");
    }
  });
});
