import * as assert from "assert";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import * as vscode from "vscode";
import { createRustAnalyzerRunner, SpawnRustAnalyzerProcess } from "../../../rust-analyzer/config-runner";

const WORKSPACE_FOLDER = {
  uri: vscode.Uri.file("/workspace"),
  name: "workspace",
  index: 0,
} as vscode.WorkspaceFolder;

interface FakeProcess extends EventEmitter {
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  killCalls: number;
  kill(): boolean;
}

function makeProcess(): FakeProcess {
  const process = new EventEmitter() as FakeProcess;
  Object.assign(process, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killCalls: 0,
    kill(): boolean {
      process.killCalls += 1;
      return true;
    },
  });
  return process;
}

suite("createRustAnalyzerRunner", () => {
  const originalGetConfiguration = vscode.workspace.getConfiguration;

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test("uses the Cargo workspace and merges task environment while capturing output", async () => {
    vscode.workspace.getConfiguration = () => ({
      get: (key: string) => (key === "taskExtraEnv" ? { EXTRA: "enabled" } : undefined),
      update: () => Promise.resolve(),
      has: () => true,
      inspect: () => undefined,
    });
    const process = makeProcess();
    const calls: Array<{ command: string; args: readonly string[]; cwd?: string; env?: NodeJS.ProcessEnv }> = [];
    const spawn: SpawnRustAnalyzerProcess = (command, args, options) => {
      calls.push({ command, args, cwd: options.cwd, env: options.env });
      return process;
    };

    const run = createRustAnalyzerRunner(WORKSPACE_FOLDER, spawn).run(["-m", "T2T1"]);
    process.stdout.end("[cargo]\nfeatures = [\"model-t\"]\n");
    process.stderr.end("generator note\n");
    process.emit("close", 0);

    assert.deepStrictEqual(await run.result, {
      stdout: "[cargo]\nfeatures = [\"model-t\"]\n",
      stderr: "generator note\n",
      exitCode: 0,
      cancelled: false,
    });
    assert.deepStrictEqual(calls[0].args, ["xtask", "generate-rust-analyzer-config", "-m", "T2T1"]);
    assert.strictEqual(calls[0].command, "cargo");
    assert.strictEqual(calls[0].cwd, "/workspace/core/embed");
    assert.strictEqual(calls[0].env?.EXTRA, "enabled");
  });

  test("records nonzero exit status and cancels the child process", async () => {
    const process = makeProcess();
    const spawn: SpawnRustAnalyzerProcess = () => process;
    const run = createRustAnalyzerRunner(WORKSPACE_FOLDER, spawn).run([]);

    run.cancel();
    process.emit("close", 1);

    assert.strictEqual(process.killCalls, 1);
    assert.deepStrictEqual(await run.result, {
      stdout: "",
      stderr: "",
      exitCode: 1,
      cancelled: true,
    });
  });
});