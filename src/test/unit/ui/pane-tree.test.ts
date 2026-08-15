import * as assert from "assert";
import * as vscode from "vscode";
import {
  PaneTreeModel,
  PaneTreeProvider,
  PaneId,
} from "../../../ui/pane-tree";
import { PlaceholderItem, WarningItem } from "../../../ui/pane-items";
import {
  SelectorChoiceItem,
  SelectorHeaderItem,
} from "../../../ui/build-selection-pane";
import {
  BuildOptionGroupItem,
  BuildOptionMultistateHeaderItem,
  BuildOptionCheckboxItem,
  BuildOptionStateItem,
} from "../../../ui/build-options-pane";
import {
  CompileCommandsArtifactItem,
  BinaryArtifactItem,
  MapArtifactItem,
  ExecutableArtifactItem,
  ArtifactUpdatedItem,
  formatArtifactAge,
} from "../../../ui/build-artifacts-pane";
import { ResolvedArtifact } from "../../../build/artifact-resolution";
import { ExecutableArtifact } from "../../../build/artifact-resolution";
import { ManifestStateLoaded, BuildOption } from "../../../manifest/manifest-types";
import { BuildSelection } from "../../../build/build-selection";
import { PresetFile, PresetState } from "../../../presets/preset-types";
import { PresetChoice } from "../../../presets/preset-resolution";
import { ResolvedOption } from "../../../build/build-options";

suite("SelectorHeaderItem icons", () => {
  test("uses a distinct icon for model", () => {
    const item = new SelectorHeaderItem("model", "Model", "T2T1", false);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "circuit-board");
  });

  test("uses a distinct icon for target", () => {
    const item = new SelectorHeaderItem("target", "Target", "hw", false);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "target");
  });

  test("uses a distinct icon for component", () => {
    const item = new SelectorHeaderItem("component", "Component", "core", false);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "extensions");
  });

  test("uses the layers icon for preset", () => {
    const item = new SelectorHeaderItem("preset", "Preset", "Default", false);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "layers");
  });

  test("preset selector description falls back to '—' when nothing has resolved yet", () => {
    const item = new SelectorHeaderItem("preset", "Preset", undefined, false);
    assert.strictEqual(item.description, "—");
  });

  test("uses expanded collapsible state when the selector is open", () => {
    const item = new SelectorHeaderItem("model", "Model", "T2T1", true);
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    assert.strictEqual(item.id, "selector:model:expanded");
  });

  test("uses collapsed collapsible state when the selector is closed", () => {
    const item = new SelectorHeaderItem("model", "Model", "T2T1", false);
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    assert.strictEqual(item.id, "selector:model:collapsed");
  });
});

suite("SelectorChoiceItem icons", () => {
  test("uses a check icon for the active choice", () => {
    const item = new SelectorChoiceItem("model", "T2T1", "Trezor Model T", true);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "check");
  });

  test("uses a transparent spacer icon for an inactive choice", () => {
    const item = new SelectorChoiceItem("model", "T3W1", "Trezor Model T3", false);
    assert.ok(item.iconPath instanceof vscode.Uri);
    assert.ok((item.iconPath as vscode.Uri).fsPath.endsWith("images/blank-tree-icon.svg"));
  });

  test("selects tbench.selectPreset as the command for a preset choice", () => {
    const item = new SelectorChoiceItem("preset", "test", "test", false);
    assert.strictEqual(item.command?.command, "tbench.selectPreset");
  });
});

suite("BuildOptionMultistateHeaderItem accordion", () => {
  function makeHeader(expanded: boolean): BuildOptionMultistateHeaderItem {
    const stateChildren: BuildOptionStateItem[] = [];
    return new BuildOptionMultistateHeaderItem("verbose", "Verbosity", "Off", stateChildren, expanded);
  }

  test("uses Expanded collapsible state when expanded = true", () => {
    const item = makeHeader(true);
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
  });

  test("uses Collapsed collapsible state when expanded = false", () => {
    const item = makeHeader(false);
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  });

  test("id encodes 'expanded' when open", () => {
    const item = makeHeader(true);
    assert.strictEqual(item.id, "build-option-multistate:verbose:expanded");
  });

  test("id encodes 'collapsed' when closed", () => {
    const item = makeHeader(false);
    assert.strictEqual(item.id, "build-option-multistate:verbose:collapsed");
  });

  test("description shows the active state label", () => {
    const item = makeHeader(false);
    assert.strictEqual(item.description, "Off");
  });
});

suite("BuildOptionCheckboxItem bold label", () => {
  test("label has highlights when isOverride = true, regardless of checked state", () => {
    const item = new BuildOptionCheckboxItem("verbose", "Verbose", true, true);
    assert.deepStrictEqual(item.label, { label: "Verbose", highlights: [[0, 7]] });
  });

  test("label is plain string when isOverride = false, even if checked", () => {
    const item = new BuildOptionCheckboxItem("verbose", "Verbose", true, false);
    assert.strictEqual(item.label, "Verbose");
  });

  test("label is plain string when isOverride is omitted (defaults to false)", () => {
    const item = new BuildOptionCheckboxItem("verbose", "Verbose", false);
    assert.strictEqual(item.label, "Verbose");
  });
});

suite("BuildOptionMultistateHeaderItem bold label", () => {
  test("label has highlights when isNonDefault = true", () => {
    const item = new BuildOptionMultistateHeaderItem("opt", "Verbosity", "High", [], false, true);
    assert.deepStrictEqual(item.label, { label: "Verbosity", highlights: [[0, 9]] });
  });

  test("label is plain string when isNonDefault = false", () => {
    const item = new BuildOptionMultistateHeaderItem("opt", "Verbosity", "Off", [], false, false);
    assert.strictEqual(item.label, "Verbosity");
  });

  test("label is plain string when isNonDefault not provided", () => {
    const item = new BuildOptionMultistateHeaderItem("opt", "Verbosity", "Off", [], false);
    assert.strictEqual(item.label, "Verbosity");
  });
});

suite("BuildOptionGroupItem bold label", () => {
  test("label has highlights when collapsed and hasNonDefault = true", () => {
    const item = new BuildOptionGroupItem("Advanced", [], true, true);
    assert.deepStrictEqual(item.label, { label: "Advanced", highlights: [[0, 8]] });
  });

  test("label is plain string when expanded even if hasNonDefault = true", () => {
    const item = new BuildOptionGroupItem("Advanced", [], false, true);
    assert.strictEqual(item.label, "Advanced");
  });

  test("label is plain string when collapsed but hasNonDefault = false", () => {
    const item = new BuildOptionGroupItem("Advanced", [], true, false);
    assert.strictEqual(item.label, "Advanced");
  });

  test("uses Collapsed state when collapsed = true", () => {
    const item = new BuildOptionGroupItem("Advanced", [], true, false);
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  });

  test("uses Expanded state when collapsed = false", () => {
    const item = new BuildOptionGroupItem("Advanced", [], false, false);
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
  });

  test("id encodes collapsed state", () => {
    const collapsed = new BuildOptionGroupItem("Adv", [], true, false);
    const expanded = new BuildOptionGroupItem("Adv", [], false, false);
    assert.strictEqual(collapsed.id, "build-option-group:Adv:collapsed");
    assert.strictEqual(expanded.id, "build-option-group:Adv:expanded");
  });

  test("defaults to expanded with no bold when constructed with no extra args", () => {
    const item = new BuildOptionGroupItem("Adv", []);
    assert.strictEqual(item.label, "Adv");
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
  });
});

function markdownTooltipValue(item: vscode.TreeItem): string {
  const { tooltip } = item;
  if (!(tooltip instanceof vscode.MarkdownString)) {
    throw new Error("Expected a MarkdownString tooltip");
  }
  return (tooltip as vscode.MarkdownString).value;
}

suite("BuildOptionCheckboxItem tooltip", () => {
  test("shows the command-line flag above its description rather than the internal key", () => {
    const item = new BuildOptionCheckboxItem("bootloader_devel", "Bootloader development", false, false, "Enables verbose output", undefined, "--bootloader-devel");
    assert.strictEqual(markdownTooltipValue(item), "**--bootloader-devel**  \nEnables verbose output");
  });

  test("contains the bold command-line option when description is omitted", () => {
    const item = new BuildOptionCheckboxItem("opt", "Verbose", false);
    assert.strictEqual(markdownTooltipValue(item), "**--opt**");
  });
});

suite("BuildOptionMultistateHeaderItem tooltip", () => {
  test("shows the command-line flag above its description rather than the internal key", () => {
    const item = new BuildOptionMultistateHeaderItem("debug_console", "Level", "Off", [], false, false, "Sets verbosity level", undefined, "--debug-console");
    assert.strictEqual(markdownTooltipValue(item), "**--debug-console**  \nSets verbosity level");
  });

  test("contains the bold command-line option when description is omitted", () => {
    const item = new BuildOptionMultistateHeaderItem("opt", "Level", "Off", [], false, false);
    assert.strictEqual(markdownTooltipValue(item), "**--opt**");
  });
});

