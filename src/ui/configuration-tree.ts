/**
 * Tree items and providers for the three configuration panes — Build
 * Selection, Build Artifacts, and Build Options.
 */
import * as vscode from "vscode";
import * as path from "path";
import { BuildContext, ManifestState, ManifestStateLoaded } from "../manifest/manifest-types";
import { ResolvedOption } from "../configuration/build-options";
import { ActiveCompileCommandsArtifact } from "../intellisense/intellisense-types";
import { ActiveBinaryArtifact, ActiveMapArtifact, ActiveExecutableArtifact } from "../intellisense/artifact-resolution";
import { PresetState } from "../presets/preset-types";
import { PresetChoice } from "../presets/preset-resolution";

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

/**
 * Identifies one of the three sibling panes in the `tbench` container.
 * `build-selection` is the retitled, id-inheriting successor of the section
 * that used to be called `build-context`.
 */
export type PaneId = "build-selection" | "build-options" | "build-artifacts";

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

function formatArtifactTooltip(
  artifactPath: string,
  status: "valid" | "missing",
  missingReason?: string
): string {
  if (status === "valid") {
    return artifactPath;
  }

  if (!artifactPath) {
    return missingReason ?? "Artifact missing.";
  }

  const lines = [`Missing: ${artifactPath}`];
  if (missingReason && !isRedundantMissingReason(missingReason, artifactPath)) {
    lines.push(missingReason);
  }
  return lines.join("\n");
}

function isRedundantMissingReason(reason: string, artifactPath: string): boolean {
  return reason.includes(artifactPath)
    || /(?:compile-commands|binary|map|executable) artifact not found/i.test(reason)
    ;
}

export function formatArtifactAge(modifiedAt: Date, now: Date = new Date()): string {
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - modifiedAt.getTime()) / 60_000));
  if (elapsedMinutes === 0) {
    return "just now";
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} min ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
}

export class ArtifactUpdatedItem extends vscode.TreeItem {
  constructor(modifiedAt: Date, now: Date = new Date()) {
    super("Updated", vscode.TreeItemCollapsibleState.None);
    this.id = "artifact:updated";
    this.contextValue = "artifact-updated";
    this.iconPath = new vscode.ThemeIcon("clock");
    this.description = formatArtifactAge(modifiedAt, now);
    this.tooltip = `Last modified: ${modifiedAt.toISOString().replace("T", " ").slice(0, 16)} UTC`;
  }
}

// ---------------------------------------------------------------------------
// Build Artifacts section items
// ---------------------------------------------------------------------------

/**
 * Shared shape of a Build Artifacts row: `artifact:<kind>` id,
 * `artifact-<kind>` contextValue, pass/error icon, and a
 * `present`/`missing` description derived from the artifact status.
 */
class ArtifactStatusItem extends vscode.TreeItem {
  constructor(
    label: string,
    kind: string,
    status: "valid" | "missing",
    tooltip: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `artifact:${kind}`;
    this.contextValue = `artifact-${kind}`;
    this.iconPath = new vscode.ThemeIcon(status === "valid" ? "pass" : "error");
    this.description = status === "valid" ? "present" : "missing";
    this.tooltip = tooltip;
  }
}

/**
 * The Compile Commands row in the Build Artifacts section.
 * Shows `present` or `missing` as description and the expected path as tooltip.
 */
export class CompileCommandsArtifactItem extends ArtifactStatusItem {
  constructor(artifact: ActiveCompileCommandsArtifact) {
    super(
      "Compile Commands",
      "compile-commands",
      artifact.status,
      formatArtifactTooltip(artifact.path, artifact.status, artifact.missingReason)
    );
  }
}

/**
 * The Binary row in the Build Artifacts section.
 * contextValue "artifact-binary" enables Flash/Upload row actions via menus.view/item/context.
 */
export class BinaryArtifactItem extends ArtifactStatusItem {
  constructor(artifact: ActiveBinaryArtifact) {
    super(
      "Binary",
      "binary",
      artifact.status,
      formatArtifactTooltip(artifact.path, artifact.status, artifact.missingReason)
    );
  }
}

