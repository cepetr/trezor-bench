/**
 * The Build Options pane — tree items, command identifiers, and
 * rendering for checkbox and multistate option rows, their groups, and
 * state choices.
 */
import * as vscode from "vscode";
import { ManifestState } from "../manifest/manifest-types";
import { ResolvedOption } from "../build/build-options";
import { INACTIVE_CHOICE_ICON, PlaceholderItem, WarningItem } from "./pane-items";

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

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Everything the Build Options pane reads when rendering its rows. */
export interface BuildOptionsViewState {
  readonly manifest: ManifestState | undefined;
  readonly resolvedOptions: ReadonlyArray<ResolvedOption>;
  readonly collapsedGroups: ReadonlySet<string>;
  readonly expandedMultistateKey: string | undefined;
}

/** The root rows of the Build Options pane. */
export function buildOptionsRootChildren(view: BuildOptionsViewState): vscode.TreeItem[] {
  const state = view.manifest;

  if (!state) {
    return [new PlaceholderItem("Loading…")];
  }

  if (state.status === "missing") {
    return [new PlaceholderItem("No manifest — Build Options unavailable")];
  }

  if (state.status === "invalid") {
    return [new PlaceholderItem("Manifest is invalid — Build Options unavailable")];
  }

  if (state.hasWorkflowBlockingIssues) {
    return [
      new WarningItem("Build workflow blocked: invalid availability rules"),
      new PlaceholderItem("Check the Problems view for details"),
    ];
  }

  const available = view.resolvedOptions.filter((r) => r.available);

  if (available.length === 0) {
    if (view.resolvedOptions.length === 0) {
      return [new PlaceholderItem("No build options defined")];
    }
    return [new PlaceholderItem("No options available for the active build context")];
  }

  // Render in declaration order, grouping items under first-seen group headers.
  const items: vscode.TreeItem[] = [];
  const seenGroups = new Set<string>();

  for (const resolved of available) {
    const { group } = resolved.option;
    if (group) {
      if (!seenGroups.has(group)) {
        seenGroups.add(group);
        const groupMembers = available.filter((r) => r.option.group === group);
        const groupChildren = groupMembers.map((r) => buildOptionItem(view, r));
        const collapsed = view.collapsedGroups.has(group);
        const hasOverride = groupMembers.some((r) => r.isOverride);
        items.push(new BuildOptionGroupItem(group, groupChildren, collapsed, hasOverride));
      }
      // else: already included under the group header
    } else {
      items.push(buildOptionItem(view, resolved));
    }
  }

  return items;
}

function buildOptionItem(
  view: BuildOptionsViewState,
  resolved: ResolvedOption
): BuildOptionCheckboxItem | BuildOptionMultistateHeaderItem {
  const { option, value, presetState, isOverride } = resolved;
  const mismatch: BuildOptionMismatchInfo | undefined =
    presetState === "mismatch" ? { rawValue: resolved.rawValue ?? "" } : undefined;

  if (option.kind === "checkbox") {
    return new BuildOptionCheckboxItem(
      option.key,
      option.label,
      value === true,
      isOverride,
      option.description,
      mismatch,
      option.flag
    );
  }

  // multistate
  const activeStateId = typeof value === "string" ? value : "";
  const activeStateLabel =
    option.states?.find((s) => s.id === activeStateId)?.label ?? activeStateId;
  const selectable = presetState !== "unresolved";
  const stateChildren = (option.states ?? []).map(
    (s) =>
      new BuildOptionStateItem(option.key, s.id, s.label, s.id === activeStateId, s.description, selectable, s.flag)
  );
  const expanded = view.expandedMultistateKey === option.key;
  return new BuildOptionMultistateHeaderItem(
    option.key,
    option.label,
    activeStateLabel,
    stateChildren,
    expanded,
    isOverride,
    option.description,
    mismatch,
    option.flag
  );
}