suite("BuildOptionStateItem tooltip", () => {
  test("shows the selected state flag above its description rather than internal keys", () => {
    const item = new BuildOptionStateItem("dbg_console", "vcp", "VCP", false, "Routes the debug console over VCP.", true, "--dbg-console=vcp");
    assert.strictEqual(markdownTooltipValue(item), "**--dbg-console=vcp**  \nRoutes the debug console over VCP.");
  });

  test("shows the full bold command-line option when state description is omitted", () => {
    const item = new BuildOptionStateItem("opt", "swo", "SWO", false);
    assert.strictEqual(markdownTooltipValue(item), "**--opt swo**");
  });
});

// ---------------------------------------------------------------------------
// Preset-relative mismatch/unresolved rendering
// ---------------------------------------------------------------------------

suite("BuildOptionCheckboxItem mismatch rendering", () => {
  test("renders the warning icon and names the unrepresentable value when mismatched", () => {
    const item = new BuildOptionCheckboxItem("frozen", "Frozen", false, false, undefined, { rawValue: "yes" });
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "warning");
    assert.ok(String(item.description).includes("yes"));
  });

  test("has no mismatch icon or description when not mismatched", () => {
    const item = new BuildOptionCheckboxItem("frozen", "Frozen", true, true);
    assert.strictEqual(item.iconPath, undefined);
    assert.strictEqual(item.description, undefined);
  });
});

suite("BuildOptionMultistateHeaderItem mismatch rendering", () => {
  test("renders the warning icon and names the unrepresentable value when mismatched", () => {
    const item = new BuildOptionMultistateHeaderItem(
      "dbg-console",
      "Debug Console",
      "SWO",
      [],
      false,
      false,
      undefined,
      { rawValue: "uart" }
    );
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "warning");
    assert.ok(String(item.description).includes("uart"));
  });

  test("uses the list-selection icon and the active state label when not mismatched", () => {
    const item = new BuildOptionMultistateHeaderItem("dbg-console", "Debug Console", "SWO", [], false);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "list-selection");
    assert.strictEqual(item.description, "SWO");
  });
});

suite("BuildOptionStateItem selectability", () => {
  test("has a select command by default", () => {
    const item = new BuildOptionStateItem("opt", "swo", "SWO", false);
    assert.strictEqual(item.command?.command, "tbench.selectBuildOptionState");
  });

  test("omits the select command when not selectable (unresolved option, Edge Cases)", () => {
    const item = new BuildOptionStateItem("opt", "swo", "SWO", false, undefined, false);
    assert.strictEqual(item.command, undefined);
  });
});

// ---------------------------------------------------------------------------
// CompileCommandsArtifactItem rendering
// ---------------------------------------------------------------------------

function makePresentCompileCommandsArtifact(overrides: Partial<ResolvedArtifact> = {}): ResolvedArtifact {
  return {
    path: "/build/model-t/compile_commands_core.cc.json",
    exists: true,
    status: "present",
    contextKey: "T2T1::hw::core",
    ...overrides,
  };
}

function makeMissingCompileCommandsArtifact(overrides: Partial<ResolvedArtifact> = {}): ResolvedArtifact {
  return {
    path: "/build/model-t/compile_commands_core.cc.json",
    exists: false,
    status: "missing",
    missingReason: "Expected compile-commands artifact not found.",
    contextKey: "T2T1::hw::core",
    ...overrides,
  };
}

suite("ArtifactUpdatedItem", () => {
  const now = new Date("2026-08-12T12:00:00Z");

  test("formats artifact age in minutes, hours, and days", () => {
    assert.strictEqual(formatArtifactAge(new Date("2026-08-12T11:59:30Z"), now), "just now");
    assert.strictEqual(formatArtifactAge(new Date("2026-08-12T11:58:00Z"), now), "2 min ago");
    assert.strictEqual(formatArtifactAge(new Date("2026-08-12T09:00:00Z"), now), "3 hours ago");
    assert.strictEqual(formatArtifactAge(new Date("2026-08-08T12:00:00Z"), now), "4 days ago");
  });

  test("uses a clock icon and relative-age description", () => {
    const item = new ArtifactUpdatedItem(new Date("2026-08-12T11:58:00Z"), now);
    assert.strictEqual(item.label, "Updated");
    assert.strictEqual(item.description, "2 min ago");
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "clock");
  });
});

suite("CompileCommandsArtifactItem – label and identity", () => {
  test("label is 'Compile Commands'", () => {
    const item = new CompileCommandsArtifactItem(makePresentCompileCommandsArtifact());
    assert.strictEqual(item.label, "Compile Commands");
  });

  test("id is 'artifact:compile-commands'", () => {
    const item = new CompileCommandsArtifactItem(makePresentCompileCommandsArtifact());
    assert.strictEqual(item.id, "artifact:compile-commands");
  });

  test("contextValue is 'artifact-compile-commands'", () => {
    const item = new CompileCommandsArtifactItem(makePresentCompileCommandsArtifact());
    assert.strictEqual(item.contextValue, "artifact-compile-commands");
  });

  test("collapsibleState is None", () => {
    const item = new CompileCommandsArtifactItem(makePresentCompileCommandsArtifact());
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });
});

suite("CompileCommandsArtifactItem – valid artifact", () => {
  test("description is 'present'", () => {
    const item = new CompileCommandsArtifactItem(makePresentCompileCommandsArtifact());
    assert.strictEqual(item.description, "present");
  });

  test("icon is 'pass' theme icon", () => {
    const item = new CompileCommandsArtifactItem(makePresentCompileCommandsArtifact());
    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "pass");
  });

  test("tooltip includes the artifact path", () => {
    const artifact = makePresentCompileCommandsArtifact({ path: "/build/model-t/compile_commands_core.cc.json" });
    const item = new CompileCommandsArtifactItem(artifact);
    assert.ok(
      String(item.tooltip).includes("/build/model-t/compile_commands_core.cc.json"),
      `expected tooltip to include path, got: ${item.tooltip}`
    );
  });
});

suite("CompileCommandsArtifactItem – missing artifact", () => {
  test("description is 'missing'", () => {
    const item = new CompileCommandsArtifactItem(makeMissingCompileCommandsArtifact());
    assert.strictEqual(item.description, "missing");
  });

  test("icon is 'error' theme icon", () => {
    const item = new CompileCommandsArtifactItem(makeMissingCompileCommandsArtifact());
    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "error");
  });

  test("tooltip shows missingReason when present", () => {
    const artifact = makeMissingCompileCommandsArtifact({ missingReason: "Build artifact not found." });
    const item = new CompileCommandsArtifactItem(artifact);
    assert.ok(
      String(item.tooltip).startsWith("Missing: /build/model-t/compile_commands_core.cc.json"),
      `expected compact missing tooltip, got: ${item.tooltip}`
    );
  });

  test("tooltip falls back to a missing-state message with resolved path when missingReason is absent", () => {
    const artifact: ResolvedArtifact = {
      path: "/build/model-t/compile_commands_core.cc.json",
      exists: false,
      status: "missing",
      contextKey: "T2T1::hw::core",
    };
    const item = new CompileCommandsArtifactItem(artifact);
    assert.ok(
      String(item.tooltip).startsWith("Missing: /build/model-t/compile_commands_core.cc.json"),
      `expected missing-state fallback tooltip, got: ${item.tooltip}`
    );
  });
});

// ---------------------------------------------------------------------------
// BinaryArtifactItem rendering
// ---------------------------------------------------------------------------

function makePresentBinaryArtifact(overrides: Partial<ResolvedArtifact> = {}): ResolvedArtifact {
  return {
    path: "/build/model-t/firmware_core.bin",
    exists: true,
    status: "present",
    contextKey: "T2T1::hw::core",
    ...overrides,
  };
}

function makeMissingBinaryArtifact(overrides: Partial<ResolvedArtifact> = {}): ResolvedArtifact {
  return {
    path: "/build/model-t/firmware_core.bin",
    exists: false,
    status: "missing",
    missingReason: "Binary artifact not found at the expected path.",
    contextKey: "T2T1::hw::core",
    ...overrides,
  };
}

suite("BinaryArtifactItem – label and identity", () => {
  test("label is 'Binary'", () => {
    const item = new BinaryArtifactItem(makePresentBinaryArtifact());
    assert.strictEqual(item.label, "Binary");
  });

  test("id is 'artifact:binary'", () => {
    const item = new BinaryArtifactItem(makePresentBinaryArtifact());
    assert.strictEqual(item.id, "artifact:binary");
  });

  test("contextValue is 'artifact-binary'", () => {
    const item = new BinaryArtifactItem(makePresentBinaryArtifact());
    assert.strictEqual(item.contextValue, "artifact-binary");
  });

  test("collapsibleState is None", () => {
    const item = new BinaryArtifactItem(makePresentBinaryArtifact());
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });
});

suite("BinaryArtifactItem – valid artifact", () => {
  test("description is 'present'", () => {
    const item = new BinaryArtifactItem(makePresentBinaryArtifact());
    assert.strictEqual(item.description, "present");
  });

  test("icon is 'pass' theme icon", () => {
    const item = new BinaryArtifactItem(makePresentBinaryArtifact());
    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "pass");
  });

  test("tooltip includes the artifact path", () => {
    const artifact = makePresentBinaryArtifact({ path: "/build/model-t/firmware_core.bin" });
    const item = new BinaryArtifactItem(artifact);
    assert.ok(
      String(item.tooltip).includes("/build/model-t/firmware_core.bin"),
      `expected tooltip to include path, got: ${item.tooltip}`
    );
  });
});

