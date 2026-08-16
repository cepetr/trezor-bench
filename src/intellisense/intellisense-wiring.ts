/**
 * Wires the IntelliSense event surface: refresh results feeding the tree
 * artifact row and the wrong-provider Fix notification, the user-local
 * setting watchers, the manual-refresh command, and the extension- and
 * workspace-change triggers that re-schedule refreshes.
 */
import * as vscode from "vscode";
import { IntelliSenseService } from "./intellisense-service";
import { applyProviderSettingFix } from "./cpptools-backend";
import { notifyWarning } from "../observability/log-channel";
import { ResolvedArtifact } from "../build/artifact-resolution";

/** Callbacks through which the wiring reaches extension-owned state. */
export interface IntelliSenseWiringDeps {
  /** Updates the tree view's compile-commands artifact row. */
  updateTreeArtifact: (artifact: ResolvedArtifact | null) => void;
  /** Re-renders the status bar after a status-bar setting change. */
  refreshStatusBar: () => void;
}

/**
 * Connects the IntelliSense service's events and the VS Code watchers that
 * drive its refreshes, registering every subscription on the extension
 * context. Service creation and input initialization stay with the caller.
 */
export function registerIntelliSenseWiring(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  service: IntelliSenseService,
  deps: IntelliSenseWiringDeps
): void {
  /** Tracks the last wrong-provider state offered to the user to avoid duplicate Fix notifications. */
  let lastShownProviderFixState: string = "none";

  context.subscriptions.push(
    // Subscribe to IntelliSense refresh results → update tree view artifact row
    service.onDidRefresh(([compileCommandsArtifact, readiness]) => {
      deps.updateTreeArtifact(compileCommandsArtifact);
      // Show the wrong-provider fix notification once per state entry.
      if (readiness.warningState === "wrong-provider" && readiness.warningState !== lastShownProviderFixState) {
        lastShownProviderFixState = "wrong-provider";
        notifyWarning(
          readiness.lastWarningMessage ??
            "Another C/C++ configuration provider is active. Switch to Trezor Bench?",
          "Fix"
        ).then((selection) => {
          if (selection === "Fix") {
            applyProviderSettingFix(workspaceFolder, () => {
              lastShownProviderFixState = "none";
              service.scheduleRefresh("build-selection-change");
            });
          }
        });
      } else if (readiness.warningState !== "wrong-provider") {
        lastShownProviderFixState = "none";
      }
    }),

    // Watch remaining VS Code settings that still control user-local behavior.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("tbench.showConfigurationInStatusBar", workspaceFolder.uri)) {
        deps.refreshStatusBar();
      }
      if (
        e.affectsConfiguration("tbench.excludedFiles.grayInTree", workspaceFolder.uri) ||
        e.affectsConfiguration("tbench.excludedFiles.showEditorOverlay", workspaceFolder.uri) ||
        e.affectsConfiguration("tbench.excludedFiles.fileNamePatterns", workspaceFolder.uri) ||
        e.affectsConfiguration("tbench.excludedFiles.folderGlobs", workspaceFolder.uri)
      ) {
        service.scheduleRefresh("excluded-files-setting-change");
      }
    }),

    // Manual refresh requested via the command palette or a view action.
    vscode.commands.registerCommand("tbench.refreshIntelliSense", () => {
      service.scheduleRefresh("manual-refresh");
    }),

    // Provider-change refresh: re-evaluate readiness when extensions change.
    vscode.extensions.onDidChange(() => {
      service.scheduleRefresh("provider-change");
    }),

    // Trigger IntelliSense refresh when workspace folders change so excluded-file
    // candidate paths are re-evaluated against the updated workspace root.
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      service.scheduleRefresh("workspace-change");
    })
  );
}
