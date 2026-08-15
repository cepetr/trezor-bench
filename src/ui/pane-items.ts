/**
 * Tree items and assets shared by all three configuration panes.
 */
import * as vscode from "vscode";
import * as path from "path";

export class WarningItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "warning";
    this.iconPath = new vscode.ThemeIcon("warning");
  }
}

export class PlaceholderItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "placeholder";
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

/** Blank icon that keeps inactive choice rows aligned with checked ones. */
export const INACTIVE_CHOICE_ICON = vscode.Uri.file(
  path.resolve(__dirname, "../../images/blank-tree-icon.svg")
);