suite("BinaryArtifactItem – missing artifact", () => {
  test("description is 'missing'", () => {
    const item = new BinaryArtifactItem(makeMissingBinaryArtifact());
    assert.strictEqual(item.description, "missing");
  });

  test("icon is 'error' theme icon", () => {
    const item = new BinaryArtifactItem(makeMissingBinaryArtifact());
    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "error");
  });

  test("tooltip shows missingReason when present", () => {
    const artifact = makeMissingBinaryArtifact({ missingReason: "Build the firmware first." });
    const item = new BinaryArtifactItem(artifact);
    assert.ok(
      String(item.tooltip).startsWith("Missing: /build/model-t/firmware_core.bin"),
      `expected compact missing tooltip with path, got: ${item.tooltip}`
    );
    assert.ok(
      String(item.tooltip).includes("Build the firmware first."),
      `expected tooltip to include missingReason, got: ${item.tooltip}`
    );
  });

  test("tooltip falls back to a missing-state message with resolved path when missingReason is absent", () => {
    const artifact: ResolvedArtifact = {
      path: "/build/model-t/firmware_core.bin",
      exists: false,
      status: "missing",
      contextKey: "T2T1::hw::core",
    };
    const item = new BinaryArtifactItem(artifact);
    assert.ok(
      String(item.tooltip).includes("firmware_core.bin"),
      `expected path in fallback tooltip, got: ${item.tooltip}`
    );
  });
});

// ---------------------------------------------------------------------------
// MapArtifactItem rendering
// ---------------------------------------------------------------------------

function makePresentMapArtifact(overrides: Partial<ResolvedArtifact> = {}): ResolvedArtifact {
  return {
    path: "/build/model-t/firmware_core.map",
    exists: true,
    status: "present",
    contextKey: "T2T1::hw::core",
    ...overrides,
  };
}

function makeMissingMapArtifact(overrides: Partial<ResolvedArtifact> = {}): ResolvedArtifact {
  return {
    path: "/build/model-t/firmware_core.map",
    exists: false,
    status: "missing",
    missingReason: "Map artifact not found at the expected path.",
    contextKey: "T2T1::hw::core",
    ...overrides,
  };
}

suite("MapArtifactItem – label and identity", () => {
  test("label is 'Map File'", () => {
    const item = new MapArtifactItem(makePresentMapArtifact());
    assert.strictEqual(item.label, "Map File");
  });

  test("id is 'artifact:map'", () => {
    const item = new MapArtifactItem(makePresentMapArtifact());
    assert.strictEqual(item.id, "artifact:map");
  });

  test("contextValue is 'artifact-map'", () => {
    const item = new MapArtifactItem(makePresentMapArtifact());
    assert.strictEqual(item.contextValue, "artifact-map");
  });

  test("collapsibleState is None", () => {
    const item = new MapArtifactItem(makePresentMapArtifact());
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });
});

suite("MapArtifactItem – valid artifact", () => {
  test("description is 'present'", () => {
    const item = new MapArtifactItem(makePresentMapArtifact());
    assert.strictEqual(item.description, "present");
  });

  test("icon is 'pass' theme icon", () => {
    const item = new MapArtifactItem(makePresentMapArtifact());
    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "pass");
  });

  test("tooltip includes the artifact path", () => {
    const artifact = makePresentMapArtifact({ path: "/build/model-t/firmware_core.map" });
    const item = new MapArtifactItem(artifact);
    assert.ok(
      String(item.tooltip).includes("/build/model-t/firmware_core.map"),
      `expected tooltip to include path, got: ${item.tooltip}`
    );
  });
});

suite("MapArtifactItem – missing artifact", () => {
  test("description is 'missing'", () => {
    const item = new MapArtifactItem(makeMissingMapArtifact());
    assert.strictEqual(item.description, "missing");
  });

  test("icon is 'error' theme icon", () => {
    const item = new MapArtifactItem(makeMissingMapArtifact());
    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "error");
  });

  test("tooltip shows missingReason when present", () => {
    const artifact = makeMissingMapArtifact({ missingReason: "Map file not found." });
    const item = new MapArtifactItem(artifact);
    assert.ok(
      String(item.tooltip).startsWith("Missing: /build/model-t/firmware_core.map"),
      `expected compact missing tooltip, got: ${item.tooltip}`
    );
  });

  test("tooltip falls back to a missing-state message with resolved path when missingReason is absent", () => {
    const artifact: ResolvedArtifact = {
      path: "/build/model-t/firmware_core.map",
      exists: false,
      status: "missing",
      contextKey: "T2T1::hw::core",
    };
    const item = new MapArtifactItem(artifact);
    assert.ok(
      String(item.tooltip).includes("firmware_core.map"),
      `expected path in fallback tooltip, got: ${item.tooltip}`
    );
  });
});

suite("PaneTreeModel – Binary/Map artifact refresh", () => {
  let treeModel: PaneTreeModel;

  setup(() => {
    treeModel = new PaneTreeModel();
  });

  teardown(() => {
    treeModel.dispose();
  });

  function getBuildArtifactsChildren(): vscode.TreeItem[] {
    return treeModel.paneRootChildren("build-artifacts");
  }

  test("switching artifact context replaces Binary and Map rows with the new paths", () => {
    treeModel.updateArtifact("compile-commands", 
      makePresentCompileCommandsArtifact({
        path: "/build/model-t/compile_commands_core.cc.json",
        contextKey: "T2T1::hw::core",
      })
    );
    treeModel.updateArtifact("binary", 
      makePresentBinaryArtifact({
        path: "/build/model-t/firmware_core.bin",
        contextKey: "T2T1::hw::core",
      })
    );
    treeModel.updateArtifact("map", 
      makePresentMapArtifact({
        path: "/build/model-t/firmware_core.map",
        contextKey: "T2T1::hw::core",
      })
    );

    treeModel.updateArtifact("compile-commands", 
      makePresentCompileCommandsArtifact({
        path: "/build/model-t3/compile_commands_boot_emu.cc.json",
        contextKey: "T3W1::emu::bootloader",
      })
    );
    treeModel.updateArtifact("binary", 
      makePresentBinaryArtifact({
        path: "/build/model-t3/firmware_boot_emu.bin",
        contextKey: "T3W1::emu::bootloader",
      })
    );
    treeModel.updateArtifact("map", 
      makePresentMapArtifact({
        path: "/build/model-t3/firmware_boot_emu.map",
        contextKey: "T3W1::emu::bootloader",
      })
    );

    const children = getBuildArtifactsChildren();
    assert.strictEqual(children.length, 3);

    const binary = children[1] as BinaryArtifactItem;
    const map = children[2] as MapArtifactItem;

    assert.ok(
      String(binary.tooltip).includes("/build/model-t3/firmware_boot_emu.bin"),
      `binary tooltip should reference the new context path, got: ${binary.tooltip}`
    );
    assert.ok(
      !String(binary.tooltip).includes("/build/model-t/firmware_core.bin"),
      `binary tooltip must not retain the previous context path, got: ${binary.tooltip}`
    );
    assert.ok(
      String(map.tooltip).includes("/build/model-t3/firmware_boot_emu.map"),
      `map tooltip should reference the new context path, got: ${map.tooltip}`
    );
    assert.ok(
      !String(map.tooltip).includes("/build/model-t/firmware_core.map"),
      `map tooltip must not retain the previous context path, got: ${map.tooltip}`
    );
  });

  test("clearing Binary and Map artifacts removes stale rows", () => {
    treeModel.updateArtifact("compile-commands", makePresentCompileCommandsArtifact());
    treeModel.updateArtifact("binary", makePresentBinaryArtifact());
    treeModel.updateArtifact("map", makePresentMapArtifact());

    treeModel.updateArtifact("binary", null);
    treeModel.updateArtifact("map", null);

    const children = getBuildArtifactsChildren();
    assert.strictEqual(children.length, 1, "only compile-commands row should remain");
    assert.ok(children[0] instanceof CompileCommandsArtifactItem);
  });

  test("prepends the newest artifact modification time as an Updated row", () => {
    treeModel.updateArtifact("compile-commands", makePresentCompileCommandsArtifact({ modifiedAt: new Date("2026-08-12T09:00:00Z") }));
    treeModel.updateArtifact("binary", makePresentBinaryArtifact({ modifiedAt: new Date("2026-08-12T11:00:00Z") }));
    treeModel.updateArtifact("map", makePresentMapArtifact({ modifiedAt: new Date("2026-08-12T10:00:00Z") }));

    const children = getBuildArtifactsChildren();
    const updated = children[0] as ArtifactUpdatedItem;
    assert.ok(updated instanceof ArtifactUpdatedItem);
    assert.strictEqual(updated.label, "Updated");
    assert.strictEqual(updated.tooltip, "Last modified: 2026-08-12 11:00 UTC");
  });

  test("omits the Updated row when no artifact is present", () => {
    treeModel.updateArtifact("compile-commands", makeMissingCompileCommandsArtifact());
    treeModel.updateArtifact("binary", makeMissingBinaryArtifact());
    treeModel.updateArtifact("map", makeMissingMapArtifact());

    const children = getBuildArtifactsChildren();
    assert.ok(!children.some((child) => child instanceof ArtifactUpdatedItem));
  });
});

