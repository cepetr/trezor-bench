import * as vscode from "vscode";
import { RustAnalyzerMode } from "../rust-analyzer/config-types";
import { RustAnalyzerConfigService } from "../rust-analyzer/config-service";

interface RustAnalyzerModeQuickPickItem extends vscode.QuickPickItem {
  readonly mode: RustAnalyzerMode;
}

const MODE_ITEMS: readonly RustAnalyzerModeQuickPickItem[] = [
  {
    label: "All Features",
    detail: "Rust Analyzer processes code with all features enabled.",
    mode: "all-features",
  },
  {
    label: "Model Specific",
    detail: "Rust Analyzer follows the active model, target, preset, and build options.",
    mode: "model-specific",
  },
];

async function selectConfiguration(service: RustAnalyzerConfigService): Promise<void> {
  const active = service.mode;
  const items = [
    ...MODE_ITEMS.filter((item) => item.mode === active).map((item) => ({ ...item, description: "Active" })),
    ...MODE_ITEMS.filter((item) => item.mode !== active),
  ];
  const selected = await vscode.window.showQuickPick(items, {
    title: "Rust Analyzer: Select Configuration",
    placeHolder: "Choose how Rust Analyzer is configured for this workspace",
  });
  if (!selected) {
    return;
  }
  await service.selectMode(selected.mode);
  void service.refresh();
}

export function registerRustAnalyzerCommands(
  context: vscode.ExtensionContext,
  service: RustAnalyzerConfigService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.rustAnalyzer.selectConfiguration", () =>
      selectConfiguration(service)
    )
  );
}
