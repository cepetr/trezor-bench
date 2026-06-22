import * as vscode from "vscode";
import { resolveCargoWorkspacePath } from "../workspace/settings";

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
  return new vscode.ProcessExecution(
    "cargo",
    ["xtask", subcommand, ...args],
    {
      cwd: resolveCargoWorkspacePath(workspaceFolder)
    }
  );
}
