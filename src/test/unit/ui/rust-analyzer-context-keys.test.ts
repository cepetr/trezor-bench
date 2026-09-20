import * as assert from "assert";
import * as vscode from "vscode";
import { updateRustAnalyzerModeContext } from "../../../ui/context-keys";

suite("updateRustAnalyzerModeContext", () => {
  const commands = vscode.commands as unknown as {
    executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
  };
  const originalExecuteCommand = commands.executeCommand;

  teardown(() => {
    commands.executeCommand = originalExecuteCommand;
  });

  test("publishes exactly one selected mode", async () => {
    const calls: unknown[][] = [];
    commands.executeCommand = async (...args: unknown[]) => {
      calls.push(args);
    };

    updateRustAnalyzerModeContext("model-specific");
    await Promise.resolve();

    assert.deepStrictEqual(calls, [
      ["setContext", "tbench.rustAnalyzerModelSpecific", true],
      ["setContext", "tbench.rustAnalyzerAllFeatures", false],
    ]);
  });
});