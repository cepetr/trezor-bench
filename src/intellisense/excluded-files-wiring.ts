/**
 * Wires the excluded-files visibility surface: the service that computes the
 * excluded set, the refresher that reacts to IntelliSense payloads, the
 * Explorer decoration badges, and the editor overlays.
 */
import * as vscode from "vscode";
import { ExcludedFilesService } from "./excluded-files-service";
import { ExcludedFilesRefresher } from "./excluded-files-refresh";
import { IntelliSenseService } from "./intellisense-service";
import { ExcludedFilesDecorationsProvider } from "../ui/excluded-files-decorations";
import { ExcludedFilesOverlays } from "../ui/excluded-files-overlays";

/**
 * Creates and connects the excluded-files components, registering every
 * disposable on the extension context. Self-contained: needs only the
 * workspace folder and the IntelliSense service's payload event.
 */
export function registerExcludedFilesVisibility(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  intelliSenseService: IntelliSenseService
): void {
  const service = new ExcludedFilesService();
  const refresher = new ExcludedFilesRefresher(service, workspaceFolder);
  const decorations = new ExcludedFilesDecorationsProvider();
  const overlays = new ExcludedFilesOverlays();

  context.subscriptions.push(
    service,
    refresher,
    decorations,
    overlays,
    vscode.window.registerFileDecorationProvider(decorations),
    // Connect snapshot updates → decoration provider so Explorer badges refresh.
    service.onDidUpdateSnapshot((snapshot) => {
      decorations.handleSnapshot(snapshot);
      overlays.handleSnapshot(snapshot);
    }),
    // Re-apply overlays whenever new editors become visible.
    vscode.window.onDidChangeVisibleTextEditors(() => {
      overlays.applyToVisibleEditors();
    }),
    // Connect IntelliSense payload changes → excluded-file recomputation.
    intelliSenseService.onDidRefreshPayload((payload) => {
      refresher.handlePayload(payload);
    })
  );
}