/**
 * The Map File row in the Build Artifacts section.
 * contextValue "artifact-map" enables the openMapFile row action via menus.view/item/context.
 */
export class MapArtifactItem extends ArtifactStatusItem {
  constructor(artifact: ActiveMapArtifact) {
    super(
      "Map File",
      "map",
      artifact.status,
      formatArtifactTooltip(artifact.path, artifact.status, artifact.missingReason)
    );
  }
}

/**
 * The Executable row in the Build Artifacts section (Debug Launch slice).
 * contextValue "artifact-executable" enables the Start Debugging row action via menus.view/item/context.
 * This row is always rendered when an ExecutableArtifact state has been computed — it remains
 * visible but disabled when the executable is missing or the profile cannot be resolved.
 * Start Debugging is invoked only through the inline row action, not by clicking the row.
 */
export class ExecutableArtifactItem extends ArtifactStatusItem {
  constructor(artifact: ActiveExecutableArtifact) {
    super("Executable", "executable", artifact.status, artifact.tooltip);
  }
}

export type SelectorKind = "model" | "target" | "component" | "preset";

const SELECTOR_ICONS: Readonly<Record<SelectorKind, string>> = {
  model: "circuit-board",
  target: "target",
  component: "extensions",
  preset: "layers",
};

const INACTIVE_CHOICE_ICON = vscode.Uri.file(
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

// ---------------------------------------------------------------------------
// Configuration tree model
// ---------------------------------------------------------------------------

export class ConfigurationTreeModel
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private _state: ManifestState | undefined;
  private _buildContext: BuildContext | undefined;
  private _expandedSelector: SelectorKind | undefined;
  private _expandedMultistateKey: string | undefined;
  private _collapsedGroups = new Set<string>();
  private _resolvedOptions: ReadonlyArray<ResolvedOption> = [];
  private _presetState: PresetState | undefined;
  private _activePresetId: string | undefined;
  private _presetChoices: ReadonlyArray<PresetChoice> = [];
  private _artifact: ActiveCompileCommandsArtifact | null = null;
  private _binaryArtifact: ActiveBinaryArtifact | null = null;
  private _mapArtifact: ActiveMapArtifact | null = null;
  private _executableArtifact: ActiveExecutableArtifact | null = null;

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined
  >();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> =
    this._onDidChangeTreeData.event;

  /**
   * Per-pane refresh signal: fired once per `PaneId` whose rows an update
   * affects, so a `PaneTreeProvider` facade can relay only what concerns it
   * (research.md R4) without re-rendering panes that provably cannot have changed.
   */
  private readonly _onDidChangePane = new vscode.EventEmitter<PaneId>();
  readonly onDidChangePane: vscode.Event<PaneId> = this._onDidChangePane.event;
  private readonly _artifactAgeRefresh = setInterval(() => {
    if (this._newestArtifactModifiedAt()) {
      this._onDidChangeTreeData.fire(undefined);
      this.firePanes("build-artifacts");
    }
  }, 60_000);

  private firePanes(...panes: PaneId[]): void {
    for (const pane of panes) {
      this._onDidChangePane.fire(pane);
    }
  }

  /** Updates the displayed manifest state and refreshes the view. */
  update(
    state: ManifestState,
    buildContext?: BuildContext,
    resolvedOptions?: ReadonlyArray<ResolvedOption>
  ): void {
    this._state = state;
    this._buildContext = buildContext;
    this._resolvedOptions = resolvedOptions ?? [];
    if (state.status !== "loaded") {
      this._expandedSelector = undefined;
      this._expandedMultistateKey = undefined;
      this._collapsedGroups.clear();
    }
    this._onDidChangeTreeData.fire(undefined);
    this.firePanes("build-selection", "build-options");
  }

  /**
   * Updates the preset state, active preset id, and the preset choices, and
   * refreshes the `Preset` selector.
   */
  updatePresets(
    state: PresetState | undefined,
    activePresetId: string | undefined,
    choices: ReadonlyArray<PresetChoice>
  ): void {
    this._presetState = state;
    this._activePresetId = activePresetId;
    this._presetChoices = choices;
    this._onDidChangeTreeData.fire(undefined);
    this.firePanes("build-selection", "build-options");
  }

  /**
   * Updates the compile-commands artifact state and refreshes
   * the Build Artifacts section of the tree.
   */
  updateArtifact(artifact: ActiveCompileCommandsArtifact | null): void {
    this._artifact = artifact;
    this._onDidChangeTreeData.fire(undefined);
    this.firePanes("build-artifacts");
  }

  /**
   * Updates the binary artifact state and refreshes the Build Artifacts section.
   */
  updateBinaryArtifact(artifact: ActiveBinaryArtifact | null | undefined, _workspaceFolder?: vscode.WorkspaceFolder): void {
    this._binaryArtifact = artifact ?? null;
    this._onDidChangeTreeData.fire(undefined);
    this.firePanes("build-artifacts");
  }

  /**
   * Updates the map artifact state and refreshes the Build Artifacts section.
   */
  updateMapArtifact(artifact: ActiveMapArtifact | null | undefined, _workspaceFolder?: vscode.WorkspaceFolder): void {
    this._mapArtifact = artifact ?? null;
    this._onDidChangeTreeData.fire(undefined);
    this.firePanes("build-artifacts");
  }

  /**
   * Updates the executable artifact state and refreshes the Build Artifacts section.
   * The Executable row is always rendered when this is non-null, regardless of status.
   */
  updateExecutableArtifact(artifact: ActiveExecutableArtifact | null | undefined): void {
    this._executableArtifact = artifact ?? null;
    this._onDidChangeTreeData.fire(undefined);
    this.firePanes("build-artifacts");
  }

  setExpandedSelector(selectorKind: SelectorKind | undefined): void {
    if (this._expandedSelector === selectorKind) {
      return;
    }
    this._expandedSelector = selectorKind;
    this._onDidChangeTreeData.fire(undefined);
    this.firePanes("build-selection");
  }

  getExpandedSelector(): SelectorKind | undefined {
    return this._expandedSelector;
  }

  setExpandedMultistateKey(key: string | undefined): void {
    if (this._expandedMultistateKey === key) {
      return;
    }
    this._expandedMultistateKey = key;
    this._onDidChangeTreeData.fire(undefined);
    this.firePanes("build-options");
  }

  getExpandedMultistateKey(): string | undefined {
    return this._expandedMultistateKey;
  }

  setGroupCollapsed(group: string, collapsed: boolean): void {
    const changed = collapsed
      ? !this._collapsedGroups.has(group)
      : this._collapsedGroups.has(group);
    if (!changed) {
      return;
    }
    if (collapsed) {
      this._collapsedGroups.add(group);
    } else {
      this._collapsedGroups.delete(group);
    }
    this._onDidChangeTreeData.fire(undefined);
    this.firePanes("build-options");
  }

  isGroupCollapsed(group: string): boolean {
    return this._collapsedGroups.has(group);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * The root rows for one pane, exactly matching today's section content
   *. Backs each `PaneTreeProvider`'s `getChildren(undefined)`.
   */
  paneRootChildren(paneId: PaneId): vscode.TreeItem[] {
    switch (paneId) {
      case "build-selection":
        return this._buildContextChildren();
      case "build-options":
        return this._buildOptionsChildren();
      case "build-artifacts":
        return this._buildArtifactsChildren();
    }
  }

  /**
   * Pane roots are no longer reachable here — each `PaneTreeProvider` calls
   * `paneRootChildren()` directly. An `undefined` element falls through every
   * `instanceof` check below and returns `[]`.
   */
  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element instanceof BuildOptionGroupItem) {
      return element.groupChildren;
    }

    if (element instanceof BuildOptionMultistateHeaderItem) {
      return element.stateChildren;
    }

    if (element instanceof SelectorHeaderItem) {
      if (this._expandedSelector !== element.selectorKind) {
        return [];
      }
      return this._selectorChoices(element.selectorKind);
    }

    return [];
  }

  // -------------------------------------------------------------------------
  // Build Selection section children
  // -------------------------------------------------------------------------

  private _buildContextChildren(): vscode.TreeItem[] {
    const state = this._state;

    if (!state) {
      return [new PlaceholderItem("Loading…")];
    }

    if (state.status === "missing") {
      return [
        new WarningItem("Manifest file not found"),
        new PlaceholderItem(
          `Expected: ${state.manifestUri.fsPath}`
        ),
      ];
    }

    if (state.status === "invalid") {
      const issues = state.validationIssues;
      const items: vscode.TreeItem[] = [
        new WarningItem(
          issues.length === 1
            ? "Manifest has 1 validation error"
            : `Manifest has ${issues.length} validation error(s)`
        ),
        new PlaceholderItem("Check the Problems view for details"),
      ];
      return items;
    }

    // Loaded state: show model, target, component, and preset selector headers
    return [
      new SelectorHeaderItem(
        "model",
        "Model",
        this._selectedDisplayValue(state, "model"),
        this._expandedSelector === "model"
      ),
      new SelectorHeaderItem(
        "target",
        "Target",
        this._selectedDisplayValue(state, "target"),
        this._expandedSelector === "target"
      ),
      new SelectorHeaderItem(
        "component",
        "Component",
        this._selectedDisplayValue(state, "component"),
        this._expandedSelector === "component"
      ),
      new SelectorHeaderItem(
        "preset",
        "Preset",
        this._presetDisplayValue(),
        this._expandedSelector === "preset"
      ),
    ];
  }

  /**
   * The active preset's label for the `Preset` selector description.
   * `undefined` renders as `—` (nothing has resolved yet). An absent
   * `presets.toml` reads `Unavailable`, since there is no preset to name and
   * the collapsed row is where that is first visible.
   */
  private _presetDisplayValue(): string | undefined {
    if (this._presetState?.status === "unavailable") {
      return "Unavailable";
    }
    if (this._activePresetId === undefined) {
      return undefined;
    }
    return this._presetChoices.find((p) => p.id === this._activePresetId)?.label;
  }

  // -------------------------------------------------------------------------
  // Selector choice rows (expanded under SelectorHeaderItem)
  // -------------------------------------------------------------------------

  private _selectorChoices(kind: SelectorKind): vscode.TreeItem[] {
    if (kind === "preset") {
      return this._presetSelectorChoices();
    }

    if (!this._state || this._state.status !== "loaded") {
      return [];
    }
    const manifest = this._state;
    const activeId = this._buildContext
      ? kind === "model"
        ? this._buildContext.modelId
        : kind === "target"
        ? this._buildContext.targetId
        : this._buildContext.componentId
      : undefined;

    const entries =
      kind === "model"
        ? manifest.models
        : kind === "target"
        ? manifest.targets
        : manifest.components;

    return entries.map(
      (e) => new SelectorChoiceItem(kind, e.id, e.name, e.id === activeId)
    );
  }

  /**
   * Expanded content for the `Preset` selector: a loading placeholder
   * before the first load, a row reporting the absent shared file when preset
   * state is unavailable, an error row replacing all choices when
   * preset state is invalid, or one selectable choice per
   * declared preset — the list never depends on the active build context
   *.
   */
  private _presetSelectorChoices(): vscode.TreeItem[] {
    const state = this._presetState;

    if (!state) {
      return [new PlaceholderItem("Loading…")];
    }

    if (state.status === "unavailable") {
      return [
        new WarningItem(`${path.basename(state.shared.uri.fsPath)} is unavailable`),
        new PlaceholderItem("This repository's xtask does not support build presets"),
      ];
    }

    if (state.status === "invalid") {
      const offending = [state.shared, state.user].find((f) =>
        f.issues.some((i) => i.severity === "error")
      );
      const fileName = offending ? path.basename(offending.uri.fsPath) : "preset file";
      return [
        new WarningItem(`${fileName} is invalid`),
        new PlaceholderItem("Check the Problems view for details"),
      ];
    }

    return this._presetChoices.map(
      (p) => new SelectorChoiceItem("preset", p.id, p.label, p.id === this._activePresetId)
    );
  }

  private _selectedDisplayValue(
    state: ManifestStateLoaded,
    kind: SelectorKind
  ): string | undefined {
    if (!this._buildContext) {
      return undefined;
    }

    if (kind === "model") {
      return state.models.find((entry) => entry.id === this._buildContext?.modelId)?.name;
    }

    if (kind === "target") {
      const target = state.targets.find((entry) => entry.id === this._buildContext?.targetId);
      return target ? (target.shortName ?? target.name) : undefined;
    }

    return state.components.find((entry) => entry.id === this._buildContext?.componentId)?.name;
  }

  // -------------------------------------------------------------------------
  // Build Options section children
  // -------------------------------------------------------------------------

  private _buildOptionsChildren(): vscode.TreeItem[] {
    const state = this._state;

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

    const available = this._resolvedOptions.filter((r) => r.available);

    if (available.length === 0) {
      if (this._resolvedOptions.length === 0) {
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
          const groupChildren = groupMembers.map((r) => this._buildOptionItem(r));
          const collapsed = this._collapsedGroups.has(group);
          const hasOverride = groupMembers.some((r) => r.isOverride);
          items.push(new BuildOptionGroupItem(group, groupChildren, collapsed, hasOverride));
        }
        // else: already included under the group header
      } else {
        items.push(this._buildOptionItem(resolved));
      }
    }

    return items;
  }

  private _buildOptionItem(
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
    const expanded = this._expandedMultistateKey === option.key;
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

  dispose(): void {
    clearInterval(this._artifactAgeRefresh);
    this._onDidChangeTreeData.dispose();
    this._onDidChangePane.dispose();
  }

  // -------------------------------------------------------------------------
  // Build Artifacts section children.
  // -------------------------------------------------------------------------

  private _buildArtifactsChildren(): vscode.TreeItem[] {
    const artifact = this._artifact;
    if (!artifact) {
      return [new PlaceholderItem("IntelliSense not yet evaluated")];
    }

    const newestModifiedAt = this._newestArtifactModifiedAt();

    const items: vscode.TreeItem[] = newestModifiedAt ? [new ArtifactUpdatedItem(newestModifiedAt)] : [];
    items.push(new CompileCommandsArtifactItem(artifact));
    if (this._binaryArtifact) {
      items.push(new BinaryArtifactItem(this._binaryArtifact));
    }
    if (this._mapArtifact) {
      items.push(new MapArtifactItem(this._mapArtifact));
    }
    if (this._executableArtifact) {
      items.push(new ExecutableArtifactItem(this._executableArtifact));
    }
    return items;
  }

  private _newestArtifactModifiedAt(): Date | undefined {
    return [this._artifact, this._binaryArtifact, this._mapArtifact, this._executableArtifact]
      .reduce<Date | undefined>((newest, current) => {
        const modifiedAt = current?.modifiedAt;
        if (!modifiedAt || (newest && modifiedAt <= newest)) {
          return newest;
        }
        return modifiedAt;
      }, undefined);
  }
}

// ---------------------------------------------------------------------------
// Per-pane facade
// ---------------------------------------------------------------------------

/**
 * Thin, stateless `TreeDataProvider` for one pane. `ConfigurationTreeModel`
 * stays the sole owner of manifest, build-selection, preset, resolved-option,
 * and artifact state; this facade only routes to it.
 */
export class PaneTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  constructor(
    private readonly owner: ConfigurationTreeModel,
    private readonly paneId: PaneId
  ) {}

  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> = (
    listener,
    thisArgs,
    disposables
  ) =>
    this.owner.onDidChangePane((pane) => {
      if (pane === this.paneId) {
        listener.call(thisArgs, undefined);
      }
    }, undefined, disposables);

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return this.owner.getTreeItem(element);
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      return this.owner.paneRootChildren(this.paneId);
    }
    return this.owner.getChildren(element);
  }
}
