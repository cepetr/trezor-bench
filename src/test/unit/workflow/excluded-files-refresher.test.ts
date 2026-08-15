import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { ExcludedFilesService, normalizeToForwardSlashes } from "../../../intellisense/excluded-files-service";
import { ExcludedFilesRefresher } from "../../../intellisense/excluded-files-refresh";
import { ProviderPayload, ParsedCompileEntry } from "../../../intellisense/intellisense-types";
import {
  excludedFilesScopeWorkspaceRoot,
  makeExcludedFilesSettings,
} from "../workflow-test-helpers";

function absPath(...parts: string[]): string {
  return normalizeToForwardSlashes(path.join(excludedFilesScopeWorkspaceRoot(), ...parts));
}

function makeWorkspaceFolder(): vscode.WorkspaceFolder {
  return {
    uri: vscode.Uri.file(excludedFilesScopeWorkspaceRoot()),
    name: "excluded-files-scope",
    index: 0,
  } as vscode.WorkspaceFolder;
}

function makeEntry(filePath: string): ParsedCompileEntry {
  return {
    filePath,
    directory: path.dirname(filePath),
    compilerPath: "clang",
    arguments: [],
    includePaths: [],
    defines: [],
    forcedIncludes: [],
    languageFamily: "c",
    standard: undefined,
    rawIndex: 0,
  };
}

function makePayload(contextKey: string, artifactPath: string, includedPaths: string[]): ProviderPayload {
  return {
    artifactPath,
    contextKey,
    entriesByFile: new Map(includedPaths.map((filePath) => [filePath, makeEntry(filePath)])),
    browseSnapshot: {
      browsePaths: [],
      compilerPath: undefined,
      compilerArgs: [],
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

suite("ExcludedFilesRefresher", () => {
  test("drops stale async recompute results when a newer payload arrives", async () => {
    const svc = new ExcludedFilesService();
    const settings = makeExcludedFilesSettings({
      fileNamePatterns: ["*.c"],
      folderGlobs: ["core/embed/**"],
    });
    const candidateUris = [
      vscode.Uri.file(path.join(excludedFilesScopeWorkspaceRoot(), "core/embed/main.c")),
      vscode.Uri.file(path.join(excludedFilesScopeWorkspaceRoot(), "core/embed/other.c")),
    ];

    const firstCandidates = deferred<ReadonlyArray<vscode.Uri>>();
    const secondCandidates = deferred<ReadonlyArray<vscode.Uri>>();
    let callCount = 0;

    const refresher = new ExcludedFilesRefresher(
      svc,
      makeWorkspaceFolder(),
      () => settings,
      async () => {
        callCount++;
        return callCount === 1 ? firstCandidates.promise : secondCandidates.promise;
      }
    );

    const payloadA = makePayload(
      "T2T1/hw/core",
      "/artifact-a.json",
      [absPath("core/embed/main.c")]
    );
    const payloadB = makePayload(
      "T3W1/hw/core",
      "/artifact-b.json",
      [absPath("core/embed/main.c"), absPath("core/embed/other.c")]
    );

    refresher.handlePayload(payloadA);
    refresher.handlePayload(payloadB);

    secondCandidates.resolve(candidateUris);
    await flushAsyncWork();

    let snapshot = svc.getSnapshot();
    assert.strictEqual(snapshot.contextKey, "T3W1/hw/core");
    assert.strictEqual(snapshot.excludedFiles.size, 0, "newer payload should produce no exclusions");

    firstCandidates.resolve(candidateUris);
    await flushAsyncWork();

    snapshot = svc.getSnapshot();
    assert.strictEqual(snapshot.contextKey, "T3W1/hw/core", "older async work must not overwrite the latest context");
    assert.strictEqual(snapshot.excludedFiles.size, 0, "older async work must be dropped instead of restoring stale exclusions");

    refresher.dispose();
    svc.dispose();
  });

  test("null payload clears state and invalidates any pending recompute", async () => {
    const svc = new ExcludedFilesService();
    const settings = makeExcludedFilesSettings({
      fileNamePatterns: ["*.c"],
      folderGlobs: ["core/embed/**"],
    });
    const candidateUris = [
      vscode.Uri.file(path.join(excludedFilesScopeWorkspaceRoot(), "core/embed/main.c")),
      vscode.Uri.file(path.join(excludedFilesScopeWorkspaceRoot(), "core/embed/other.c")),
    ];

    const pendingCandidates = deferred<ReadonlyArray<vscode.Uri>>();
    const refresher = new ExcludedFilesRefresher(
      svc,
      makeWorkspaceFolder(),
      () => settings,
      async () => pendingCandidates.promise
    );

    const payload = makePayload(
      "T2T1/hw/core",
      "/artifact-a.json",
      [absPath("core/embed/main.c")]
    );

    refresher.handlePayload(payload);
    refresher.handlePayload(null);

    let snapshot = svc.getSnapshot();
    assert.strictEqual(snapshot.artifactPath, null, "null payload should clear immediately");

    pendingCandidates.resolve(candidateUris);
    await flushAsyncWork();

    snapshot = svc.getSnapshot();
    assert.strictEqual(snapshot.artifactPath, null, "late async work must not restore a cleared payload");
    assert.strictEqual(snapshot.excludedFiles.size, 0, "late async work must not restore stale exclusions after clear");

    refresher.dispose();
    svc.dispose();
  });
});