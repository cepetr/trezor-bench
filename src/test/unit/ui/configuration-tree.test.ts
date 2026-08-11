import * as assert from "assert";
import * as vscode from "vscode";
import {
  ConfigurationTreeProvider,
  PaneTreeProvider,
  PaneId,
  SelectorChoiceItem,
  SelectorHeaderItem,
  BuildOptionGroupItem,
  BuildOptionMultistateHeaderItem,
  BuildOptionCheckboxItem,
  BuildOptionStateItem,
  CompileCommandsArtifactItem,
  BinaryArtifactItem,
  MapArtifactItem,
  ExecutableArtifactItem,
  PlaceholderItem,
  WarningItem,
} from "../../../ui/configuration-tree";
import { ActiveCompileCommandsArtifact } from "../../../intellisense/intellisense-types";
import { ActiveBinaryArtifact, ActiveMapArtifact, ActiveExecutableArtifact } from "../../../intellisense/artifact-resolution";
import { ManifestStateLoaded, BuildOption } from "../../../manifest/manifest-types";
import { ActiveConfig } from "../../../configuration/active-config";
import { PresetFile, PresetState } from "../../../presets/preset-types";
import { PresetChoice } from "../../../presets/preset-resolution";
import { ResolvedOption } from "../../../configuration/build-options";

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

  test("uses the layers icon for preset (research Decision 16)", () => {
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
  test("label has highlights when isOverride = true, regardless of checked state (FR-015, replacing _isNonDefault)", () => {
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

suite("BuildOptionCheckboxItem tooltip", () => {
  test("tooltip is set when description is provided", () => {
    const item = new BuildOptionCheckboxItem("opt", "Verbose", false, false, "Enables verbose output");
    assert.strictEqual(item.tooltip, "Enables verbose output");
  });

  test("tooltip is undefined when description is omitted", () => {
    const item = new BuildOptionCheckboxItem("opt", "Verbose", false);
    assert.strictEqual(item.tooltip, undefined);
  });
});

suite("BuildOptionMultistateHeaderItem tooltip", () => {
  test("tooltip is set when description is provided", () => {
    const item = new BuildOptionMultistateHeaderItem("opt", "Level", "Off", [], false, false, "Sets verbosity level");
    assert.strictEqual(item.tooltip, "Sets verbosity level");
  });

  test("tooltip is undefined when description is omitted", () => {
    const item = new BuildOptionMultistateHeaderItem("opt", "Level", "Off", [], false, false);
    assert.strictEqual(item.tooltip, undefined);
  });
});

suite("BuildOptionStateItem tooltip", () => {
  test("tooltip is set when state description is provided", () => {
    const item = new BuildOptionStateItem("opt", "swo", "SWO", false, "Route the debug console over SWO.");
    assert.strictEqual(item.tooltip, "Route the debug console over SWO.");
  });

  test("tooltip is undefined when state description is omitted", () => {
    const item = new BuildOptionStateItem("opt", "swo", "SWO", false);
    assert.strictEqual(item.tooltip, undefined);
  });
});

// ---------------------------------------------------------------------------
// Preset-relative mismatch/unresolved rendering (feature 009, US2)
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

function makeValidArtifact(overrides: Partial<ActiveCompileCommandsArtifact> = {}): ActiveCompileCommandsArtifact {
  return {
    path: "/build/model-t/compile_commands_core.cc.json",
    exists: true,
    status: "valid",
    contextKey: "T2T1::hw::core",
    ...overrides,
  };
}

function makeMissingArtifact(overrides: Partial<ActiveCompileCommandsArtifact> = {}): ActiveCompileCommandsArtifact {
  return {
    path: "/build/model-t/compile_commands_core.cc.json",
    exists: false,
    status: "missing",
    missingReason: "Expected compile-commands artifact not found.",
    contextKey: "T2T1::hw::core",
    ...overrides,
  };
}

suite("CompileCommandsArtifactItem – label and identity", () => {
  test("label is 'Compile Commands'", () => {
    const item = new CompileCommandsArtifactItem(makeValidArtifact());
    assert.strictEqual(item.label, "Compile Commands");
  });

  test("id is 'artifact:compile-commands'", () => {
    const item = new CompileCommandsArtifactItem(makeValidArtifact());
    assert.strictEqual(item.id, "artifact:compile-commands");
  });

  test("contextValue is 'artifact-compile-commands'", () => {
    const item = new CompileCommandsArtifactItem(makeValidArtifact());
    assert.strictEqual(item.contextValue, "artifact-compile-commands");
  });

  test("collapsibleState is None", () => {
    const item = new CompileCommandsArtifactItem(makeValidArtifact());
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });
});

suite("CompileCommandsArtifactItem – valid artifact", () => {
  test("description is 'valid'", () => {
    const item = new CompileCommandsArtifactItem(makeValidArtifact());
    assert.strictEqual(item.description, "valid");
  });

  test("icon is 'pass' theme icon", () => {
    const item = new CompileCommandsArtifactItem(makeValidArtifact());
    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "pass");
  });

  test("tooltip includes the artifact path", () => {
    const artifact = makeValidArtifact({ path: "/build/model-t/compile_commands_core.cc.json" });
    const item = new CompileCommandsArtifactItem(artifact);
    assert.ok(
      String(item.tooltip).includes("/build/model-t/compile_commands_core.cc.json"),
      `expected tooltip to include path, got: ${item.tooltip}`
    );
  });
});

suite("CompileCommandsArtifactItem – missing artifact", () => {
  test("description is 'missing'", () => {
    const item = new CompileCommandsArtifactItem(makeMissingArtifact());
    assert.strictEqual(item.description, "missing");
  });

  test("icon is 'error' theme icon", () => {
    const item = new CompileCommandsArtifactItem(makeMissingArtifact());
    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "error");
  });

  test("tooltip shows missingReason when present", () => {
    const artifact = makeMissingArtifact({ missingReason: "Build artifact not found." });
    const item = new CompileCommandsArtifactItem(artifact);
    assert.ok(
      String(item.tooltip).startsWith("Missing: /build/model-t/compile_commands_core.cc.json"),
      `expected compact missing tooltip, got: ${item.tooltip}`
    );
  });

  test("tooltip falls back to a missing-state message with resolved path when missingReason is absent", () => {
    const artifact: ActiveCompileCommandsArtifact = {
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

function makeValidBinaryArtifact(overrides: Partial<ActiveBinaryArtifact> = {}): ActiveBinaryArtifact {
  return {
    path: "/build/model-t/firmware_core.bin",
    exists: true,
    status: "valid",
    contextKey: "T2T1::hw::core",
    ...overrides,
  };
}

function makeMissingBinaryArtifact(overrides: Partial<ActiveBinaryArtifact> = {}): ActiveBinaryArtifact {
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
    const item = new BinaryArtifactItem(makeValidBinaryArtifact());
    assert.strictEqual(item.label, "Binary");
  });

  test("id is 'artifact:binary'", () => {
    const item = new BinaryArtifactItem(makeValidBinaryArtifact());
    assert.strictEqual(item.id, "artifact:binary");
  });

  test("contextValue is 'artifact-binary'", () => {
    const item = new BinaryArtifactItem(makeValidBinaryArtifact());
    assert.strictEqual(item.contextValue, "artifact-binary");
  });

  test("collapsibleState is None", () => {
    const item = new BinaryArtifactItem(makeValidBinaryArtifact());
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });
});

suite("BinaryArtifactItem – valid artifact", () => {
  test("description is 'valid'", () => {
    const item = new BinaryArtifactItem(makeValidBinaryArtifact());
    assert.strictEqual(item.description, "valid");
  });

  test("icon is 'pass' theme icon", () => {
    const item = new BinaryArtifactItem(makeValidBinaryArtifact());
    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "pass");
  });

  test("tooltip includes the artifact path", () => {
    const artifact = makeValidBinaryArtifact({ path: "/build/model-t/firmware_core.bin" });
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
    const artifact: ActiveBinaryArtifact = {
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

function makeValidMapArtifact(overrides: Partial<ActiveMapArtifact> = {}): ActiveMapArtifact {
  return {
    path: "/build/model-t/firmware_core.map",
    exists: true,
    status: "valid",
    contextKey: "T2T1::hw::core",
    ...overrides,
  };
}

function makeMissingMapArtifact(overrides: Partial<ActiveMapArtifact> = {}): ActiveMapArtifact {
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
    const item = new MapArtifactItem(makeValidMapArtifact());
    assert.strictEqual(item.label, "Map File");
  });

  test("id is 'artifact:map'", () => {
    const item = new MapArtifactItem(makeValidMapArtifact());
    assert.strictEqual(item.id, "artifact:map");
  });

  test("contextValue is 'artifact-map'", () => {
    const item = new MapArtifactItem(makeValidMapArtifact());
    assert.strictEqual(item.contextValue, "artifact-map");
  });

  test("collapsibleState is None", () => {
    const item = new MapArtifactItem(makeValidMapArtifact());
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });
});

suite("MapArtifactItem – valid artifact", () => {
  test("description is 'valid'", () => {
    const item = new MapArtifactItem(makeValidMapArtifact());
    assert.strictEqual(item.description, "valid");
  });

  test("icon is 'pass' theme icon", () => {
    const item = new MapArtifactItem(makeValidMapArtifact());
    assert.ok(item.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "pass");
  });

  test("tooltip includes the artifact path", () => {
    const artifact = makeValidMapArtifact({ path: "/build/model-t/firmware_core.map" });
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
    const artifact: ActiveMapArtifact = {
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

suite("ConfigurationTreeProvider – Binary/Map artifact refresh", () => {
  let provider: ConfigurationTreeProvider;

  setup(() => {
    provider = new ConfigurationTreeProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  function getBuildArtifactsChildren(): vscode.TreeItem[] {
    return provider.paneRootChildren("build-artifacts");
  }

  test("switching artifact context replaces Binary and Map rows with the new paths", () => {
    provider.updateArtifact(
      makeValidArtifact({
        path: "/build/model-t/compile_commands_core.cc.json",
        contextKey: "T2T1::hw::core",
      })
    );
    provider.updateBinaryArtifact(
      makeValidBinaryArtifact({
        path: "/build/model-t/firmware_core.bin",
        contextKey: "T2T1::hw::core",
      })
    );
    provider.updateMapArtifact(
      makeValidMapArtifact({
        path: "/build/model-t/firmware_core.map",
        contextKey: "T2T1::hw::core",
      })
    );

    provider.updateArtifact(
      makeValidArtifact({
        path: "/build/model-t3/compile_commands_boot_emu.cc.json",
        contextKey: "T3W1::emu::bootloader",
      })
    );
    provider.updateBinaryArtifact(
      makeValidBinaryArtifact({
        path: "/build/model-t3/firmware_boot_emu.bin",
        contextKey: "T3W1::emu::bootloader",
      })
    );
    provider.updateMapArtifact(
      makeValidMapArtifact({
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
    provider.updateArtifact(makeValidArtifact());
    provider.updateBinaryArtifact(makeValidBinaryArtifact());
    provider.updateMapArtifact(makeValidMapArtifact());

    provider.updateBinaryArtifact(null);
    provider.updateMapArtifact(null);

    const children = getBuildArtifactsChildren();
    assert.strictEqual(children.length, 1, "only compile-commands row should remain");
    assert.ok(children[0] instanceof CompileCommandsArtifactItem);
  });
});

// ---------------------------------------------------------------------------
// ExecutableArtifactItem rendering
// ---------------------------------------------------------------------------

function makeValidExecutableArtifact(overrides: Partial<ActiveExecutableArtifact> = {}): ActiveExecutableArtifact {
  return {
    contextKey: "T2T1::hw::core",
    profileResolutionState: "selected",
    expectedPath: "/build/model-t/firmware.elf",
    exists: true,
    status: "valid",
    tooltip: "/build/model-t/firmware.elf",
    matchingProfileCount: 1,
    ...overrides,
  };
}

function makeMissingExecutableArtifact(overrides: Partial<ActiveExecutableArtifact> = {}): ActiveExecutableArtifact {
  return {
    contextKey: "T2T1::hw::core",
    profileResolutionState: "selected",
    expectedPath: "/build/model-t/firmware.elf",
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
    const item = new ExecutableArtifactItem(makeValidExecutableArtifact());
    assert.strictEqual(item.label, "Executable");
  });

  test("id is 'artifact:executable'", () => {
    const item = new ExecutableArtifactItem(makeValidExecutableArtifact());
    assert.strictEqual(item.id, "artifact:executable");
  });

  test("contextValue is 'artifact-executable'", () => {
    const item = new ExecutableArtifactItem(makeValidExecutableArtifact());
    assert.strictEqual(item.contextValue, "artifact-executable");
  });

  test("collapsibleState is None", () => {
    const item = new ExecutableArtifactItem(makeValidExecutableArtifact());
    assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });
});

suite("ExecutableArtifactItem – valid status rendering", () => {
  test("icon is 'pass' when status is valid", () => {
    const item = new ExecutableArtifactItem(makeValidExecutableArtifact());
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "pass");
  });

  test("description is 'valid'", () => {
    const item = new ExecutableArtifactItem(makeValidExecutableArtifact());
    assert.strictEqual(item.description, "valid");
  });

  test("tooltip contains the executable path", () => {
    const item = new ExecutableArtifactItem(makeValidExecutableArtifact());
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
      expectedPath: "",
    }));
    assert.ok(String(item.tooltip).length > 0);
  });

  test("missing-reason entries: manifest-invalid tooltip is non-empty", () => {
    const item = new ExecutableArtifactItem(makeMissingExecutableArtifact({
      profileResolutionState: "manifest-invalid",
      tooltip: "Debug configuration has validation errors.",
      expectedPath: "",
    }));
    assert.ok(String(item.tooltip).length > 0);
  });
});

suite("ConfigurationTreeProvider – Executable row", () => {
  let provider: ConfigurationTreeProvider;

  setup(() => {
    provider = new ConfigurationTreeProvider();
  });

  function getBuildArtifactsChildrenExec(): vscode.TreeItem[] {
    return provider.paneRootChildren("build-artifacts");
  }

  test("Executable row appears when updateExecutableArtifact is called with valid artifact", () => {
    provider.updateArtifact(makeValidArtifact());
    provider.updateExecutableArtifact(makeValidExecutableArtifact());
    const children = getBuildArtifactsChildrenExec();
    assert.ok(
      children.some((c) => c instanceof ExecutableArtifactItem),
      "expected ExecutableArtifactItem in Build Artifacts"
    );
  });

  test("Executable row appears even when status is missing", () => {
    provider.updateArtifact(makeValidArtifact());
    provider.updateExecutableArtifact(makeMissingExecutableArtifact());
    const children = getBuildArtifactsChildrenExec();
    assert.ok(
      children.some((c) => c instanceof ExecutableArtifactItem),
      "expected ExecutableArtifactItem even when status is missing"
    );
  });

  test("Executable row does not appear when updateExecutableArtifact is not called", () => {
    provider.updateArtifact(makeValidArtifact());
    const children = getBuildArtifactsChildrenExec();
    assert.ok(
      !children.some((c) => c instanceof ExecutableArtifactItem),
      "unexpected ExecutableArtifactItem when artifact not set"
    );
  });

  test("Executable row does not appear after updateExecutableArtifact(null)", () => {
    provider.updateArtifact(makeValidArtifact());
    provider.updateExecutableArtifact(makeValidExecutableArtifact());
    provider.updateExecutableArtifact(null);
    const children = getBuildArtifactsChildrenExec();
    assert.ok(
      !children.some((c) => c instanceof ExecutableArtifactItem),
      "expected no ExecutableArtifactItem after clearing"
    );
  });

  test("Executable row appears after Map File row when Binary and Map are present", () => {
    provider.updateArtifact(makeValidArtifact());
    provider.updateBinaryArtifact(makeValidBinaryArtifact());
    provider.updateMapArtifact(makeValidMapArtifact());
    provider.updateExecutableArtifact(makeValidExecutableArtifact());
    const children = getBuildArtifactsChildrenExec();
    const binaryIdx = children.findIndex((c) => c instanceof BinaryArtifactItem);
    const mapIdx = children.findIndex((c) => c instanceof MapArtifactItem);
    const execIdx = children.findIndex((c) => c instanceof ExecutableArtifactItem);
    assert.ok(binaryIdx >= 0, "expected BinaryArtifactItem");
    assert.ok(mapIdx >= 0, "expected MapArtifactItem");
    assert.ok(execIdx > mapIdx, `expected Executable after Map (map@${mapIdx}, exec@${execIdx})`);
  });

  test("Executable row appears immediately after Compile Commands when no Binary/Map", () => {
    provider.updateArtifact(makeValidArtifact());
    provider.updateExecutableArtifact(makeValidExecutableArtifact());
    const children = getBuildArtifactsChildrenExec();
    const ccIdx = children.findIndex((c) => c instanceof CompileCommandsArtifactItem);
    const execIdx = children.findIndex((c) => c instanceof ExecutableArtifactItem);
    assert.strictEqual(ccIdx, 0, "CompileCommands should be first");
    assert.strictEqual(execIdx, 1, "Executable should be immediately after CompileCommands");
  });

  test("clearing Executable artifact removes the row", () => {
    provider.updateArtifact(makeValidArtifact());
    provider.updateExecutableArtifact(makeValidExecutableArtifact());
    provider.updateExecutableArtifact(null);
    const children = getBuildArtifactsChildrenExec();
    assert.strictEqual(children.length, 1, "only compile-commands row should remain");
    assert.ok(children[0] instanceof CompileCommandsArtifactItem);
  });

  test("Executable row tooltip reflects the tooltip from the artifact", () => {
    provider.updateArtifact(makeValidArtifact());
    const artifact = makeValidExecutableArtifact({ tooltip: "/custom/path/to/firmware.elf" });
    provider.updateExecutableArtifact(artifact);
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
// ConfigurationTreeProvider – Preset selector (feature 009, US1)
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

function makeActiveConfig(): ActiveConfig {
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

suite("ConfigurationTreeProvider – Preset selector", () => {
  let provider: ConfigurationTreeProvider;

  setup(() => {
    provider = new ConfigurationTreeProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  function buildContextChildren(): vscode.TreeItem[] {
    return provider.paneRootChildren("build-selection");
  }

  test("Preset is the fourth Build Selection child, directly below Component (FR-001)", () => {
    provider.update(makeManifestState(), makeActiveConfig(), []);
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
    provider.update(makeManifestState(), makeActiveConfig(), []);
    const children = buildContextChildren() as SelectorHeaderItem[];
    assert.strictEqual(children[3].description, "—");
  });

  test("description shows 'Default' for the synthetic choice", () => {
    provider.update(makeManifestState(), makeActiveConfig(), []);
    const { state } = makeLoadedPresetState(DEFAULT_ONLY);
    provider.updatePresets(state, "default", DEFAULT_ONLY);
    const children = buildContextChildren() as SelectorHeaderItem[];
    assert.strictEqual(children[3].description, "Default");
  });

  test("description shows the active named preset's label", () => {
    provider.update(makeManifestState(), makeActiveConfig(), []);
    const available: PresetChoice[] = [
      { id: "default", label: "Default", isDefault: true },
      { id: "test", label: "test", isDefault: false },
    ];
    const { state } = makeLoadedPresetState(available);
    provider.updatePresets(state, "test", available);
    const children = buildContextChildren() as SelectorHeaderItem[];
    assert.strictEqual(children[3].description, "test");
  });

  test("preset state undefined renders the loading placeholder when expanded", () => {
    provider.update(makeManifestState(), makeActiveConfig(), []);
    provider.setExpandedSelector("preset");
    const children = provider.getChildren(
      new SelectorHeaderItem("preset", "Preset", undefined, true)
    );
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof PlaceholderItem);
  });

  test("preset state invalid replaces all choices with a warning row naming the failing file", () => {
    provider.update(makeManifestState(), makeActiveConfig(), []);
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
    provider.updatePresets(invalidState, "default", []);
    provider.setExpandedSelector("preset");
    const children = provider.getChildren(
      new SelectorHeaderItem("preset", "Preset", undefined, true)
    );
    assert.ok(children[0] instanceof WarningItem);
    assert.ok(
      String(children[0].label).includes("presets.toml"),
      `expected the warning to name the failing file, got: ${children[0].label}`
    );
    assert.ok(children[1] instanceof PlaceholderItem);
  });

  test("preset state unavailable replaces all choices with a presets.toml-is-unavailable row (FR-027)", () => {
    provider.update(makeManifestState(), makeActiveConfig(), []);
    const unavailableState: PresetState = {
      status: "unavailable",
      // The shared file does not exist; the user file may or may not.
      shared: makePresetFile({ source: "shared", present: false }),
      user: makePresetFile({ source: "user", names: ["local"] }),
      loadedAt: new Date(),
      validationIssues: [],
    };
    provider.updatePresets(unavailableState, "default", []);
    provider.setExpandedSelector("preset");
    const children = provider.getChildren(
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

  test("description reads 'Unavailable' while presets.toml is absent (FR-027)", () => {
    provider.update(makeManifestState(), makeActiveConfig(), []);
    const unavailableState: PresetState = {
      status: "unavailable",
      shared: makePresetFile({ source: "shared", present: false }),
      user: makePresetFile({ source: "user" }),
      loadedAt: new Date(),
      validationIssues: [],
    };
    // The saved id is preserved unresolved (FR-031), so it must not be shown
    // as though that preset were in effect.
    provider.updatePresets(unavailableState, "test", []);
    const children = buildContextChildren() as SelectorHeaderItem[];
    assert.strictEqual(children[3].description, "Unavailable");
  });

  test("preset state loaded lists Default first, then named presets, with the active one marked", () => {
    provider.update(makeManifestState(), makeActiveConfig(), []);
    const available: PresetChoice[] = [
      { id: "default", label: "Default", isDefault: true },
      { id: "test", label: "test", isDefault: false },
    ];
    const { state } = makeLoadedPresetState(available);
    provider.updatePresets(state, "test", available);
    provider.setExpandedSelector("preset");
    const children = provider.getChildren(
      new SelectorHeaderItem("preset", "Preset", undefined, true)
    ) as SelectorChoiceItem[];
    assert.strictEqual(children.length, 2);
    assert.strictEqual(children[0].entryId, "default");
    assert.strictEqual(children[1].entryId, "test");
    assert.strictEqual(children[1].description, "active");
    assert.strictEqual(children[0].description, undefined);
  });

  test("every listed preset renders as a plain selectable row, whatever the build context (FR-006)", () => {
    provider.update(makeManifestState(), makeActiveConfig(), []);
    // The provider is handed the full declared list, including presets no
    // fragment of which applies here; none of them is marked or disabled.
    const available: PresetChoice[] = [
      { id: "default", label: "Default", isDefault: true },
      { id: "test", label: "test", isDefault: false },
      { id: "prodtest", label: "prodtest", isDefault: false },
    ];
    const { state } = makeLoadedPresetState(available);
    provider.updatePresets(state, "default", available);
    provider.setExpandedSelector("preset");
    const children = provider.getChildren(
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

  test("only one selector expands at a time; expanding preset collapses model (FR-002)", () => {
    provider.update(makeManifestState(), makeActiveConfig(), []);
    provider.setExpandedSelector("model");
    assert.strictEqual(provider.getExpandedSelector(), "model");
    provider.setExpandedSelector("preset");
    assert.strictEqual(provider.getExpandedSelector(), "preset");

    const modelChildren = provider.getChildren(
      new SelectorHeaderItem("model", "Model", undefined, false)
    );
    assert.strictEqual(modelChildren.length, 0, "model choices should not render while collapsed");
  });
});

// ---------------------------------------------------------------------------
// ConfigurationTreeProvider – Build Options preset-relative emphasis (US2)
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

function getBuildOptionsChildren(provider: ConfigurationTreeProvider): vscode.TreeItem[] {
  return provider.paneRootChildren("build-options");
}

suite("ConfigurationTreeProvider – Build Options preset-relative emphasis", () => {
  let provider: ConfigurationTreeProvider;

  setup(() => {
    provider = new ConfigurationTreeProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  test("checkbox row is emphasized only when isOverride is true", () => {
    const opt = checkboxOption("frozen", "--frozen");
    provider.update(
      makeManifestState(),
      makeActiveConfig(),
      [resolved(opt, { value: false, presetState: "resolved", isOverride: true })]
    );
    const [item] = getBuildOptionsChildren(provider) as BuildOptionCheckboxItem[];
    assert.deepStrictEqual(item.label, { label: "frozen", highlights: [[0, 6]] });
  });

  test("checkbox row is not emphasized when isOverride is false, even if value is true", () => {
    const opt = checkboxOption("frozen", "--frozen");
    provider.update(
      makeManifestState(),
      makeActiveConfig(),
      [resolved(opt, { value: true, presetState: "resolved", isOverride: false })]
    );
    const [item] = getBuildOptionsChildren(provider) as BuildOptionCheckboxItem[];
    assert.strictEqual(item.label, "frozen");
  });

  test("multistate row is emphasized only when isOverride is true", () => {
    const states = [
      { id: "null", label: "Default", flag: "" },
      { id: "swo", label: "SWO", flag: "--dbg-console=swo" },
    ];
    const opt = multistateOption("dbg-console", "--dbg-console", states);
    provider.update(
      makeManifestState(),
      makeActiveConfig(),
      [resolved(opt, { value: "swo", presetState: "resolved", presetValue: "null", isOverride: true })]
    );
    const [item] = getBuildOptionsChildren(provider) as BuildOptionMultistateHeaderItem[];
    assert.deepStrictEqual(item.label, { label: "dbg-console", highlights: [[0, 11]] });
  });

  test("multistate row is not emphasized when isOverride is false, regardless of which state is active", () => {
    const states = [
      { id: "null", label: "Default", flag: "" },
      { id: "swo", label: "SWO", flag: "--dbg-console=swo" },
    ];
    const opt = multistateOption("dbg-console", "--dbg-console", states);
    provider.update(
      makeManifestState(),
      makeActiveConfig(),
      [resolved(opt, { value: "swo", presetState: "resolved", presetValue: "swo", isOverride: false })]
    );
    const [item] = getBuildOptionsChildren(provider) as BuildOptionMultistateHeaderItem[];
    assert.strictEqual(item.label, "dbg-console");
  });

  test("collapsed group header is emphasized when any member has isOverride true", () => {
    const optA = checkboxOption("alpha", "--alpha", "Group");
    const optB = checkboxOption("beta", "--beta", "Group");
    provider.update(
      makeManifestState(),
      makeActiveConfig(),
      [
        resolved(optA, { value: false, presetState: "resolved", isOverride: false }),
        resolved(optB, { value: true, presetState: "resolved", isOverride: true }),
      ]
    );
    provider.setGroupCollapsed("Group", true);
    const [group] = getBuildOptionsChildren(provider) as BuildOptionGroupItem[];
    assert.deepStrictEqual(group.label, { label: "Group", highlights: [[0, 5]] });
  });

  test("mismatch checkbox row shows the warning icon and names the unrepresentable value", () => {
    const opt = checkboxOption("frozen", "--frozen");
    provider.update(
      makeManifestState(),
      makeActiveConfig(),
      [resolved(opt, { presetState: "mismatch", isOverride: false })]
    );
    const [item] = getBuildOptionsChildren(provider) as BuildOptionCheckboxItem[];
    assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, "warning");
  });

  test("unresolved multistate row renders with non-selectable state children", () => {
    const states = [
      { id: "true", label: "Enabled", flag: "--pyopt=true" },
      { id: "false", label: "Disabled", flag: "--pyopt=false" },
    ];
    const opt = multistateOption("pyopt", "--pyopt", states);
    provider.update(
      makeManifestState(),
      makeActiveConfig(),
      [resolved(opt, { value: "true", presetState: "unresolved", isOverride: false })]
    );
    provider.setExpandedMultistateKey("pyopt");
    const [item] = getBuildOptionsChildren(provider) as BuildOptionMultistateHeaderItem[];
    assert.ok(item.stateChildren.length > 0);
    for (const stateChild of item.stateChildren) {
      assert.strictEqual(stateChild.command, undefined, "unresolved state children must not be selectable");
    }
  });
});

// ---------------------------------------------------------------------------
// ConfigurationTreeProvider – per-pane root children (paneRootChildren)
// Each PaneId's root rows must match today's section content exactly, for
// every state the row-inventory (specs/010-split-configuration-panes/checklists/row-inventory.md)
// records. This is the reference the pane split is checked against (FR-002).
// ---------------------------------------------------------------------------

suite("ConfigurationTreeProvider – paneRootChildren('build-selection')", () => {
  let provider: ConfigurationTreeProvider;

  setup(() => {
    provider = new ConfigurationTreeProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  test("loading: renders the loading placeholder before any manifest state is set", () => {
    const children = provider.paneRootChildren("build-selection");
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof PlaceholderItem);
    assert.strictEqual(children[0].label, "Loading…");
  });

  test("missing: renders the missing-manifest warning and placeholder", () => {
    provider.update({
      status: "missing",
      manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
    });
    const children = provider.paneRootChildren("build-selection");
    assert.ok(children[0] instanceof WarningItem);
    assert.ok(children[1] instanceof PlaceholderItem);
  });

  test("invalid: renders the validation-error warning and placeholder", () => {
    provider.update({
      status: "invalid",
      manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
      validationIssues: [{ severity: "error", code: "invalid-type", message: "bad" }],
      loadedAt: new Date(),
    });
    const children = provider.paneRootChildren("build-selection");
    assert.ok(children[0] instanceof WarningItem);
    assert.ok(String(children[0].label).includes("1 validation error"));
    assert.ok(children[1] instanceof PlaceholderItem);
  });

  test("loaded: renders the four selector headers in order", () => {
    provider.update(makeManifestState(), makeActiveConfig(), []);
    const paneChildren = provider.paneRootChildren("build-selection") as SelectorHeaderItem[];
    assert.strictEqual(paneChildren.length, 4);
    assert.deepStrictEqual(
      paneChildren.map((c) => c.selectorKind),
      ["model", "target", "component", "preset"]
    );
  });
});

suite("ConfigurationTreeProvider – paneRootChildren('build-options')", () => {
  let provider: ConfigurationTreeProvider;

  setup(() => {
    provider = new ConfigurationTreeProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  test("loading: renders the loading placeholder before any manifest state is set", () => {
    const children = provider.paneRootChildren("build-options");
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof PlaceholderItem);
    assert.strictEqual(children[0].label, "Loading…");
  });

  test("missing: renders the unavailable-manifest placeholder", () => {
    provider.update({
      status: "missing",
      manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
    });
    const children = provider.paneRootChildren("build-options");
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof PlaceholderItem);
    assert.strictEqual(children[0].label, "No manifest — Build Options unavailable");
  });

  test("invalid: renders the invalid-manifest placeholder", () => {
    provider.update({
      status: "invalid",
      manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
      validationIssues: [{ severity: "error", code: "invalid-type", message: "bad" }],
      loadedAt: new Date(),
    });
    const children = provider.paneRootChildren("build-options");
    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0].label, "Manifest is invalid — Build Options unavailable");
  });

  test("workflow-blocked: renders the blocked-workflow warning and placeholder", () => {
    provider.update({ ...makeManifestState(), hasWorkflowBlockingIssues: true }, makeActiveConfig(), []);
    const children = provider.paneRootChildren("build-options");
    assert.ok(children[0] instanceof WarningItem);
    assert.ok(String(children[0].label).includes("Build workflow blocked"));
    assert.ok(children[1] instanceof PlaceholderItem);
  });

  test("no-options-defined: renders the no-build-options placeholder when nothing was resolved", () => {
    provider.update(makeManifestState(), makeActiveConfig(), []);
    const children = provider.paneRootChildren("build-options");
    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0].label, "No build options defined");
  });

  test("no-options-available: renders the not-available placeholder when every option is unavailable", () => {
    const opt = checkboxOption("frozen", "--frozen");
    provider.update(makeManifestState(), makeActiveConfig(), [resolved(opt, { available: false })]);
    const children = provider.paneRootChildren("build-options");
    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0].label, "No options available for the active build context");
  });

  test("loaded: renders an emphasized checkbox row for an overridden option", () => {
    const opt = checkboxOption("frozen", "--frozen");
    provider.update(makeManifestState(), makeActiveConfig(), [resolved(opt, { value: true, isOverride: true })]);
    const [item] = provider.paneRootChildren("build-options") as BuildOptionCheckboxItem[];
    assert.strictEqual(item.checkboxState, vscode.TreeItemCheckboxState.Checked);
    assert.deepStrictEqual(item.label, { label: "frozen", highlights: [[0, 6]] });
  });
});

suite("ConfigurationTreeProvider – paneRootChildren('build-artifacts')", () => {
  let provider: ConfigurationTreeProvider;

  setup(() => {
    provider = new ConfigurationTreeProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  test("not-yet-evaluated: renders the not-yet-evaluated placeholder before any artifact update", () => {
    const children = provider.paneRootChildren("build-artifacts");
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof PlaceholderItem);
    assert.strictEqual(children[0].label, "IntelliSense not yet evaluated");
  });

  test("evaluated: renders Compile Commands then Binary once both are set", () => {
    provider.updateArtifact(makeValidArtifact());
    provider.updateBinaryArtifact(makeValidBinaryArtifact());
    const children = provider.paneRootChildren("build-artifacts");
    assert.strictEqual(children.length, 2);
    assert.ok(children[0] instanceof CompileCommandsArtifactItem);
    assert.ok(children[1] instanceof BinaryArtifactItem);
  });
});

// ---------------------------------------------------------------------------
// ConfigurationTreeProvider – per-pane refresh signal (onDidChangePane)
// Each update*() entry point must signal exactly the panes whose rows it
// affects (research.md R4), so a facade relays only what concerns its pane.
// ---------------------------------------------------------------------------

suite("ConfigurationTreeProvider – onDidChangePane fan-out", () => {
  let provider: ConfigurationTreeProvider;

  setup(() => {
    provider = new ConfigurationTreeProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  function collectPanes(action: () => void): PaneId[] {
    const seen: PaneId[] = [];
    const sub = provider.onDidChangePane((paneId) => seen.push(paneId));
    action();
    sub.dispose();
    return seen;
  }

  test("update() signals build-selection and build-options", () => {
    const seen = collectPanes(() => provider.update(makeManifestState(), makeActiveConfig(), []));
    assert.deepStrictEqual(new Set(seen), new Set(["build-selection", "build-options"]));
  });

  test("updatePresets() signals build-selection and build-options", () => {
    const seen = collectPanes(() => provider.updatePresets(undefined, undefined, []));
    assert.deepStrictEqual(new Set(seen), new Set(["build-selection", "build-options"]));
  });

  test("updateArtifact() signals only build-artifacts", () => {
    const seen = collectPanes(() => provider.updateArtifact(makeValidArtifact()));
    assert.deepStrictEqual(seen, ["build-artifacts"]);
  });

  test("updateBinaryArtifact() signals only build-artifacts", () => {
    const seen = collectPanes(() => provider.updateBinaryArtifact(makeValidBinaryArtifact()));
    assert.deepStrictEqual(seen, ["build-artifacts"]);
  });

  test("updateMapArtifact() signals only build-artifacts", () => {
    const seen = collectPanes(() => provider.updateMapArtifact(makeValidMapArtifact()));
    assert.deepStrictEqual(seen, ["build-artifacts"]);
  });

  test("updateExecutableArtifact() signals only build-artifacts", () => {
    const seen = collectPanes(() => provider.updateExecutableArtifact(makeValidExecutableArtifact()));
    assert.deepStrictEqual(seen, ["build-artifacts"]);
  });

  test("setExpandedSelector() signals only build-selection", () => {
    provider.update(makeManifestState(), makeActiveConfig(), []);
    const seen = collectPanes(() => provider.setExpandedSelector("model"));
    assert.deepStrictEqual(seen, ["build-selection"]);
  });

  test("setExpandedMultistateKey() signals only build-options", () => {
    const seen = collectPanes(() => provider.setExpandedMultistateKey("verbose"));
    assert.deepStrictEqual(seen, ["build-options"]);
  });

  test("setGroupCollapsed() signals only build-options", () => {
    const seen = collectPanes(() => provider.setGroupCollapsed("Advanced", true));
    assert.deepStrictEqual(seen, ["build-options"]);
  });
});

// ---------------------------------------------------------------------------
// PaneTreeProvider facade (research.md R3): thin, stateless TreeDataProvider
// wrapping the owner's per-pane root builder, element dispatch, item
// identity, and change-event relay.
// ---------------------------------------------------------------------------

suite("PaneTreeProvider – root delegation", () => {
  let owner: ConfigurationTreeProvider;

  setup(() => {
    owner = new ConfigurationTreeProvider();
  });

  teardown(() => {
    owner.dispose();
  });

  test("getChildren(undefined) delegates to the owner's paneRootChildren for build-selection", () => {
    owner.update(makeManifestState(), makeActiveConfig(), []);
    const facade = new PaneTreeProvider(owner, "build-selection");
    assert.deepStrictEqual(facade.getChildren(undefined), owner.paneRootChildren("build-selection"));
  });

  test("getChildren(undefined) delegates to the owner's paneRootChildren for build-options", () => {
    const opt = checkboxOption("frozen", "--frozen");
    owner.update(makeManifestState(), makeActiveConfig(), [resolved(opt)]);
    const facade = new PaneTreeProvider(owner, "build-options");
    assert.deepStrictEqual(facade.getChildren(undefined), owner.paneRootChildren("build-options"));
  });

  test("getChildren(undefined) delegates to the owner's paneRootChildren for build-artifacts", () => {
    owner.updateArtifact(makeValidArtifact());
    const facade = new PaneTreeProvider(owner, "build-artifacts");
    assert.deepStrictEqual(facade.getChildren(undefined), owner.paneRootChildren("build-artifacts"));
  });

  test("a build-options facade never returns build-selection's root rows", () => {
    owner.update(makeManifestState(), makeActiveConfig(), []);
    const facade = new PaneTreeProvider(owner, "build-options");
    const rows = facade.getChildren(undefined);
    assert.ok(!rows.some((r) => r instanceof SelectorHeaderItem));
  });
});

suite("PaneTreeProvider – non-root delegation to the owner's element dispatch", () => {
  let owner: ConfigurationTreeProvider;

  setup(() => {
    owner = new ConfigurationTreeProvider();
  });

  teardown(() => {
    owner.dispose();
  });

  test("expands a selector header through the same dispatch as the owner", () => {
    owner.update(makeManifestState(), makeActiveConfig(), []);
    owner.setExpandedSelector("model");
    const facade = new PaneTreeProvider(owner, "build-selection");
    const [modelHeader] = facade.getChildren(undefined) as SelectorHeaderItem[];
    assert.deepStrictEqual(facade.getChildren(modelHeader), owner.getChildren(modelHeader));
    assert.ok(facade.getChildren(modelHeader).length > 0);
  });

  test("expands a multistate option header through the same dispatch as the owner", () => {
    const states = [{ id: "off", label: "Off", flag: "" }];
    const opt = multistateOption("verbose", "--verbose", states);
    owner.update(makeManifestState(), makeActiveConfig(), [resolved(opt)]);
    owner.setExpandedMultistateKey("verbose");
    const facade = new PaneTreeProvider(owner, "build-options");
    const [header] = facade.getChildren(undefined) as BuildOptionMultistateHeaderItem[];
    assert.deepStrictEqual(facade.getChildren(header), owner.getChildren(header));
  });

  test("expands a build-option group through the same dispatch as the owner", () => {
    const optA = checkboxOption("alpha", "--alpha", "Group");
    owner.update(makeManifestState(), makeActiveConfig(), [resolved(optA)]);
    const facade = new PaneTreeProvider(owner, "build-options");
    const [group] = facade.getChildren(undefined) as BuildOptionGroupItem[];
    assert.deepStrictEqual(facade.getChildren(group), owner.getChildren(group));
  });
});

// ---------------------------------------------------------------------------
// US3 (T017): every interaction still behaves as it does today when driven
// through the pane providers, not the owner directly — selector accordion
// behavior, multistate expansion, option-group collapse, and checkbox state.
// ---------------------------------------------------------------------------

suite("PaneTreeProvider – selector accordion behavior (US3)", () => {
  let owner: ConfigurationTreeProvider;
  let buildSelection: PaneTreeProvider;

  setup(() => {
    owner = new ConfigurationTreeProvider();
    buildSelection = new PaneTreeProvider(owner, "build-selection");
    owner.update(makeManifestState(), makeActiveConfig(), []);
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

suite("PaneTreeProvider – multistate expansion, group collapse, and checkbox state (US3)", () => {
  let owner: ConfigurationTreeProvider;
  let buildOptions: PaneTreeProvider;

  setup(() => {
    owner = new ConfigurationTreeProvider();
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
    owner.update(makeManifestState(), makeActiveConfig(), [resolved(opt, { value: "off", presetState: "resolved" })]);

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
    owner.update(makeManifestState(), makeActiveConfig(), [
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
    owner.update(makeManifestState(), makeActiveConfig(), [resolved(opt, { value: false })]);
    let [checkbox] = buildOptions.getChildren(undefined) as BuildOptionCheckboxItem[];
    assert.strictEqual(checkbox.checkboxState, vscode.TreeItemCheckboxState.Unchecked);

    // Simulate the extension re-resolving and re-rendering after a checkbox toggle.
    owner.update(makeManifestState(), makeActiveConfig(), [resolved(opt, { value: true })]);
    [checkbox] = buildOptions.getChildren(undefined) as BuildOptionCheckboxItem[];
    assert.strictEqual(checkbox.checkboxState, vscode.TreeItemCheckboxState.Checked);
  });
});

suite("PaneTreeProvider – getTreeItem identity", () => {
  test("returns the same element it was given, like the owner", () => {
    const owner = new ConfigurationTreeProvider();
    const facade = new PaneTreeProvider(owner, "build-artifacts");
    const item = new PlaceholderItem("anything");
    assert.strictEqual(facade.getTreeItem(item), item);
    owner.dispose();
  });
});

suite("PaneTreeProvider – change-event relay", () => {
  let owner: ConfigurationTreeProvider;

  setup(() => {
    owner = new ConfigurationTreeProvider();
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
    owner.updateArtifact(makeValidArtifact());
    sub.dispose();
    assert.strictEqual(fired, 1);
  });

  test("does not fire for a pane change that belongs to a different PaneId", () => {
    const facade = new PaneTreeProvider(owner, "build-artifacts");
    let fired = 0;
    const sub = facade.onDidChangeTreeData(() => {
      fired++;
    });
    owner.update(makeManifestState(), makeActiveConfig(), []);
    sub.dispose();
    assert.strictEqual(fired, 0);
  });
});

// ---------------------------------------------------------------------------
// No pane's rows contain a Build Selection / Build Options / Build Artifacts
// row — that is the removed SectionItem wrapper, not a row any pane renders
// (FR-003). Walks every reachable row per pane and per state.
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
  provider: ConfigurationTreeProvider,
  paneId: PaneId
): vscode.TreeItem[] {
  const all: vscode.TreeItem[] = [];
  const visit = (children: vscode.TreeItem[]): void => {
    for (const child of children) {
      all.push(child);
      visit(provider.getChildren(child));
    }
  };
  visit(provider.paneRootChildren(paneId));
  return all;
}

suite("ConfigurationTreeProvider – no section rows inside any pane (FR-003)", () => {
  let provider: ConfigurationTreeProvider;

  setup(() => {
    provider = new ConfigurationTreeProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  const PANE_IDS: PaneId[] = ["build-selection", "build-options", "build-artifacts"];

  test("loading state: no pane renders a forbidden section-name row", () => {
    for (const paneId of PANE_IDS) {
      for (const row of collectAllRows(provider, paneId)) {
        assert.ok(!FORBIDDEN_LABELS.has(labelText(row)), `pane '${paneId}' rendered forbidden row '${labelText(row)}'`);
      }
    }
  });

  test("missing manifest: no pane renders a forbidden section-name row", () => {
    provider.update({ status: "missing", manifestUri: vscode.Uri.file("/workspace/tbench.yaml") });
    for (const paneId of PANE_IDS) {
      for (const row of collectAllRows(provider, paneId)) {
        assert.ok(!FORBIDDEN_LABELS.has(labelText(row)), `pane '${paneId}' rendered forbidden row '${labelText(row)}'`);
      }
    }
  });

  test("invalid manifest: no pane renders a forbidden section-name row", () => {
    provider.update({
      status: "invalid",
      manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
      validationIssues: [{ severity: "error", code: "invalid-type", message: "bad" }],
      loadedAt: new Date(),
    });
    for (const paneId of PANE_IDS) {
      for (const row of collectAllRows(provider, paneId)) {
        assert.ok(!FORBIDDEN_LABELS.has(labelText(row)), `pane '${paneId}' rendered forbidden row '${labelText(row)}'`);
      }
    }
  });

  test("loaded manifest with expanded selectors, options, and artifacts: no pane renders a forbidden section-name row", () => {
    const optA = checkboxOption("alpha", "--alpha", "Group");
    const states = [{ id: "off", label: "Off", flag: "" }];
    const multi = multistateOption("verbose", "--verbose", states);
    provider.update(makeManifestState(), makeActiveConfig(), [resolved(optA), resolved(multi)]);
    provider.setExpandedSelector("model");
    provider.setExpandedMultistateKey("verbose");
    provider.updateArtifact(makeValidArtifact());
    provider.updateBinaryArtifact(makeValidBinaryArtifact());
    provider.updateMapArtifact(makeValidMapArtifact());
    provider.updateExecutableArtifact(makeValidExecutableArtifact());

    for (const paneId of PANE_IDS) {
      for (const row of collectAllRows(provider, paneId)) {
        assert.ok(!FORBIDDEN_LABELS.has(labelText(row)), `pane '${paneId}' rendered forbidden row '${labelText(row)}'`);
      }
    }
  });

});
