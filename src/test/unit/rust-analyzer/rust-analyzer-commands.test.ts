import * as assert from "assert";
import * as vscode from "vscode";
import { registerRustAnalyzerCommands } from "../../../commands/rust-analyzer-commands";

suite("registerRustAnalyzerCommands", () => {
  const commands = vscode.commands as unknown as {
    registerCommand(id: string, handler: () => void): vscode.Disposable;
  };
  const originalRegisterCommand = commands.registerCommand;

  teardown(() => {
    commands.registerCommand = originalRegisterCommand;
  });

  test("registers both mode commands and refreshes after selection", async () => {
    const handlers = new Map<string, () => void>();
    const selected: string[] = [];
    let refreshes = 0;
    commands.registerCommand = (id, handler) => {
      handlers.set(id, handler);
      return { dispose: () => {} };
    };
    const context = { subscriptions: [] as vscode.Disposable[] } as unknown as vscode.ExtensionContext;
    const service = {
      selectMode: async (mode: string) => { selected.push(mode); },
      refresh: async () => { refreshes += 1; },
    };

    registerRustAnalyzerCommands(context, service as never);
    handlers.get("tbench.rustAnalyzer.modelSpecific")?.();
    handlers.get("tbench.rustAnalyzer.allFeatures")?.();
    await Promise.resolve();
    await Promise.resolve();

    assert.deepStrictEqual(selected, ["model-specific", "all-features"]);
    assert.strictEqual(refreshes, 2);
  });
});