// ---------------------------------------------------------------------------
// ExecutableArtifactItem rendering
// ---------------------------------------------------------------------------

function makePresentExecutableArtifact(overrides: Partial<ExecutableArtifact> = {}): ExecutableArtifact {
  return {
    contextKey: "T2T1::hw::core",
    profileResolutionState: "selected",
    path: "/build/model-t/firmware.elf",
    exists: true,
    status: "present",
    tooltip: "/build/model-t/firmware.elf",
    matchingProfileCount: 1,
    ...overrides,
  };
}

function makeMissingExecutableArtifact(overrides: Partial<ExecutableArtifact> = {}): ExecutableArtifact {
  return {
    contextKey: "T2T1::hw::core",
    profileResolutionState: "selected",
    path: "/build/model-t/firmware.elf",
    exists: false,
    status: "missing",
    missingReason: "Executable artifact not found at the expected path: /build/model-t/firmware.elf",
    tooltip: "Missing: /build/model-t/firmware.elf",
    matchingProfileCount: 1,
    ...overrides,
  };
}

suite("ExecutableArtifactItem – label and identity", () => {
  test("label is 'Executable'", () => {
    const item = new ExecutableArtifactItem(makePresentExecutableArtifact());
    assert.strictEqual(item.label, "Executable");
  });

  test("id is 'artifact:executable'", () => {
    const item = new ExecutableArtifactItem(makePresentExecutableArtifact());
    assert.strictEqual(item.id, "artifact:executable");
  });

  test("contextValue is 'artifact-executable'", () => {
    const item = new ExecutableArtifactItem(makePresentExecutableArtifact());
    assert.strictEqual(item.contextValue, "artifact-executable");
  });

  test("collapsibleState is None", () => {
    const item = new ExecutableArtifactItem(makePresentExecutableArtifact());
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });
});

suite("ExecutableArtifactItem – valid status rendering", () => {
  test("icon is 'pass' when status is valid", () => {
    const item = new ExecutableArtifactItem(makePresentExecutableArtifact());
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "pass");
  });

  test("description is 'present'", () => {
    const item = new ExecutableArtifactItem(makePresentExecutableArtifact());
    assert.strictEqual(item.description, "present");
  });

  test("tooltip contains the executable path", () => {
    const item = new ExecutableArtifactItem(makePresentExecutableArtifact());
    assert.ok(
      String(item.tooltip).includes("/build/model-t/firmware.elf"),
      `expected tooltip to include the executable path, got: ${item.tooltip}`
    );
  });
});

suite("ExecutableArtifactItem – missing status rendering", () => {
  test("icon is 'error' when status is missing", () => {
    const item = new ExecutableArtifactItem(makeMissingExecutableArtifact());
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "error");
  });

  test("description is 'missing'", () => {
    const item = new ExecutableArtifactItem(makeMissingExecutableArtifact());
    assert.strictEqual(item.description, "missing");
  });

  test("tooltip reflects the missing reason", () => {
    const item = new ExecutableArtifactItem(makeMissingExecutableArtifact());
    assert.ok(
      String(item.tooltip).startsWith("Missing: /build/model-t/firmware.elf"),
      `expected compact missing executable tooltip, got: ${item.tooltip}`
    );
  });

  test("missing-reason entries: no-match tooltip is non-empty", () => {
    const item = new ExecutableArtifactItem(makeMissingExecutableArtifact({
      profileResolutionState: "no-match",
      tooltip: "No debug profile matches the active build context.",
      path: "",
    }));
    assert.ok(String(item.tooltip).length > 0);
  });

  test("missing-reason entries: manifest-invalid tooltip is non-empty", () => {
    const item = new ExecutableArtifactItem(makeMissingExecutableArtifact({
      profileResolutionState: "manifest-invalid",
      tooltip: "Debug configuration has validation errors.",
      path: "",
    }));
    assert.ok(String(item.tooltip).length > 0);
  });
});

suite("PaneTreeModel – Executable row", () => {
  let treeModel: PaneTreeModel;

  setup(() => {
    treeModel = new PaneTreeModel();
  });

  teardown(() => {
    treeModel.dispose();
  });

  function getBuildArtifactsChildrenExec(): vscode.TreeItem[] {
    return treeModel.paneRootChildren("build-artifacts");
  }

  test("Executable row appears when updateExecutableArtifact is called with valid artifact", () => {
    treeModel.updateArtifact("compile-commands", makePresentCompileCommandsArtifact());
    treeModel.updateArtifact("executable", makePresentExecutableArtifact());
    const children = getBuildArtifactsChildrenExec();
    assert.ok(
      children.some((c) => c instanceof ExecutableArtifactItem),
      "expected ExecutableArtifactItem in Build Artifacts"
    );
  });

  test("Executable row appears even when status is missing", () => {
    treeModel.updateArtifact("compile-commands", makePresentCompileCommandsArtifact());
    treeModel.updateArtifact("executable", makeMissingExecutableArtifact());
    const children = getBuildArtifactsChildrenExec();
    assert.ok(
      children.some((c) => c instanceof ExecutableArtifactItem),
      "expected ExecutableArtifactItem even when status is missing"
    );
  });

  test("Executable row does not appear when updateExecutableArtifact is not called", () => {
    treeModel.updateArtifact("compile-commands", makePresentCompileCommandsArtifact());
    const children = getBuildArtifactsChildrenExec();
    assert.ok(
      !children.some((c) => c instanceof ExecutableArtifactItem),
      "unexpected ExecutableArtifactItem when artifact not set"
    );
  });

  test("Executable row does not appear after updateArtifact('executable', null)", () => {
    treeModel.updateArtifact("compile-commands", makePresentCompileCommandsArtifact());
    treeModel.updateArtifact("executable", makePresentExecutableArtifact());
    treeModel.updateArtifact("executable", null);
    const children = getBuildArtifactsChildrenExec();
    assert.ok(
      !children.some((c) => c instanceof ExecutableArtifactItem),
      "expected no ExecutableArtifactItem after clearing"
    );
  });

  test("Executable row appears after Map File row when Binary and Map are present", () => {
    treeModel.updateArtifact("compile-commands", makePresentCompileCommandsArtifact());
    treeModel.updateArtifact("binary", makePresentBinaryArtifact());
    treeModel.updateArtifact("map", makePresentMapArtifact());
    treeModel.updateArtifact("executable", makePresentExecutableArtifact());
    const children = getBuildArtifactsChildrenExec();
    const binaryIdx = children.findIndex((c) => c instanceof BinaryArtifactItem);
    const mapIdx = children.findIndex((c) => c instanceof MapArtifactItem);
    const execIdx = children.findIndex((c) => c instanceof ExecutableArtifactItem);
    assert.ok(binaryIdx >= 0, "expected BinaryArtifactItem");
    assert.ok(mapIdx >= 0, "expected MapArtifactItem");
    assert.ok(execIdx > mapIdx, `expected Executable after Map (map@${mapIdx}, exec@${execIdx})`);
  });

  test("Executable row appears immediately after Compile Commands when no Binary/Map", () => {
    treeModel.updateArtifact("compile-commands", makePresentCompileCommandsArtifact());
    treeModel.updateArtifact("executable", makePresentExecutableArtifact());
    const children = getBuildArtifactsChildrenExec();
    const ccIdx = children.findIndex((c) => c instanceof CompileCommandsArtifactItem);
    const execIdx = children.findIndex((c) => c instanceof ExecutableArtifactItem);
    assert.strictEqual(ccIdx, 0, "CompileCommands should be first");
    assert.strictEqual(execIdx, 1, "Executable should be immediately after CompileCommands");
  });

  test("clearing Executable artifact removes the row", () => {
    treeModel.updateArtifact("compile-commands", makePresentCompileCommandsArtifact());
    treeModel.updateArtifact("executable", makePresentExecutableArtifact());
    treeModel.updateArtifact("executable", null);
    const children = getBuildArtifactsChildrenExec();
    assert.strictEqual(children.length, 1, "only compile-commands row should remain");
    assert.ok(children[0] instanceof CompileCommandsArtifactItem);
  });

  test("Executable row tooltip reflects the tooltip from the artifact", () => {
    treeModel.updateArtifact("compile-commands", makePresentCompileCommandsArtifact());
    const artifact = makePresentExecutableArtifact({ tooltip: "/custom/path/to/firmware.elf" });
    treeModel.updateArtifact("executable", artifact);
    const children = getBuildArtifactsChildrenExec();
    const execItem = children.find((c) => c instanceof ExecutableArtifactItem) as ExecutableArtifactItem | undefined;
    assert.ok(execItem, "expected ExecutableArtifactItem");
    assert.ok(
      String(execItem.tooltip).includes("/custom/path/to/firmware.elf"),
      `expected tooltip to include the path, got: ${execItem.tooltip}`
    );
  });
});

// ---------------------------------------------------------------------------
// PaneTreeModel – Preset selector
// ---------------------------------------------------------------------------

function makeManifestState(): ManifestStateLoaded {
  return {
    status: "loaded",
    manifestUri: vscode.Uri.file("/workspace/tbench-manifest.yaml"),
    models: [{ kind: "model", id: "T2T1", name: "Trezor Model T" }],
    targets: [{ kind: "target", id: "hw", name: "Hardware", shortName: "HW" }],
    components: [{ kind: "component", id: "firmware", name: "Firmware" }],
    buildOptions: [],
    hasWorkflowBlockingIssues: false,
    hasDebugBlockingIssues: false,
    validationIssues: [],
    loadedAt: new Date(),
  };
}

