/**
 * Registration for the build-option toggle/select-state commands — the
 * handlers wiring the option persistence in build/build-options.ts to the
 * VS Code command surface. Invoked through the Build Options pane's rows.
 */
import * as vscode from "vscode";
import { writeBuildOption } from "../build/build-options";
import { CommandDeps } from "./command-deps";

/** Registers the checkbox toggle and multistate select commands. */
export function registerBuildOptionCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.toggleBuildOption", async (key: string) => {
      const resolved = deps.getResolvedOptions().find((r) => r.option.key === key);
      if (!resolved || !resolved.available || resolved.option.kind !== "checkbox") {
        return;
      }
      const newValue = resolved.value !== true;
      await writeBuildOption(context, key, newValue);
      deps.refreshResolvedOptionsView();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "tbench.selectBuildOptionState",
      async (key: string, stateId: string) => {
        const resolved = deps.getResolvedOptions().find((r) => r.option.key === key);
        if (!resolved || !resolved.available || resolved.option.kind !== "multistate") {
          return;
        }
        if (!resolved.option.states?.some((s) => s.id === stateId)) {
          return;
        }
        await writeBuildOption(context, key, stateId);
        deps.refreshResolvedOptionsView();
      }
    )
  );
}
