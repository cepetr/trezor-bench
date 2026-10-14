import * as assert from "assert";
import * as vscode from "vscode";
import { registerRustAnalyzerCommands } from "../../../commands/rust-analyzer-commands";

interface ModeItem {
  readonly label: string;
  readonly description?: string;
  readonly mode: string;
}

suite("registerRustAnalyzerCommands", () => {
  const commands = vscode.commands as unknown as {
    registerCommand(id: string, handler: () => Promise<void>): vscode.Disposable;
  };
  const window = vscode.window as unknown as {
    showQuickPick(items: readonly ModeItem[]): Promise<ModeItem | undefined>;
  };
  const originalRegisterCommand = commands.registerCommand;
  const originalShowQuickPick = window.showQuickPick;

  teardown(() => {
    commands.registerCommand = originalRegisterCommand;
    window.showQuickPick = originalShowQuickPick;
  });

  function setup(mode: string, pick: (items: readonly ModeItem[]) => ModeItem | undefined) {
    const handlers = new Map<string, () => Promise<void>>();
    const shown: ModeItem[][] = [];
    const calls: string[] = [];
    commands.registerCommand = (id, handler) => {
      handlers.set(id, handler);
      return { dispose: () => {} };
    };
    window.showQuickPick = async (items) => {
      shown.push([...items]);
      return pick(items);
    };
    const context = { subscriptions: [] as vscode.Disposable[] } as unknown as vscode.ExtensionContext;
    const service = {
      mode,
      selectMode: async (selected: string) => { calls.push(`select:${selected}`); },
      refresh: () => {
        calls.push("refresh");
        return new Promise<void>(() => {});
      },
    };
    registerRustAnalyzerCommands(context, service as never);
    return { handlers, shown, calls };
  }

  test("registers only the select configuration command", () => {
    const { handlers } = setup("all-features", () => undefined);

    assert.deepStrictEqual([...handlers.keys()], ["tbench.rustAnalyzer.selectConfiguration"]);
  });

  test("lists the active mode first and marks it active", async () => {
    const { handlers, shown } = setup("model-specific", () => undefined);

    await handlers.get("tbench.rustAnalyzer.selectConfiguration")?.();

    assert.deepStrictEqual(
      shown[0].map((item) => [item.mode, item.label, item.description]),
      [
        ["model-specific", "Model Specific", "Active"],
        ["all-features", "All Features", undefined],
      ]
    );
  });

  test("persists the picked mode and starts refresh without awaiting it", async () => {
    const { handlers, calls } = setup("all-features", (items) => items.find((item) => item.mode === "model-specific"));

    await handlers.get("tbench.rustAnalyzer.selectConfiguration")?.();

    assert.deepStrictEqual(calls, ["select:model-specific", "refresh"]);
  });

  test("dismissing the pick changes nothing", async () => {
    const { handlers, calls } = setup("all-features", () => undefined);

    await handlers.get("tbench.rustAnalyzer.selectConfiguration")?.();

    assert.deepStrictEqual(calls, []);
  });
});
