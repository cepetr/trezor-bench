import * as vscode from "vscode";
import { RustAnalyzerMode } from "../rust-analyzer/config-types";
import { RustAnalyzerConfigService } from "../rust-analyzer/config-service";

async function selectMode(service: RustAnalyzerConfigService, mode: RustAnalyzerMode): Promise<void> {
  await service.selectMode(mode);
  void service.refresh();
}

export function registerRustAnalyzerCommands(
  context: vscode.ExtensionContext,
  service: RustAnalyzerConfigService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("tbench.rustAnalyzer.modelSpecific", () => {
      void selectMode(service, "model-specific");
    }),
    vscode.commands.registerCommand("tbench.rustAnalyzer.allFeatures", () => {
      void selectMode(service, "all-features");
    })
  );
}