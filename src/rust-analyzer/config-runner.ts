import { spawn } from "child_process";
import { EventEmitter } from "events";
import * as vscode from "vscode";
import { RustAnalyzerRun, RustAnalyzerRunResult, RustAnalyzerRunner } from "./config-types";
import { resolveCargoWorkspacePath } from "../workspace/repository-config";
import { readTaskExtraEnv } from "../workspace/settings";

export interface RustAnalyzerChildProcess extends EventEmitter {
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type SpawnRustAnalyzerProcess = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
) => RustAnalyzerChildProcess;

export function createRustAnalyzerRunner(
  workspaceFolder: vscode.WorkspaceFolder,
  spawnProcess: SpawnRustAnalyzerProcess = spawn
): RustAnalyzerRunner {
  const cwd = resolveCargoWorkspacePath(workspaceFolder);
  const env = { ...process.env, ...readTaskExtraEnv(workspaceFolder) };

  return {
    run(args: readonly string[]): RustAnalyzerRun {
      const child = spawnProcess("cargo", ["xtask", "generate-rust-analyzer-config", ...args], { cwd, env });
      let cancelled = false;
      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      const result = new Promise<RustAnalyzerRunResult>((resolve) => {
        child.once("error", () => {
          resolve({ stdout, stderr, exitCode: null, cancelled });
        });
        child.once("close", (exitCode: number | null) => {
          resolve({ stdout, stderr, exitCode, cancelled });
        });
      });

      return {
        result,
        cancel: () => {
          cancelled = true;
          child.kill();
        },
      };
    },
  };
}