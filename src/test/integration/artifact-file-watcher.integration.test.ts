import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ActiveBuildContext } from "../../configuration/active-build-context";
import {
  ActiveArtifactFileWatcher,
  FileSystemWatcherLike,
  resolveArtifactWatchScopes,
} from "../../intellisense/artifact-file-watcher";
import {
  makeDebugLoadedState,
  makeDebugTargetWithExtension,
} from "../unit/workflow-test-helpers";

function makeManifest() {
  return makeDebugLoadedState([], {
    models: [
      {
        kind: "model",
        id: "model-a",
        name: "Model A",
        artifactFolder: "model-a-out",
      } as ReturnType<typeof makeDebugLoadedState>["models"][0],
    ],
    targets: [makeDebugTargetWithExtension("target-a", ".elf", "-target-a")],
    components: [
      {
        kind: "component",
        id: "component-a",
        name: "Component A",
        artifactName: "component-a",
      } as ReturnType<typeof makeDebugLoadedState>["components"][0],
    ],
  });
}

const activeBuildContext: ActiveBuildContext = {
  modelId: "model-a",
  targetId: "target-a",
  componentId: "component-a",
  persistedAt: "2026-07-19T00:00:00Z",
};

function noOpWatcher(): FileSystemWatcherLike {
  return {
    onDidCreate: () => ({ dispose: () => {} }),
    onDidChange: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    dispose: () => {},
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for external artifact refresh");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

suite("Artifact file watcher", () => {
  test("watches the parent of the artifacts root for externally recreated artifacts", () => {
    const artifactsRoot = path.join("/tmp", "tbench-artifacts");
    const scopes = resolveArtifactWatchScopes(makeManifest(), activeBuildContext, artifactsRoot);

    assert.strictEqual(scopes.length, 1);
    assert.strictEqual(scopes[0].folderPath, path.dirname(artifactsRoot));
    assert.ok(
      scopes[0].relativePaths.has(
        path.join("tbench-artifacts", "model-a-out", "component-a-target-a.bin")
      )
    );
  });

  test("watches only the expected artifact paths", () => {
    const patterns: vscode.GlobPattern[] = [];
    const watcher = new ActiveArtifactFileWatcher(
      () => {},
      (pattern) => {
        patterns.push(pattern);
        return noOpWatcher();
      }
    );

    try {
      watcher.update(makeManifest(), activeBuildContext, path.join("/tmp", "artifacts"));

      assert.deepStrictEqual(
        patterns.map((pattern) => (pattern as vscode.RelativePattern).pattern).sort(),
        [
          path.join("artifacts", "model-a-out", "component-a-target-a.bin"),
          path.join("artifacts", "model-a-out", "component-a-target-a.cc.json"),
          path.join("artifacts", "model-a-out", "component-a-target-a.map"),
        ]
      );
    } finally {
      watcher.dispose();
    }
  });

  test("refreshes when an external process creates an expected artifact without a watcher event", async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-artifacts-"));
    const artifactsRoot = path.join(temporaryRoot, "artifacts");
    let refreshCount = 0;
    const watcher = new ActiveArtifactFileWatcher(
      () => {
        refreshCount++;
      },
      () => noOpWatcher(),
      10
    );

    try {
      watcher.update(makeManifest(), activeBuildContext, artifactsRoot);
      const binaryPath = path.join(
        artifactsRoot,
        "model-a-out",
        "component-a-target-a.bin"
      );
      fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
      fs.writeFileSync(binaryPath, "external build output");

      await waitFor(() => refreshCount === 1);
    } finally {
      watcher.dispose();
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});