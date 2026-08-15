/**
 * State owner and per-pane providers for the three configuration panes —
 * Build Selection, Build Artifacts, and Build Options. The pane-specific
 * tree items and rendering live in the `build-*-pane.ts` modules.
 */
import * as vscode from "vscode";
import { BuildContext, ManifestState } from "../manifest/manifest-types";
import { ResolvedOption } from "../build/build-options";
import { ArtifactKind, ArtifactsByKind } from "../build/artifact-resolution";
import { PresetState } from "../presets/preset-types";
import { PresetChoice } from "../presets/preset-resolution";
import {
  SelectorKind,
  SelectorHeaderItem,
  BuildSelectionViewState,
  buildSelectionRootChildren,
  selectorChoiceChildren,
} from "./build-selection-pane";
import {
  BuildOptionGroupItem,
  BuildOptionMultistateHeaderItem,
  buildOptionsRootChildren,
} from "./build-options-pane";
import {
  BuildArtifactsViewState,
  buildArtifactsRootChildren,
  newestArtifactModifiedAt,
} from "./build-artifacts-pane";

/**
 * Identifies one of the three sibling panes in the `tbench` container.
 * `build-selection` is the retitled, id-inheriting successor of the section
 * that used to be called `build-context`.
 */
export type PaneId = "build-selection" | "build-options" | "build-artifacts";

// ---------------------------------------------------------------------------
// Configuration tree model
// ---------------------------------------------------------------------------

export class PaneTreeModel
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
  private _artifacts: BuildArtifactsViewState = {
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
    if (newestArtifactModifiedAt(this._artifacts)) {
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
        return buildSelectionRootChildren(this._selectionViewState());
      case "build-options":
        return buildOptionsRootChildren({
          manifest: this._state,
          resolvedOptions: this._resolvedOptions,
          collapsedGroups: this._collapsedGroups,
          expandedMultistateKey: this._expandedMultistateKey,
        });
      case "build-artifacts":
        return buildArtifactsRootChildren(this._artifacts);
    }
  }

  private _selectionViewState(): BuildSelectionViewState {
    return {
      manifest: this._state,
      buildContext: this._buildContext,
      expandedSelector: this._expandedSelector,
      presetState: this._presetState,
      activePresetId: this._activePresetId,
      presetChoices: this._presetChoices,
    };
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
      return selectorChoiceChildren(this._selectionViewState(), element.selectorKind);
    }

    return [];
  }

  dispose(): void {
    clearInterval(this._artifactAgeRefresh);
    this._onDidChangeTreeData.dispose();
    this._onDidChangePane.dispose();
  }
}

// ---------------------------------------------------------------------------
// Per-pane facade
// ---------------------------------------------------------------------------

/**
 * Thin, stateless `TreeDataProvider` for one pane. `PaneTreeModel`
 * stays the sole owner of manifest, build-selection, preset, resolved-option,
 * and artifact state; this facade only routes to it.
 */
export class PaneTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  constructor(
    private readonly owner: PaneTreeModel,
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