function makeBuildSelection(): BuildSelection {
  return {
    modelId: "T2T1",
    targetId: "hw",
    componentId: "firmware",
    persistedAt: new Date().toISOString(),
  };
}

function makePresetFile(overrides: Partial<PresetFile> & Pick<PresetFile, "source">): PresetFile {
  return {
    uri: vscode.Uri.file(`/workspace/xtask/tf-tools/${overrides.source === "user" ? "user-presets.toml" : "presets.toml"}`),
    present: true,
    names: [],
    fragments: [],
    issues: [],
    ...overrides,
  };
}

function makeLoadedPresetState(available: PresetChoice[]): { state: PresetState; available: PresetChoice[] } {
  return {
    state: {
      status: "loaded",
      shared: makePresetFile({ source: "shared", names: available.filter((p) => !p.isDefault).map((p) => p.id) }),
      user: makePresetFile({ source: "user" }),
      loadedAt: new Date(),
      validationIssues: [],
    },
    available,
  };
}

const DEFAULT_ONLY: PresetChoice[] = [{ id: "default", label: "Default", isDefault: true }];

suite("PaneTreeModel – Preset selector", () => {
  let treeModel: PaneTreeModel;

  setup(() => {
    treeModel = new PaneTreeModel();
  });

  teardown(() => {
    treeModel.dispose();
  });

  function buildContextChildren(): vscode.TreeItem[] {
    return treeModel.paneRootChildren("build-selection");
  }

  test("Preset is the fourth Build Selection child, directly below Component", () => {
    treeModel.update(makeManifestState(), makeBuildSelection(), []);
    const children = buildContextChildren() as SelectorHeaderItem[];
    assert.strictEqual(children.length, 4);
    assert.deepStrictEqual(
      children.map((c) => c.selectorKind),
      ["model", "target", "component", "preset"]
    );
    assert.deepStrictEqual(
      children.map((c) => c.label),
      ["Model", "Target", "Component", "Preset"]
    );
  });

  test("description shows '—' before preset state has resolved", () => {
    treeModel.update(makeManifestState(), makeBuildSelection(), []);
    const children = buildContextChildren() as SelectorHeaderItem[];
    assert.strictEqual(children[3].description, "—");
  });

  test("description shows 'Default' for the synthetic choice", () => {
    treeModel.update(makeManifestState(), makeBuildSelection(), []);
    const { state } = makeLoadedPresetState(DEFAULT_ONLY);
    treeModel.updatePresets(state, "default", DEFAULT_ONLY);
    const children = buildContextChildren() as SelectorHeaderItem[];
    assert.strictEqual(children[3].description, "Default");
  });

  test("description shows the active named preset's label", () => {
    treeModel.update(makeManifestState(), makeBuildSelection(), []);
    const available: PresetChoice[] = [
      { id: "default", label: "Default", isDefault: true },
      { id: "test", label: "test", isDefault: false },
    ];
    const { state } = makeLoadedPresetState(available);
    treeModel.updatePresets(state, "test", available);
    const children = buildContextChildren() as SelectorHeaderItem[];
    assert.strictEqual(children[3].description, "test");
  });

  test("preset state undefined renders the loading placeholder when expanded", () => {
    treeModel.update(makeManifestState(), makeBuildSelection(), []);
    treeModel.setExpandedSelector("preset");
    const children = treeModel.getChildren(
      new SelectorHeaderItem("preset", "Preset", undefined, true)
    );
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof PlaceholderItem);
  });

  test("preset state invalid replaces all choices with a warning row naming the failing file", () => {
    treeModel.update(makeManifestState(), makeBuildSelection(), []);
    const invalidState: PresetState = {
      status: "invalid",
      shared: makePresetFile({
        source: "shared",
        issues: [{ severity: "error", code: "toml-parse", message: "bad syntax" }],
      }),
      user: makePresetFile({ source: "user" }),
      loadedAt: new Date(),
      validationIssues: [{ severity: "error", code: "toml-parse", message: "bad syntax" }],
    };
    treeModel.updatePresets(invalidState, "default", []);
    treeModel.setExpandedSelector("preset");
    const children = treeModel.getChildren(
      new SelectorHeaderItem("preset", "Preset", undefined, true)
    );
    assert.ok(children[0] instanceof WarningItem);
    assert.ok(
      String(children[0].label).includes("presets.toml"),
      `expected the warning to name the failing file, got: ${children[0].label}`
    );
    assert.ok(children[1] instanceof PlaceholderItem);
  });

  test("preset state unavailable replaces all choices with a presets.toml-is-unavailable row", () => {
    treeModel.update(makeManifestState(), makeBuildSelection(), []);
    const unavailableState: PresetState = {
      status: "unavailable",
      // The shared file does not exist; the user file may or may not.
      shared: makePresetFile({ source: "shared", present: false }),
      user: makePresetFile({ source: "user", names: ["local"] }),
      loadedAt: new Date(),
      validationIssues: [],
    };
    treeModel.updatePresets(unavailableState, "default", []);
    treeModel.setExpandedSelector("preset");
    const children = treeModel.getChildren(
      new SelectorHeaderItem("preset", "Preset", undefined, true)
    );
    assert.strictEqual(children.length, 2, "no preset choice is offered, not even Default");
    assert.ok(children[0] instanceof WarningItem);
    assert.ok(
      String(children[0].label).includes("presets.toml") &&
        String(children[0].label).includes("unavailable"),
      `expected the warning to report presets.toml as unavailable, got: ${children[0].label}`
    );
    assert.ok(children[1] instanceof PlaceholderItem);
    assert.ok(
      String(children[1].label).includes("xtask"),
      `expected the placeholder to name the cause, got: ${children[1].label}`
    );
  });

  test("description reads 'Unavailable' while presets.toml is absent", () => {
    treeModel.update(makeManifestState(), makeBuildSelection(), []);
    const unavailableState: PresetState = {
      status: "unavailable",
      shared: makePresetFile({ source: "shared", present: false }),
      user: makePresetFile({ source: "user" }),
      loadedAt: new Date(),
      validationIssues: [],
    };
    // The saved id is preserved unresolved, so it must not be shown
    // as though that preset were in effect.
    treeModel.updatePresets(unavailableState, "test", []);
    const children = buildContextChildren() as SelectorHeaderItem[];
    assert.strictEqual(children[3].description, "Unavailable");
  });

  test("preset state loaded lists Default first, then named presets, with the active one marked", () => {
    treeModel.update(makeManifestState(), makeBuildSelection(), []);
    const available: PresetChoice[] = [
      { id: "default", label: "Default", isDefault: true },
      { id: "test", label: "test", isDefault: false },
    ];
    const { state } = makeLoadedPresetState(available);
    treeModel.updatePresets(state, "test", available);
    treeModel.setExpandedSelector("preset");
    const children = treeModel.getChildren(
      new SelectorHeaderItem("preset", "Preset", undefined, true)
    ) as SelectorChoiceItem[];
    assert.strictEqual(children.length, 2);
    assert.strictEqual(children[0].entryId, "default");
    assert.strictEqual(children[1].entryId, "test");
    assert.strictEqual(children[1].description, "active");
    assert.strictEqual(children[0].description, undefined);
  });

  test("every listed preset renders as a plain selectable row, whatever the build context", () => {
    treeModel.update(makeManifestState(), makeBuildSelection(), []);
    // The tree model is handed the full declared list, including presets no
    // fragment of which applies here; none of them is marked or disabled.
    const available: PresetChoice[] = [
      { id: "default", label: "Default", isDefault: true },
      { id: "test", label: "test", isDefault: false },
      { id: "prodtest", label: "prodtest", isDefault: false },
    ];
    const { state } = makeLoadedPresetState(available);
    treeModel.updatePresets(state, "default", available);
    treeModel.setExpandedSelector("preset");
    const children = treeModel.getChildren(
      new SelectorHeaderItem("preset", "Preset", undefined, true)
    ) as SelectorChoiceItem[];
    assert.deepStrictEqual(
      children.map((c) => c.entryId),
      ["default", "test", "prodtest"]
    );
    for (const child of children.slice(1)) {
      assert.strictEqual(child.command?.command, "tbench.selectPreset");
      assert.strictEqual(child.description, undefined);
      assert.strictEqual(child.resourceUri, undefined);
    }
  });

  test("only one selector expands at a time; expanding preset collapses model", () => {
    treeModel.update(makeManifestState(), makeBuildSelection(), []);
    treeModel.setExpandedSelector("model");
    assert.strictEqual(treeModel.getExpandedSelector(), "model");
    treeModel.setExpandedSelector("preset");
    assert.strictEqual(treeModel.getExpandedSelector(), "preset");

    const modelChildren = treeModel.getChildren(
      new SelectorHeaderItem("model", "Model", undefined, false)
    );
    assert.strictEqual(modelChildren.length, 0, "model choices should not render while collapsed");
  });
});

// ---------------------------------------------------------------------------
// PaneTreeModel – Build Options preset-relative emphasis
// ---------------------------------------------------------------------------

