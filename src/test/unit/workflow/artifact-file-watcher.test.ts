import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import {
  ActiveArtifactFileWatcher,
  FileSystemWatcherLike,
  resolveArtifactWatchScopes,
} from "../../../intellisense/artifact-file-watcher";
import { ActiveConfig } from "../../../configuration/active-config";
import {
  makeDebugLoadedState,
  makeDebugTargetWithExtension,
} from "../workflow-test-helpers";

class FakeWatcher implements FileSystemWatcherLike {
  private readonly _createListeners: Array<(uri: vscode.Uri) => void> = [];
  private readonly _changeListeners: Array<(uri: vscode.Uri) => void> = [];
  private readonly _deleteListeners: Array<(uri: vscode.Uri) => void> = [];
  public disposed = false;

  onDidCreate(listener: (uri: vscode.Uri) => void): vscode.Disposable {
    this._createListeners.push(listener);
    return { dispose: () => {} };
  }

  onDidChange(listener: (uri: vscode.Uri) => void): vscode.Disposable {
    this._changeListeners.push(listener);
    return { dispose: () => {} };
  }

  onDidDelete(listener: (uri: vscode.Uri) => void): vscode.Disposable {
    this._deleteListeners.push(listener);
    return { dispose: () => {} };
  }

  emitCreate(filePath: string): void {
    const uri = vscode.Uri.file(filePath);
    for (const listener of this._createListeners) {
      listener(uri);
    }
  }

  emitChange(filePath: string): void {
    const uri = vscode.Uri.file(filePath);
    for (const listener of this._changeListeners) {
      listener(uri);
    }
  }

  emitDelete(filePath: string): void {
    const uri = vscode.Uri.file(filePath);
    for (const listener of this._deleteListeners) {
      listener(uri);
    }
  }

  dispose(): void {
    this.disposed = true;
  }
}

function makeConfig(overrides: Partial<ActiveConfig> = {}): ActiveConfig {
  return {
    modelId: "model-a",
    targetId: "target-a",
    componentId: "component-a",
    persistedAt: "2026-04-11T00:00:00Z",
    ...overrides,
  };
}

function makeManifest() {
  return makeDebugLoadedState(
    [
      {
        id: "component-a:debug[0]",
        componentId: "component-a",
        name: "Primary",
        template: "gdb-remote.json",
        declarationIndex: 0,
      },
    ],
    {
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
    }
  );
}

