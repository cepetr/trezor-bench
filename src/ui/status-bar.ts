import * as vscode from "vscode";
import { ManifestState, ManifestStateLoaded, activeManifestEntries } from "../manifest/manifest-types";
import { ActiveConfig } from "../configuration/active-config";

/**
 * Formats the status-bar text for the active build configuration.
 *
 * Format: `{model-name} | {target-display} | {component-name}`
 * - `target-display` is `shortName` when set, otherwise `name`
 * - Returns `undefined` when any id does not resolve to a manifest entry
 */
export function formatStatusBarText(
  state: ManifestStateLoaded,
  config: ActiveConfig
): string | undefined {
  const entries = activeManifestEntries(state, config);
  if (!entries) {
    return undefined;
  }
  const { model, target, component } = entries;

  const targetDisplay = target.shortName ?? target.name;
  return `${model.name} | ${targetDisplay} | ${component.name}`;
}

/**
 * Manages the status-bar item that shows the active build configuration.
 *
 * Call `update()` whenever manifest state or the active configuration changes.
 */
export class StatusBarPresenter implements vscode.Disposable {
  private readonly _item: vscode.StatusBarItem;

  constructor() {
    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this._item.command = "tbench.configuration.focus";
  }

  /**
   * Updates visibility and text of the status-bar item.
   *
   * The item is visible only when the manifest is loaded, an active
   * configuration is set, and the setting `tbench.showConfigurationInStatusBar`
   * is `true`.
   */
  update(
    state: ManifestState,
    activeConfig: ActiveConfig | undefined,
    isEnabled: boolean
  ): void {
    if (state.status !== "loaded" || !activeConfig || !isEnabled) {
      this._item.hide();
      return;
    }

    const text = formatStatusBarText(state, activeConfig);
    if (!text) {
      this._item.hide();
      return;
    }

    this._item.text = `$(symbol-field) ${text}`;
    this._item.show();
  }

  dispose(): void {
    this._item.dispose();
  }
}