function checkboxOption(key: string, flag: string, group?: string): BuildOption {
  return { key, label: key, flag, kind: "checkbox", group };
}

function multistateOption(
  key: string,
  flag: string,
  states: Array<{ id: string; label: string; flag: string }>
): BuildOption {
  return { key, label: key, flag, kind: "multistate", states };
}

function resolved(
  option: BuildOption,
  overrides: Partial<Omit<ResolvedOption, "option">> = {}
): ResolvedOption {
  return {
    option,
    available: true,
    value: option.kind === "checkbox" ? false : (option.states?.[0]?.id ?? ""),
    presetState: "unresolved",
    isOverride: false,
    ...overrides,
  };
}

function getBuildOptionsChildren(treeModel: PaneTreeModel): vscode.TreeItem[] {
  return treeModel.paneRootChildren("build-options");
}

suite("PaneTreeModel – Build Options preset-relative emphasis", () => {
  let treeModel: PaneTreeModel;

  setup(() => {
    treeModel = new PaneTreeModel();
  });

  teardown(() => {
    treeModel.dispose();
  });

  test("checkbox row is emphasized only when isOverride is true", () => {
    const opt = checkboxOption("frozen", "--frozen");
    treeModel.update(
      makeManifestState(),
      makeBuildSelection(),
      [resolved(opt, { value: false, presetState: "resolved", isOverride: true })]
    );
    const [item] = getBuildOptionsChildren(treeModel) as BuildOptionCheckboxItem[];
    assert.deepStrictEqual(item.label, { label: "frozen", highlights: [[0, 6]] });
  });

  test("checkbox row is not emphasized when isOverride is false, even if value is true", () => {
    const opt = checkboxOption("frozen", "--frozen");
    treeModel.update(
      makeManifestState(),
      makeBuildSelection(),
      [resolved(opt, { value: true, presetState: "resolved", isOverride: false })]
    );
    const [item] = getBuildOptionsChildren(treeModel) as BuildOptionCheckboxItem[];
    assert.strictEqual(item.label, "frozen");
  });

  test("checkbox tooltip uses the manifest flag instead of its internal key", () => {
    const opt = checkboxOption("bootloader_devel", "--bootloader-devel");
    treeModel.update(
      makeManifestState(),
      makeBuildSelection(),
      [resolved(opt, { presetState: "resolved" })]
    );
    const [item] = getBuildOptionsChildren(treeModel) as BuildOptionCheckboxItem[];
    assert.strictEqual(markdownTooltipValue(item), "**--bootloader-devel**");
  });

  test("multistate row is emphasized only when isOverride is true", () => {
    const states = [
      { id: "null", label: "Default", flag: "" },
      { id: "swo", label: "SWO", flag: "--dbg-console=swo" },
    ];
    const opt = multistateOption("dbg-console", "--dbg-console", states);
    treeModel.update(
      makeManifestState(),
      makeBuildSelection(),
      [resolved(opt, { value: "swo", presetState: "resolved", presetValue: "null", isOverride: true })]
    );
    const [item] = getBuildOptionsChildren(treeModel) as BuildOptionMultistateHeaderItem[];
    assert.deepStrictEqual(item.label, { label: "dbg-console", highlights: [[0, 11]] });
  });

  test("multistate row is not emphasized when isOverride is false, regardless of which state is active", () => {
    const states = [
      { id: "null", label: "Default", flag: "" },
      { id: "swo", label: "SWO", flag: "--dbg-console=swo" },
    ];
    const opt = multistateOption("dbg-console", "--dbg-console", states);
    treeModel.update(
      makeManifestState(),
      makeBuildSelection(),
      [resolved(opt, { value: "swo", presetState: "resolved", presetValue: "swo", isOverride: false })]
    );
    const [item] = getBuildOptionsChildren(treeModel) as BuildOptionMultistateHeaderItem[];
    assert.strictEqual(item.label, "dbg-console");
  });

  test("collapsed group header is emphasized when any member has isOverride true", () => {
    const optA = checkboxOption("alpha", "--alpha", "Group");
    const optB = checkboxOption("beta", "--beta", "Group");
    treeModel.update(
      makeManifestState(),
      makeBuildSelection(),
      [
        resolved(optA, { value: false, presetState: "resolved", isOverride: false }),
        resolved(optB, { value: true, presetState: "resolved", isOverride: true }),
      ]
    );
    treeModel.setGroupCollapsed("Group", true);
    const [group] = getBuildOptionsChildren(treeModel) as BuildOptionGroupItem[];
    assert.deepStrictEqual(group.label, { label: "Group", highlights: [[0, 5]] });
  });

  test("mismatch checkbox row shows the warning icon and names the unrepresentable value", () => {
    const opt = checkboxOption("frozen", "--frozen");
    treeModel.update(
      makeManifestState(),
      makeBuildSelection(),
      [resolved(opt, { presetState: "mismatch", isOverride: false })]
    );
    const [item] = getBuildOptionsChildren(treeModel) as BuildOptionCheckboxItem[];
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "warning");
  });

  test("unresolved multistate row renders with non-selectable state children", () => {
    const states = [
      { id: "true", label: "Enabled", flag: "--pyopt=true" },
      { id: "false", label: "Disabled", flag: "--pyopt=false" },
    ];
    const opt = multistateOption("pyopt", "--pyopt", states);
    treeModel.update(
      makeManifestState(),
      makeBuildSelection(),
      [resolved(opt, { value: "true", presetState: "unresolved", isOverride: false })]
    );
    treeModel.setExpandedMultistateKey("pyopt");
    const [item] = getBuildOptionsChildren(treeModel) as BuildOptionMultistateHeaderItem[];
    assert.ok(item.stateChildren.length > 0);
    for (const stateChild of item.stateChildren) {
      assert.strictEqual(stateChild.command, undefined, "unresolved state children must not be selectable");
    }
  });
});

// ---------------------------------------------------------------------------
// PaneTreeModel – per-pane root children (paneRootChildren)
// Each PaneId's root rows must match today's section content exactly, in
// every recorded state. This is the reference the pane split is checked
// against.
// ---------------------------------------------------------------------------

suite("PaneTreeModel – paneRootChildren('build-selection')", () => {
  let treeModel: PaneTreeModel;

  setup(() => {
    treeModel = new PaneTreeModel();
  });

  teardown(() => {
    treeModel.dispose();
  });

  test("loading: renders the loading placeholder before any manifest state is set", () => {
    const children = treeModel.paneRootChildren("build-selection");
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof PlaceholderItem);
    assert.strictEqual(children[0].label, "Loading…");
  });

  test("missing: renders the missing-manifest warning and placeholder", () => {
    treeModel.update({
      status: "missing",
      manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
    });
    const children = treeModel.paneRootChildren("build-selection");
    assert.ok(children[0] instanceof WarningItem);
    assert.ok(children[1] instanceof PlaceholderItem);
  });

  test("invalid: renders the validation-error warning and placeholder", () => {
    treeModel.update({
      status: "invalid",
      manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
      validationIssues: [{ severity: "error", code: "invalid-type", message: "bad" }],
      loadedAt: new Date(),
    });
    const children = treeModel.paneRootChildren("build-selection");
    assert.ok(children[0] instanceof WarningItem);
    assert.ok(String(children[0].label).includes("1 validation error"));
    assert.ok(children[1] instanceof PlaceholderItem);
  });

  test("loaded: renders the four selector headers in order", () => {
    treeModel.update(makeManifestState(), makeBuildSelection(), []);
    const paneChildren = treeModel.paneRootChildren("build-selection") as SelectorHeaderItem[];
    assert.strictEqual(paneChildren.length, 4);
    assert.deepStrictEqual(
      paneChildren.map((c) => c.selectorKind),
      ["model", "target", "component", "preset"]
    );
  });
});

suite("PaneTreeModel – paneRootChildren('build-options')", () => {
  let treeModel: PaneTreeModel;

  setup(() => {
    treeModel = new PaneTreeModel();
  });

  teardown(() => {
    treeModel.dispose();
  });

  test("loading: renders the loading placeholder before any manifest state is set", () => {
    const children = treeModel.paneRootChildren("build-options");
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof PlaceholderItem);
    assert.strictEqual(children[0].label, "Loading…");
  });

  test("missing: renders the unavailable-manifest placeholder", () => {
    treeModel.update({
      status: "missing",
      manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
    });
    const children = treeModel.paneRootChildren("build-options");
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof PlaceholderItem);
    assert.strictEqual(children[0].label, "No manifest — Build Options unavailable");
  });

  test("invalid: renders the invalid-manifest placeholder", () => {
    treeModel.update({
      status: "invalid",
      manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
      validationIssues: [{ severity: "error", code: "invalid-type", message: "bad" }],
      loadedAt: new Date(),
    });
    const children = treeModel.paneRootChildren("build-options");
    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0].label, "Manifest is invalid — Build Options unavailable");
  });

  test("workflow-blocked: renders the blocked-workflow warning and placeholder", () => {
    treeModel.update({ ...makeManifestState(), hasWorkflowBlockingIssues: true }, makeBuildSelection(), []);
    const children = treeModel.paneRootChildren("build-options");
    assert.ok(children[0] instanceof WarningItem);
    assert.ok(String(children[0].label).includes("Build workflow blocked"));
    assert.ok(children[1] instanceof PlaceholderItem);
  });

  test("no-options-defined: renders the no-build-options placeholder when nothing was resolved", () => {
    treeModel.update(makeManifestState(), makeBuildSelection(), []);
    const children = treeModel.paneRootChildren("build-options");
    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0].label, "No build options defined");
  });

  test("no-options-available: renders the not-available placeholder when every option is unavailable", () => {
    const opt = checkboxOption("frozen", "--frozen");
    treeModel.update(makeManifestState(), makeBuildSelection(), [resolved(opt, { available: false })]);
    const children = treeModel.paneRootChildren("build-options");
    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0].label, "No options available for the active build context");
  });

  test("loaded: renders an emphasized checkbox row for an overridden option", () => {
    const opt = checkboxOption("frozen", "--frozen");
    treeModel.update(makeManifestState(), makeBuildSelection(), [resolved(opt, { value: true, isOverride: true })]);
    const [item] = treeModel.paneRootChildren("build-options") as BuildOptionCheckboxItem[];
    assert.strictEqual(item.checkboxState, vscode.TreeItemCheckboxState.Checked);
    assert.deepStrictEqual(item.label, { label: "frozen", highlights: [[0, 6]] });
  });
});