function makeSecondManifest() {
  return makeDebugLoadedState(
    [
      {
        id: "component-b:debug[0]",
        componentId: "component-b",
        name: "Secondary",
        template: "gdb-remote.json",
        declarationIndex: 0,
      },
    ],
    {
      models: [
        {
          kind: "model",
          id: "model-b",
          name: "Model B",
          artifactFolder: "model-b-out",
        } as ReturnType<typeof makeDebugLoadedState>["models"][0],
      ],
      targets: [makeDebugTargetWithExtension("target-b", ".elf", "-target-b")],
      components: [
        {
          kind: "component",
          id: "component-b",
          name: "Component B",
          artifactName: "component-b",
        } as ReturnType<typeof makeDebugLoadedState>["components"][0],
      ],
    }
  );
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

suite("ActiveArtifactFileWatcher", () => {
  test("resolveArtifactWatchScopes watches the parent of the artifacts root", () => {
    const scopes = resolveArtifactWatchScopes(
      makeManifest(),
      makeConfig(),
      path.join("/tmp", "artifacts")
    );

    assert.strictEqual(scopes.length, 1);
    assert.strictEqual(scopes[0].folderPath, "/tmp");
    assert.deepStrictEqual(Array.from(scopes[0].relativePaths).sort(), [
      path.join("artifacts", "model-a-out", "component-a-target-a.bin"),
      path.join("artifacts", "model-a-out", "component-a-target-a.cc.json"),
      path.join("artifacts", "model-a-out", "component-a-target-a.elf"),
      path.join("artifacts", "model-a-out", "component-a-target-a.map"),
    ]);
  });

  test("refreshes when a watched artifact file changes", async () => {
    const createdWatchers: FakeWatcher[] = [];
    let refreshCount = 0;

    const watcher = new ActiveArtifactFileWatcher(
      () => {
        refreshCount++;
      },
      () => {
        const fakeWatcher = new FakeWatcher();
        createdWatchers.push(fakeWatcher);
        return fakeWatcher;
      }
    );

    watcher.update(makeManifest(), makeConfig(), path.join("/tmp", "artifacts"));
    createdWatchers[0].emitChange(
      path.join("/tmp", "artifacts", "model-a-out", "component-a-target-a.cc.json")
    );
    await flushMicrotasks();

    assert.strictEqual(refreshCount, 1);
    watcher.dispose();
  });

  test("ignores unrelated files in the watched folder", async () => {
    const createdWatchers: FakeWatcher[] = [];
    let refreshCount = 0;

    const watcher = new ActiveArtifactFileWatcher(
      () => {
        refreshCount++;
      },
      () => {
        const fakeWatcher = new FakeWatcher();
        createdWatchers.push(fakeWatcher);
        return fakeWatcher;
      }
    );

    watcher.update(makeManifest(), makeConfig(), path.join("/tmp", "artifacts"));
    createdWatchers[0].emitCreate(
      path.join("/tmp", "artifacts", "model-a-out", "notes.txt")
    );
    await flushMicrotasks();

    assert.strictEqual(refreshCount, 0);
    watcher.dispose();
  });

  test("replaces stale watchers when the active config changes", () => {
    const createdWatchers: FakeWatcher[] = [];

    const watcher = new ActiveArtifactFileWatcher(
      () => {
        return;
      },
      () => {
        const fakeWatcher = new FakeWatcher();
        createdWatchers.push(fakeWatcher);
        return fakeWatcher;
      }
    );

    watcher.update(makeManifest(), makeConfig(), path.join("/tmp", "artifacts"));
    watcher.update(
      makeSecondManifest(),
      makeConfig({ modelId: "model-b", targetId: "target-b", componentId: "component-b" }),
      path.join("/tmp", "artifacts")
    );

    assert.strictEqual(createdWatchers.length, 8);
    assert.ok(createdWatchers.slice(0, 4).every((watcher) => watcher.disposed));
    assert.ok(createdWatchers.slice(4).every((watcher) => !watcher.disposed));
    watcher.dispose();
  });

  test("refreshes when an artifact file is recreated after its model folder is removed", async () => {
    const createdWatchers: FakeWatcher[] = [];
    let refreshCount = 0;

    const watcher = new ActiveArtifactFileWatcher(
      () => {
        refreshCount++;
      },
      () => {
        const fakeWatcher = new FakeWatcher();
        createdWatchers.push(fakeWatcher);
        return fakeWatcher;
      }
    );

    watcher.update(makeManifest(), makeConfig(), path.join("/tmp", "artifacts"));
    createdWatchers[0].emitCreate(
      path.join("/tmp", "artifacts", "model-a-out", "component-a-target-a.bin")
    );
    await flushMicrotasks();

    assert.strictEqual(refreshCount, 1);
    watcher.dispose();
  });

  test("coalesces multiple relevant file events in the same turn", async () => {
    const createdWatchers: FakeWatcher[] = [];
    let refreshCount = 0;

    const watcher = new ActiveArtifactFileWatcher(
      () => {
        refreshCount++;
      },
      () => {
        const fakeWatcher = new FakeWatcher();
        createdWatchers.push(fakeWatcher);
        return fakeWatcher;
      }
    );

    watcher.update(makeManifest(), makeConfig(), path.join("/tmp", "artifacts"));
    createdWatchers[0].emitCreate(
      path.join("/tmp", "artifacts", "model-a-out", "component-a-target-a.cc.json")
    );
    createdWatchers[0].emitDelete(
      path.join("/tmp", "artifacts", "model-a-out", "component-a-target-a.bin")
    );
    await flushMicrotasks();

    assert.strictEqual(refreshCount, 1);
    watcher.dispose();
  });
});