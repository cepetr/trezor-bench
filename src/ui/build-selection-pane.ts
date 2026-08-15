/**
 * The Build Selection pane — tree items, command identifiers, and
 * rendering for the model/target/component/preset selector rows and
 * their choices.
 */
import * as vscode from "vscode";
import * as path from "path";
import { BuildContext, ManifestState, ManifestStateLoaded } from "../manifest/manifest-types";
import { PresetState } from "../presets/preset-types";
import { PresetChoice } from "../presets/preset-resolution";
import { INACTIVE_CHOICE_ICON, PlaceholderItem, WarningItem } from "./pane-items";

export type SelectorKind = "model" | "target" | "component" | "preset";

const SELECTOR_ICONS: Readonly<Record<SelectorKind, string>> = {
  model: "circuit-board",
  target: "target",
  component: "extensions",
  preset: "layers",
};

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

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Everything the Build Selection pane reads when rendering its rows. */
export interface BuildSelectionViewState {
  readonly manifest: ManifestState | undefined;
  readonly buildContext: BuildContext | undefined;
  readonly expandedSelector: SelectorKind | undefined;
  readonly presetState: PresetState | undefined;
  readonly activePresetId: string | undefined;
  readonly presetChoices: ReadonlyArray<PresetChoice>;
}

/** The root rows of the Build Selection pane. */
export function buildSelectionRootChildren(view: BuildSelectionViewState): vscode.TreeItem[] {
  const state = view.manifest;

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
      selectedDisplayValue(state, view.buildContext, "model"),
      view.expandedSelector === "model"
    ),
    new SelectorHeaderItem(
      "target",
      "Target",
      selectedDisplayValue(state, view.buildContext, "target"),
      view.expandedSelector === "target"
    ),
    new SelectorHeaderItem(
      "component",
      "Component",
      selectedDisplayValue(state, view.buildContext, "component"),
      view.expandedSelector === "component"
    ),
    new SelectorHeaderItem(
      "preset",
      "Preset",
      presetDisplayValue(view),
      view.expandedSelector === "preset"
    ),
  ];
}

/**
 * The active preset's label for the `Preset` selector description.
 * `undefined` renders as `—` (nothing has resolved yet). An absent
 * `presets.toml` reads `Unavailable`, since there is no preset to name and
 * the collapsed row is where that is first visible.
 */
function presetDisplayValue(view: BuildSelectionViewState): string | undefined {
  if (view.presetState?.status === "unavailable") {
    return "Unavailable";
  }
  if (view.activePresetId === undefined) {
    return undefined;
  }
  return view.presetChoices.find((p) => p.id === view.activePresetId)?.label;
}

/** The choice rows expanded under one selector header. */
export function selectorChoiceChildren(
  view: BuildSelectionViewState,
  kind: SelectorKind
): vscode.TreeItem[] {
  if (kind === "preset") {
    return presetSelectorChoices(view);
  }

  if (!view.manifest || view.manifest.status !== "loaded") {
    return [];
  }
  const manifest = view.manifest;
  const activeId = view.buildContext
    ? kind === "model"
      ? view.buildContext.modelId
      : kind === "target"
      ? view.buildContext.targetId
      : view.buildContext.componentId
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
function presetSelectorChoices(view: BuildSelectionViewState): vscode.TreeItem[] {
  const state = view.presetState;

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

  return view.presetChoices.map(
    (p) => new SelectorChoiceItem("preset", p.id, p.label, p.id === view.activePresetId)
  );
}

function selectedDisplayValue(
  state: ManifestStateLoaded,
  buildContext: BuildContext | undefined,
  kind: SelectorKind
): string | undefined {
  if (!buildContext) {
    return undefined;
  }

  if (kind === "model") {
    return state.models.find((entry) => entry.id === buildContext.modelId)?.name;
  }

  if (kind === "target") {
    const target = state.targets.find((entry) => entry.id === buildContext.targetId);
    return target ? (target.shortName ?? target.name) : undefined;
  }

  return state.components.find((entry) => entry.id === buildContext.componentId)?.name;
}