suite("PaneTreeModel – paneRootChildren('build-artifacts')", () => {
  let treeModel: PaneTreeModel;

  setup(() => {
    treeModel = new PaneTreeModel();
  });

  teardown(() => {
    treeModel.dispose();
  });

  test("not-yet-evaluated: renders the not-yet-evaluated placeholder before any artifact update", () => {
    const children = treeModel.paneRootChildren("build-artifacts");
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof PlaceholderItem);
    assert.strictEqual(children[0].label, "IntelliSense not yet evaluated");
  });

  test("evaluated: renders Compile Commands then Binary once both are set", () => {
    treeModel.updateArtifact("compile-commands", makePresentCompileCommandsArtifact());
    treeModel.updateArtifact("binary", makePresentBinaryArtifact());
    const children = treeModel.paneRootChildren("build-artifacts");
    assert.strictEqual(children.length, 2);
    assert.ok(children[0] instanceof CompileCommandsArtifactItem);
    assert.ok(children[1] instanceof BinaryArtifactItem);
  });
});

// ---------------------------------------------------------------------------
// PaneTreeModel – per-pane refresh signal (onDidChangePane)
// Each update*() entry point must signal exactly the panes whose rows it
// affects (research.md R4), so a facade relays only what concerns its pane.
// ---------------------------------------------------------------------------

suite("PaneTreeModel – onDidChangePane fan-out", () => {
  let treeModel: PaneTreeModel;

  setup(() => {
    treeModel = new PaneTreeModel();
  });

  teardown(() => {
    treeModel.dispose();
  });

  function collectPanes(action: () => void): PaneId[] {
    const seen: PaneId[] = [];
    const sub = treeModel.onDidChangePane((paneId) => seen.push(paneId));
    action();
    sub.dispose();
    return seen;
  }

  test("update() signals build-selection and build-options", () => {
    const seen = collectPanes(() => treeModel.update(makeManifestState(), makeBuildSelection(), []));
    assert.deepStrictEqual(new Set(seen), new Set(["build-selection", "build-options"]));
  });

  test("updatePresets() signals build-selection and build-options", () => {
    const seen = collectPanes(() => treeModel.updatePresets(undefined, undefined, []));
    assert.deepStrictEqual(new Set(seen), new Set(["build-selection", "build-options"]));
  });

  test("updateArtifact(\'compile-commands\') signals only build-artifacts", () => {
    const seen = collectPanes(() => treeModel.updateArtifact("compile-commands", makePresentCompileCommandsArtifact()));
    assert.deepStrictEqual(seen, ["build-artifacts"]);
  });

  test("updateArtifact(\'binary\') signals only build-artifacts", () => {
    const seen = collectPanes(() => treeModel.updateArtifact("binary", makePresentBinaryArtifact()));
    assert.deepStrictEqual(seen, ["build-artifacts"]);
  });

  test("updateArtifact(\'map\') signals only build-artifacts", () => {
    const seen = collectPanes(() => treeModel.updateArtifact("map", makePresentMapArtifact()));
    assert.deepStrictEqual(seen, ["build-artifacts"]);
  });

  test("updateArtifact('executable') signals only build-artifacts", () => {
    const seen = collectPanes(() => treeModel.updateArtifact("executable", makePresentExecutableArtifact()));
    assert.deepStrictEqual(seen, ["build-artifacts"]);
  });

  test("setExpandedSelector() signals only build-selection", () => {
    treeModel.update(makeManifestState(), makeBuildSelection(), []);
    const seen = collectPanes(() => treeModel.setExpandedSelector("model"));
    assert.deepStrictEqual(seen, ["build-selection"]);
  });

  test("setExpandedMultistateKey() signals only build-options", () => {
    const seen = collectPanes(() => treeModel.setExpandedMultistateKey("verbose"));
    assert.deepStrictEqual(seen, ["build-options"]);
  });

  test("setGroupCollapsed() signals only build-options", () => {
    const seen = collectPanes(() => treeModel.setGroupCollapsed("Advanced", true));
    assert.deepStrictEqual(seen, ["build-options"]);
  });
});

// ---------------------------------------------------------------------------
// PaneTreeProvider facade (research.md R3): thin, stateless TreeDataProvider
// wrapping the owner's per-pane root builder, element dispatch, item
// identity, and change-event relay.
// ---------------------------------------------------------------------------

suite("PaneTreeProvider – root delegation", () => {
  let owner: PaneTreeModel;

  setup(() => {
    owner = new PaneTreeModel();
  });

  teardown(() => {
    owner.dispose();
  });

  test("getChildren(undefined) delegates to the owner's paneRootChildren for build-selection", () => {
    owner.update(makeManifestState(), makeBuildSelection(), []);
    const facade = new PaneTreeProvider(owner, "build-selection");
    assert.deepStrictEqual(facade.getChildren(undefined), owner.paneRootChildren("build-selection"));
  });

  test("getChildren(undefined) delegates to the owner's paneRootChildren for build-options", () => {
    const opt = checkboxOption("frozen", "--frozen");
    owner.update(makeManifestState(), makeBuildSelection(), [resolved(opt)]);
    const facade = new PaneTreeProvider(owner, "build-options");
    assert.deepStrictEqual(facade.getChildren(undefined), owner.paneRootChildren("build-options"));
  });

  test("getChildren(undefined) delegates to the owner's paneRootChildren for build-artifacts", () => {
    owner.updateArtifact("compile-commands", makePresentCompileCommandsArtifact());
    const facade = new PaneTreeProvider(owner, "build-artifacts");
    assert.deepStrictEqual(facade.getChildren(undefined), owner.paneRootChildren("build-artifacts"));
  });

  test("a build-options facade never returns build-selection's root rows", () => {
    owner.update(makeManifestState(), makeBuildSelection(), []);
    const facade = new PaneTreeProvider(owner, "build-options");
    const rows = facade.getChildren(undefined);
    assert.ok(!rows.some((r) => r instanceof SelectorHeaderItem));
  });
});

suite("PaneTreeProvider – non-root delegation to the owner's element dispatch", () => {
  let owner: PaneTreeModel;

  setup(() => {
    owner = new PaneTreeModel();
  });

  teardown(() => {
    owner.dispose();
  });

  test("expands a selector header through the same dispatch as the owner", () => {
    owner.update(makeManifestState(), makeBuildSelection(), []);
    owner.setExpandedSelector("model");
    const facade = new PaneTreeProvider(owner, "build-selection");
    const [modelHeader] = facade.getChildren(undefined) as SelectorHeaderItem[];
    assert.deepStrictEqual(facade.getChildren(modelHeader), owner.getChildren(modelHeader));
    assert.ok(facade.getChildren(modelHeader).length > 0);
  });

  test("expands a multistate option header through the same dispatch as the owner", () => {
    const states = [{ id: "off", label: "Off", flag: "" }];
    const opt = multistateOption("verbose", "--verbose", states);
    owner.update(makeManifestState(), makeBuildSelection(), [resolved(opt)]);
    owner.setExpandedMultistateKey("verbose");
    const facade = new PaneTreeProvider(owner, "build-options");
    const [header] = facade.getChildren(undefined) as BuildOptionMultistateHeaderItem[];
    assert.deepStrictEqual(facade.getChildren(header), owner.getChildren(header));
  });

  test("expands a build-option group through the same dispatch as the owner", () => {
    const optA = checkboxOption("alpha", "--alpha", "Group");
    owner.update(makeManifestState(), makeBuildSelection(), [resolved(optA)]);
    const facade = new PaneTreeProvider(owner, "build-options");
    const [group] = facade.getChildren(undefined) as BuildOptionGroupItem[];
    assert.deepStrictEqual(facade.getChildren(group), owner.getChildren(group));
  });
});

// ---------------------------------------------------------------------------
// Every interaction still behaves as it does today when driven
// through the pane providers, not the owner directly — selector accordion
// behavior, multistate expansion, option-group collapse, and checkbox state.
// ---------------------------------------------------------------------------

