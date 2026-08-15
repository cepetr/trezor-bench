/**
 * Tree items and command identifiers for the Build Selection pane —
 * the model/target/component/preset selector rows and their choices.
 */
import * as vscode from "vscode";
import * as path from "path";

export type SelectorKind = "model" | "target" | "component" | "preset";

const SELECTOR_ICONS: Readonly<Record<SelectorKind, string>> = {
  model: "circuit-board",
  target: "target",
  component: "extensions",
  preset: "layers",
};

/** Blank icon that keeps inactive choice rows aligned with checked ones. */
export const INACTIVE_CHOICE_ICON = vscode.Uri.file(
  path.resolve(__dirname, "../../images/blank-tree-icon.svg")
);

export class SelectorHeaderItem extends vscode.TreeItem {
  constructor(
    public readonly selectorKind: SelectorKind,
    label: string,
    activeValue: string | undefined,
    expanded: boolean
  ) {
    super(
      label,
      expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = `selector:${selectorKind}:${expanded ? "expanded" : "collapsed"}`;
    this.contextValue = `selector-${selectorKind}`;
    this.description = activeValue ?? "—";
    this.iconPath = new vscode.ThemeIcon(SELECTOR_ICONS[selectorKind]);
    this.tooltip = "";
  }
}

// ---------------------------------------------------------------------------
// Command identifiers for build-context selection.
// ---------------------------------------------------------------------------

export const SELECT_COMMANDS: Readonly<Record<SelectorKind, string>> = {
  model: "tbench.selectModel",
  target: "tbench.selectTarget",
  component: "tbench.selectComponent",
  preset: "tbench.selectPreset",
};

export class SelectorChoiceItem extends vscode.TreeItem {
  constructor(
    public readonly selectorKind: SelectorKind,
    public readonly entryId: string,
    label: string,
    isActive: boolean
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = `choice-${selectorKind}`;
    this.description = isActive ? "active" : undefined;
    this.iconPath = isActive ? new vscode.ThemeIcon("check") : INACTIVE_CHOICE_ICON;
    this.command = {
      title: `Select ${label}`,
      command: SELECT_COMMANDS[selectorKind],
      arguments: [entryId],
    };
  }
}
