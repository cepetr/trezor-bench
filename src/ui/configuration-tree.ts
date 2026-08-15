/**
 * State owner and per-pane providers for the three configuration panes —
 * Build Selection, Build Artifacts, and Build Options. The pane-specific
 * tree items live in the `build-*-pane.ts` modules.
 */
import * as vscode from "vscode";
import * as path from "path";
import { BuildContext, ManifestState, ManifestStateLoaded } from "../manifest/manifest-types";
import { ResolvedOption } from "../build/build-options";
import { ArtifactKind, ArtifactsByKind } from "../build/artifact-resolution";
import { PresetState } from "../presets/preset-types";
import { PresetChoice } from "../presets/preset-resolution";
import { SelectorKind, SelectorHeaderItem, SelectorChoiceItem } from "./build-selection-pane";
import {
  BuildOptionCheckboxItem,
  BuildOptionGroupItem,
  BuildOptionMismatchInfo,
  BuildOptionMultistateHeaderItem,
  BuildOptionStateItem,
} from "./build-options-pane";
import {
  ArtifactUpdatedItem,
  BinaryArtifactItem,
  CompileCommandsArtifactItem,
  ExecutableArtifactItem,
  MapArtifactItem,
} from "./build-artifacts-pane";

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
  private _artifacts: { [K in ArtifactKind]: ArtifactsByKind[K] | null } = {
    "compile-commands": null,
    binary: null,
    map: null,
    executable: null,
  };

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
   * Updates the given kind's artifact state and refreshes the Build
   * Artifacts section of the tree. The Executable row is always rendered
   * when its artifact is non-null, regardless of status.
   */
  updateArtifact<K extends ArtifactKind>(kind: K, artifact: ArtifactsByKind[K] | null | undefined): void {
    this._artifacts[kind] = artifact ?? null;
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
    const compileCommandsArtifact = this._artifacts["compile-commands"];
    if (!compileCommandsArtifact) {
      return [new PlaceholderItem("IntelliSense not yet evaluated")];
    }

    const newestModifiedAt = this._newestArtifactModifiedAt();

    const items: vscode.TreeItem[] = newestModifiedAt ? [new ArtifactUpdatedItem(newestModifiedAt)] : [];
    items.push(new CompileCommandsArtifactItem(compileCommandsArtifact));
    if (this._artifacts.binary) {
      items.push(new BinaryArtifactItem(this._artifacts.binary));
    }
    if (this._artifacts.map) {
      items.push(new MapArtifactItem(this._artifacts.map));
    }
    if (this._artifacts.executable) {
      items.push(new ExecutableArtifactItem(this._artifacts.executable));
    }
    return items;
  }

  private _newestArtifactModifiedAt(): Date | undefined {
    return Object.values(this._artifacts)
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