suite("PaneTreeProvider – selector accordion behavior", () => {
  let owner: PaneTreeModel;
  let buildSelection: PaneTreeProvider;

  setup(() => {
    owner = new PaneTreeModel();
    buildSelection = new PaneTreeProvider(owner, "build-selection");
    owner.update(makeManifestState(), makeBuildSelection(), []);
  });

  teardown(() => {
    owner.dispose();
  });

  test("expanding a second selector collapses the previously expanded one", () => {
    owner.setExpandedSelector("model");
    let [modelHeader, targetHeader] = buildSelection.getChildren(undefined) as SelectorHeaderItem[];
    assert.strictEqual(modelHeader.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    assert.strictEqual(targetHeader.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    assert.ok(buildSelection.getChildren(modelHeader).length > 0);

    owner.setExpandedSelector("target");
    [modelHeader, targetHeader] = buildSelection.getChildren(undefined) as SelectorHeaderItem[];
    assert.strictEqual(modelHeader.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    assert.strictEqual(targetHeader.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    assert.strictEqual(buildSelection.getChildren(modelHeader).length, 0);
    assert.ok(buildSelection.getChildren(targetHeader).length > 0);
  });
});

suite("PaneTreeProvider – multistate expansion, group collapse, and checkbox state", () => {
  let owner: PaneTreeModel;
  let buildOptions: PaneTreeProvider;

  setup(() => {
    owner = new PaneTreeModel();
    buildOptions = new PaneTreeProvider(owner, "build-options");
  });

  teardown(() => {
    owner.dispose();
  });

  test("expanding a multistate option shows its state children unchanged from today", () => {
    const states = [
      { id: "off", label: "Off", flag: "" },
      { id: "swo", label: "SWO", flag: "--dbg-console=swo" },
    ];
    const opt = multistateOption("dbg-console", "--dbg-console", states);
    owner.update(makeManifestState(), makeBuildSelection(), [resolved(opt, { value: "off", presetState: "resolved" })]);

    owner.setExpandedMultistateKey("dbg-console");
    const [header] = buildOptions.getChildren(undefined) as BuildOptionMultistateHeaderItem[];
    assert.strictEqual(header.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    const stateChildren = buildOptions.getChildren(header) as BuildOptionStateItem[];
    assert.strictEqual(stateChildren.length, 2);
    assert.strictEqual(stateChildren[0].contextValue, "build-option-state");

    owner.setExpandedMultistateKey(undefined);
    const [collapsedHeader] = buildOptions.getChildren(undefined) as BuildOptionMultistateHeaderItem[];
    assert.strictEqual(collapsedHeader.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  });

  test("collapsing an option group hides its members but keeps the header emphasized on override", () => {
    const optA = checkboxOption("alpha", "--alpha", "Group");
    const optB = checkboxOption("beta", "--beta", "Group");
    owner.update(makeManifestState(), makeBuildSelection(), [
      resolved(optA, { isOverride: false }),
      resolved(optB, { value: true, isOverride: true }),
    ]);

    owner.setGroupCollapsed("Group", true);
    const [group] = buildOptions.getChildren(undefined) as BuildOptionGroupItem[];
    assert.strictEqual(group.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    assert.deepStrictEqual(group.label, { label: "Group", highlights: [[0, 5]] });

    owner.setGroupCollapsed("Group", false);
    const [expandedGroup] = buildOptions.getChildren(undefined) as BuildOptionGroupItem[];
    assert.strictEqual(expandedGroup.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    assert.strictEqual(buildOptions.getChildren(expandedGroup).length, 2);
  });

  test("checkbox row reflects the stored value unchanged through the facade", () => {
    const opt = checkboxOption("frozen", "--frozen");
    owner.update(makeManifestState(), makeBuildSelection(), [resolved(opt, { value: false })]);
    let [checkbox] = buildOptions.getChildren(undefined) as BuildOptionCheckboxItem[];
    assert.strictEqual(checkbox.checkboxState, vscode.TreeItemCheckboxState.Unchecked);

    // Simulate the extension re-resolving and re-rendering after a checkbox toggle.
    owner.update(makeManifestState(), makeBuildSelection(), [resolved(opt, { value: true })]);
    [checkbox] = buildOptions.getChildren(undefined) as BuildOptionCheckboxItem[];
    assert.strictEqual(checkbox.checkboxState, vscode.TreeItemCheckboxState.Checked);
  });
});

suite("PaneTreeProvider – getTreeItem identity", () => {
  test("returns the same element it was given, like the owner", () => {
    const owner = new PaneTreeModel();
    const facade = new PaneTreeProvider(owner, "build-artifacts");
    const item = new PlaceholderItem("anything");
    assert.strictEqual(facade.getTreeItem(item), item);
    owner.dispose();
  });
});

suite("PaneTreeProvider – change-event relay", () => {
  let owner: PaneTreeModel;

  setup(() => {
    owner = new PaneTreeModel();
  });

  teardown(() => {
    owner.dispose();
  });

  test("relays the owner's per-pane signal only when it matches this facade's PaneId", () => {
    const facade = new PaneTreeProvider(owner, "build-artifacts");
    let fired = 0;
    const sub = facade.onDidChangeTreeData(() => {
      fired++;
    });
    owner.updateArtifact("compile-commands", makePresentCompileCommandsArtifact());
    sub.dispose();
    assert.strictEqual(fired, 1);
  });

  test("does not fire for a pane change that belongs to a different PaneId", () => {
    const facade = new PaneTreeProvider(owner, "build-artifacts");
    let fired = 0;
    const sub = facade.onDidChangeTreeData(() => {
      fired++;
    });
    owner.update(makeManifestState(), makeBuildSelection(), []);
    sub.dispose();
    assert.strictEqual(fired, 0);
  });
});

// ---------------------------------------------------------------------------
// No pane's rows contain a Build Selection / Build Options / Build Artifacts
// row — that is the removed SectionItem wrapper, not a row any pane renders
//. Walks every reachable row per pane and per state.
// ---------------------------------------------------------------------------

const FORBIDDEN_LABELS = new Set(["Build Selection", "Build Options", "Build Artifacts"]);

function labelText(item: vscode.TreeItem): string {
  const label = item.label;
  if (typeof label === "string") {
    return label;
  }
  return label?.label ?? "";
}

function collectAllRows(
  treeModel: PaneTreeModel,
  paneId: PaneId
): vscode.TreeItem[] {
  const all: vscode.TreeItem[] = [];
  const visit = (children: vscode.TreeItem[]): void => {
    for (const child of children) {
      all.push(child);
      visit(treeModel.getChildren(child));
    }
  };
  visit(treeModel.paneRootChildren(paneId));
  return all;
}

suite("PaneTreeModel – no section rows inside any pane", () => {
  let treeModel: PaneTreeModel;

  setup(() => {
    treeModel = new PaneTreeModel();
  });

  teardown(() => {
    treeModel.dispose();
  });

  const PANE_IDS: PaneId[] = ["build-selection", "build-options", "build-artifacts"];

  test("loading state: no pane renders a forbidden section-name row", () => {
    for (const paneId of PANE_IDS) {
      for (const row of collectAllRows(treeModel, paneId)) {
        assert.ok(!FORBIDDEN_LABELS.has(labelText(row)), `pane '${paneId}' rendered forbidden row '${labelText(row)}'`);
      }
    }
  });

  test("missing manifest: no pane renders a forbidden section-name row", () => {
    treeModel.update({ status: "missing", manifestUri: vscode.Uri.file("/workspace/tbench.yaml") });
    for (const paneId of PANE_IDS) {
      for (const row of collectAllRows(treeModel, paneId)) {
        assert.ok(!FORBIDDEN_LABELS.has(labelText(row)), `pane '${paneId}' rendered forbidden row '${labelText(row)}'`);
      }
    }
  });

  test("invalid manifest: no pane renders a forbidden section-name row", () => {
    treeModel.update({
      status: "invalid",
      manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
      validationIssues: [{ severity: "error", code: "invalid-type", message: "bad" }],
      loadedAt: new Date(),
    });
    for (const paneId of PANE_IDS) {
      for (const row of collectAllRows(treeModel, paneId)) {
        assert.ok(!FORBIDDEN_LABELS.has(labelText(row)), `pane '${paneId}' rendered forbidden row '${labelText(row)}'`);
      }
    }
  });

  test("loaded manifest with expanded selectors, options, and artifacts: no pane renders a forbidden section-name row", () => {
    const optA = checkboxOption("alpha", "--alpha", "Group");
    const states = [{ id: "off", label: "Off", flag: "" }];
    const multi = multistateOption("verbose", "--verbose", states);
    treeModel.update(makeManifestState(), makeBuildSelection(), [resolved(optA), resolved(multi)]);
    treeModel.setExpandedSelector("model");
    treeModel.setExpandedMultistateKey("verbose");
    treeModel.updateArtifact("compile-commands", makePresentCompileCommandsArtifact());
    treeModel.updateArtifact("binary", makePresentBinaryArtifact());
    treeModel.updateArtifact("map", makePresentMapArtifact());
    treeModel.updateArtifact("executable", makePresentExecutableArtifact());

    for (const paneId of PANE_IDS) {
      for (const row of collectAllRows(treeModel, paneId)) {
        assert.ok(!FORBIDDEN_LABELS.has(labelText(row)), `pane '${paneId}' rendered forbidden row '${labelText(row)}'`);
      }
    }
  });

});
