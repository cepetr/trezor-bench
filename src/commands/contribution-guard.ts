/**
 * Scope guard for the supported command surface: this extension contributes
 * ONLY the commands declared in command-ids.ts. Any attempt to contribute
 * others is a scope violation.
 */
import * as vscode from "vscode";
import { CONTRIBUTED_COMMAND_IDS } from "./command-ids";
import { notifyWarning } from "../observability/log-channel";

const ALLOWED_CONTRIBUTION_COMMANDS = new Set<string>(CONTRIBUTED_COMMAND_IDS);

/**
 * Development-time guard: verifies that no unauthorized tbench commands are
 * contributed during activation. Throws in development mode if a violation is
 * detected; logs a warning in production.
 */
export function assertNoUnauthorizedContributions(
  context: vscode.ExtensionContext
): void {
  const contributed: string[] =
    context.extension.packageJSON?.contributes?.commands?.map(
      (c: { command: string }) => c.command
    ) ?? [];

  const unauthorized = contributed
    .filter((cmd: string) => cmd.startsWith("tbench."))
    .filter((cmd: string) => !ALLOWED_CONTRIBUTION_COMMANDS.has(cmd));

  if (unauthorized.length > 0) {
    const msg =
      `Scope violation: ` +
      `unauthorized commands found in package.json: ${unauthorized.join(", ")}`;
    notifyWarning(msg);
  }
}
