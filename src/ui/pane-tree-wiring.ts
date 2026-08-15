/**
 * Creates the three configuration-pane tree views and wires their
 * interaction handlers — selector expand/collapse, multistate and option-group
 * expand/collapse, and checkbox toggling — to the owning `PaneTreeModel`.
 */
import * as vscode from "vscode";
import { PaneTreeModel, PaneTreeProvider } from "./pane-tree";
import { SelectorHeaderItem } from "./build-selection-pane";
import {
  BuildOptionCheckboxItem,
  BuildOptionGroupItem,
  BuildOptionMultistateHeaderItem,
} from "./build-options-pane";

/** Callbacks the checkbox handler needs from the composition root. */
export interface PaneTreeWiringDeps {
  /** Persists one checkbox build-option value. */
  writeBuildOption(key: string, value: boolean): Promise<void>;
  /** Recomputes resolved options and refreshes the tree after writes. */
  refreshResolvedOptionsView(): void;
}

/**
 * Creates the three pane views over `treeModel` and registers them and all
 * interaction handlers on the extension context.
 */
export function registerPaneTreeViews(
  context: vscode.ExtensionContext,
  treeModel: PaneTreeModel,
  deps: PaneTreeWiringDeps
): void {
  const configurationTreeView = vscode.window.createTreeView("tbench.configuration", {
    treeDataProvider: new PaneTreeProvider(treeModel, "build-selection"),
    showCollapseAll: false,
  });
  const buildArtifactsTreeView = vscode.window.createTreeView("tbench.buildArtifacts", {
    treeDataProvider: new PaneTreeProvider(treeModel, "build-artifacts"),
    showCollapseAll: false,
  });
  const buildOptionsTreeView = vscode.window.createTreeView("tbench.buildOptions", {
    treeDataProvider: new PaneTreeProvider(treeModel, "build-options"),
    showCollapseAll: false,
  });
  context.subscriptions.push(
    configurationTreeView,
    buildArtifactsTreeView,
    buildOptionsTreeView,
    // Selector expand/collapse: rows only ever render in Build Selection.
    configurationTreeView.onDidExpandElement(({ element }) => {
      if (element instanceof SelectorHeaderItem) {
        treeModel.setExpandedSelector(element.selectorKind);
      }
    }),
    configurationTreeView.onDidCollapseElement(({ element }) => {
      if (element instanceof SelectorHeaderItem) {
        if (treeModel.getExpandedSelector() === element.selectorKind) {
          treeModel.setExpandedSelector(undefined);
        }
      }
    }),
    // Multistate expand/collapse, option-group collapse, and checkbox toggling:
    // rows only ever render in Build Options.
    buildOptionsTreeView.onDidExpandElement(({ element }) => {
      if (element instanceof BuildOptionMultistateHeaderItem) {
        treeModel.setExpandedMultistateKey(element.optionKey);
      } else if (element instanceof BuildOptionGroupItem) {
        treeModel.setGroupCollapsed(element.groupLabel, false);
      }
    }),
    buildOptionsTreeView.onDidCollapseElement(({ element }) => {
      if (element instanceof BuildOptionMultistateHeaderItem) {
        if (treeModel.getExpandedMultistateKey() === element.optionKey) {
          treeModel.setExpandedMultistateKey(undefined);
        }
      } else if (element instanceof BuildOptionGroupItem) {
        treeModel.setGroupCollapsed(element.groupLabel, true);
      }
    }),
    buildOptionsTreeView.onDidChangeCheckboxState(async ({ items }) => {
      for (const [element, state] of items) {
        if (!(element instanceof BuildOptionCheckboxItem)) {
          continue;
        }
        const newValue = state === vscode.TreeItemCheckboxState.Checked;
        await deps.writeBuildOption(element.optionKey, newValue);
      }
      deps.refreshResolvedOptionsView();
    })
  );
}
