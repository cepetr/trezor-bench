/**
 * Tree items and command identifiers for the Build Options pane —
 * checkbox and multistate option rows, their groups, and state choices.
 */
import * as vscode from "vscode";
import { INACTIVE_CHOICE_ICON } from "./build-selection-pane";

// ---------------------------------------------------------------------------
// Command identifiers for build-option interaction.
// ---------------------------------------------------------------------------

export const TOGGLE_BUILD_OPTION_COMMAND = "tbench.toggleBuildOption";
export const SELECT_BUILD_OPTION_STATE_COMMAND = "tbench.selectBuildOptionState";

// ---------------------------------------------------------------------------
// Build Option tree items
// ---------------------------------------------------------------------------

/** Group header for a named option group; its children are pre-built. */
export class BuildOptionGroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupLabel: string,
    public readonly groupChildren: vscode.TreeItem[],
    collapsed: boolean = false,
    hasNonDefault: boolean = false
  ) {
    const showBold = collapsed && hasNonDefault;
    super(
      showBold ? { label: groupLabel, highlights: [[0, groupLabel.length]] } : groupLabel,
      collapsed
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded
    );
    this.id = `build-option-group:${groupLabel}:${collapsed ? "collapsed" : "expanded"}`;
    this.contextValue = "build-option-group";
    this.tooltip = "";
  }
}

/** Info for rendering a preset-value mismatch: the warning icon plus a description naming the raw value. */
export interface BuildOptionMismatchInfo {
  readonly rawValue: boolean | string | number;
}

function mismatchDescription(mismatch: BuildOptionMismatchInfo): string {
  return `Unrepresentable value: ${JSON.stringify(mismatch.rawValue)}`;
}

function formatBuildOptionTooltip(option: string, description?: string): vscode.MarkdownString {
  const tooltipDescription = description?.trim();
  return new vscode.MarkdownString(`**${option}**${tooltipDescription ? `  \n${tooltipDescription}` : ""}`);
}

/** A single checkbox-style build option row. Emphasis is driven by `isOverride`, not by `checked`. */
export class BuildOptionCheckboxItem extends vscode.TreeItem {
  constructor(
    public readonly optionKey: string,
    label: string,
    checked: boolean,
    isOverride: boolean = false,
    description?: string,
    mismatch?: BuildOptionMismatchInfo,
    displayFlag: string = `--${optionKey}`
  ) {
    super(
      isOverride ? { label, highlights: [[0, label.length]] } : label,
      vscode.TreeItemCollapsibleState.None
    );
    this.id = `build-option:${optionKey}`;
    this.contextValue = "build-option-checkbox";
    this.checkboxState = checked
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    this.tooltip = formatBuildOptionTooltip(displayFlag, description);
    if (mismatch) {
      this.iconPath = new vscode.ThemeIcon("warning");
      this.description = mismatchDescription(mismatch);
    }
  }
}

/** Expandable header for a multistate build option; shows active state inline. Emphasis is driven by `isOverride`. */
export class BuildOptionMultistateHeaderItem extends vscode.TreeItem {
  constructor(
    public readonly optionKey: string,
    label: string,
    activeStateLabel: string,
    public readonly stateChildren: BuildOptionStateItem[],
    expanded: boolean,
    isOverride: boolean = false,
    description?: string,
    mismatch?: BuildOptionMismatchInfo,
    displayFlag: string = `--${optionKey}`
  ) {
    super(
      isOverride ? { label, highlights: [[0, label.length]] } : label,
      expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.id = `build-option-multistate:${optionKey}:${expanded ? "expanded" : "collapsed"}`;
    this.contextValue = "build-option-multistate";
    this.description = mismatch ? mismatchDescription(mismatch) : activeStateLabel;
    this.iconPath = new vscode.ThemeIcon(mismatch ? "warning" : "list-selection");
    this.tooltip = formatBuildOptionTooltip(displayFlag, description);
  }
}

/** A state choice under a multistate build option header. Non-selectable when the option is unresolved. */
export class BuildOptionStateItem extends vscode.TreeItem {
  constructor(
    public readonly optionKey: string,
    public readonly stateId: string,
    label: string,
    isActive: boolean,
    description?: string,
    selectable: boolean = true,
    displayFlag: string = `--${optionKey} ${stateId}`
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `build-option-state:${optionKey}:${stateId}`;
    this.contextValue = selectable ? "build-option-state" : "build-option-state-disabled";
    this.iconPath = isActive ? new vscode.ThemeIcon("check") : INACTIVE_CHOICE_ICON;
    this.tooltip = formatBuildOptionTooltip(displayFlag, description);
    if (selectable) {
      this.command = {
        title: `Select ${label}`,
        command: SELECT_BUILD_OPTION_STATE_COMMAND,
        arguments: [optionKey, stateId],
      };
    }
  }
}
