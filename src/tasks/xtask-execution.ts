/**
 * Process execution for `cargo xtask`: spawns the command directly so
 * login-shell startup files cannot alter the inherited environment.
 */
import * as vscode from "vscode";
import { readTaskExtraEnv, resolveCargoWorkspacePath } from "../workspace/settings";

/**
 * Creates a `ProcessExecution` for `cargo xtask`.
 *
 * Uses a direct process spawn instead of `ShellExecution` so login-shell
 * startup files cannot rebuild PATH without the active venv.
 */
export function createCargoTaskExecution(
  subcommand: string,
  args: ReadonlyArray<string>,
  workspaceFolder: vscode.WorkspaceFolder
): vscode.ProcessExecution {
  const options: vscode.ProcessExecutionOptions = {
    cwd: resolveCargoWorkspacePath(workspaceFolder),
  };
  const extraEnv = readTaskExtraEnv(workspaceFolder);
  if (Object.keys(extraEnv).length > 0) {
    options.env = { ...extraEnv };
  }
  return new vscode.ProcessExecution("cargo", ["xtask", subcommand, ...args], options);
}
