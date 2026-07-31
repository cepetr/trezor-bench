/**
 * Integration tests for build-context selector behavior.
 * Runs inside the VS Code extension host via @vscode/test-electron.
 *
 * These tests exercise ConfigurationTreeProvider and normalizeActiveConfig
 * together to validate selector rendering and normalization behavior.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import {
  ConfigurationTreeProvider,
  SectionItem,
  SelectorHeaderItem,
  SelectorChoiceItem,
  WarningItem,
} from "../../ui/configuration-tree";
import { normalizeActiveConfig } from "../../configuration/normalize-config";
import { ManifestStateLoaded } from "../../manifest/manifest-types";
import { ActiveConfig } from "../../configuration/active-config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLoadedState(
  overrides: Partial<ManifestStateLoaded> = {}
): ManifestStateLoaded {
  return {
    status: "loaded",
    manifestUri: vscode.Uri.file("/workspace/tf-tools.yaml"),
    models: [
      { kind: "model", id: "T2T1", name: "Trezor Model T" },
      { kind: "model", id: "T3W1", name: "Trezor Model T3" },
    ],
    targets: [
      { kind: "target", id: "hw", name: "Hardware", shortName: "HW" },
      { kind: "target", id: "emu", name: "Emulator" },
    ],
    components: [
      { kind: "component", id: "core", name: "Core" },
      { kind: "component", id: "prodtest", name: "Prodtest" },
    ],
    buildOptions: [],
    hasWorkflowBlockingIssues: false,
    debugProfiles: [],
    hasDebugBlockingIssues: false,
    validationIssues: [],
    loadedAt: new Date(),
    ...overrides,
  } as ManifestStateLoaded;
}

function activeConfig(
  modelId: string,
  targetId: string,
  componentId: string
): ActiveConfig {
  return { modelId, targetId, componentId, persistedAt: new Date().toISOString() };
}

function getBuildContextChildren(
  provider: ConfigurationTreeProvider
): vscode.TreeItem[] {
  const top = provider.getChildren() as vscode.TreeItem[];
  const contextSection = top.find(
    (item) => item instanceof SectionItem && (item as SectionItem).sectionId === "build-context"
  ) as SectionItem;
  assert.ok(contextSection, "build-context section not found");
  return provider.getChildren(contextSection) as vscode.TreeItem[];
}

// ---------------------------------------------------------------------------
// Suite: Selector rendering for loaded manifest
// ---------------------------------------------------------------------------

suite("ConfigurationTreeProvider – selector rendering", () => {
  let provider: ConfigurationTreeProvider;

  setup(() => {
    provider = new ConfigurationTreeProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  test("build-context shows four SelectorHeaderItems when manifest is loaded", () => {
    const config = activeConfig("T2T1", "hw", "core");
    provider.update(makeLoadedState(), config);

    const children = getBuildContextChildren(provider);
    assert.strictEqual(children.length, 4, "expected model, target, component, and preset headers");
    assert.ok(children[0] instanceof SelectorHeaderItem);
    assert.ok(children[1] instanceof SelectorHeaderItem);
    assert.ok(children[2] instanceof SelectorHeaderItem);
    assert.ok(children[3] instanceof SelectorHeaderItem);
  });

  test("SelectorHeaderItems have correct selectorKind values", () => {
    provider.update(makeLoadedState(), activeConfig("T2T1", "hw", "core"));
    const [model, target, component] = getBuildContextChildren(provider) as SelectorHeaderItem[];
    assert.strictEqual(model.selectorKind, "model");
    assert.strictEqual(target.selectorKind, "target");
    assert.strictEqual(component.selectorKind, "component");
  });

  test("SelectorHeaderItems reflect user-facing selected values as description", () => {
    provider.update(makeLoadedState(), activeConfig("T3W1", "emu", "prodtest"));
    const [model, target, component] = getBuildContextChildren(provider) as SelectorHeaderItem[];
    assert.strictEqual(model.description, "Trezor Model T3");
    assert.strictEqual(target.description, "Emulator");
    assert.strictEqual(component.description, "Prodtest");
  });

  test("SelectorHeaderItems use target shortName when available", () => {
    provider.update(makeLoadedState(), activeConfig("T2T1", "hw", "core"));
    const [, target] = getBuildContextChildren(provider) as SelectorHeaderItem[];
    assert.strictEqual(target.description, "HW");
  });

  test("SelectorHeaderItem description falls back to em dash when no active config is set", () => {
    provider.update(makeLoadedState()); // no activeConfig
    const [model] = getBuildContextChildren(provider) as SelectorHeaderItem[];
    assert.strictEqual(model.description, "—");
  });

  test("build-context shows WarningItem when manifest is missing", () => {
    provider.update({
      status: "missing",
      manifestUri: vscode.Uri.file("/workspace/tf-tools.yaml"),
    });
    const children = getBuildContextChildren(provider);
    assert.ok(children.some((c) => c instanceof WarningItem), "expected WarningItem");
  });
});

// ---------------------------------------------------------------------------
// Suite: SelectorChoiceItem rendering
// ---------------------------------------------------------------------------

suite("ConfigurationTreeProvider – choice item rendering", () => {
  let provider: ConfigurationTreeProvider;

  setup(() => {
    provider = new ConfigurationTreeProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  test("model SelectorHeader expands to show all model choice items", () => {
    provider.update(makeLoadedState(), activeConfig("T2T1", "hw", "core"));
    provider.setExpandedSelector("model");
    const [modelHeader] = getBuildContextChildren(provider) as SelectorHeaderItem[];
    const choices = provider.getChildren(modelHeader) as SelectorChoiceItem[];
    assert.strictEqual(choices.length, 2);
    assert.strictEqual(choices[0].entryId, "T2T1");
    assert.strictEqual(choices[1].entryId, "T3W1");
  });

  test("active model choice item is marked active, others are inactive", () => {
    provider.update(makeLoadedState(), activeConfig("T3W1", "hw", "core"));
    provider.setExpandedSelector("model");
    const [modelHeader] = getBuildContextChildren(provider) as SelectorHeaderItem[];
    const choices = provider.getChildren(modelHeader) as SelectorChoiceItem[];
    const t2t1 = choices.find((c) => c.entryId === "T2T1")!;
    const t3w1 = choices.find((c) => c.entryId === "T3W1")!;
    assert.strictEqual(t3w1.description, "active");
    assert.ok(t2t1.description !== "active", "T2T1 should not be active");
  });

  test("target SelectorHeader expands to show all target choice items", () => {
    provider.update(makeLoadedState(), activeConfig("T2T1", "emu", "core"));
    provider.setExpandedSelector("target");
    const [, targetHeader] = getBuildContextChildren(provider) as SelectorHeaderItem[];
    const choices = provider.getChildren(targetHeader) as SelectorChoiceItem[];
    assert.strictEqual(choices.length, 2);
    assert.strictEqual(choices[0].entryId, "hw");
    assert.strictEqual(choices[1].entryId, "emu");
    const emu = choices.find((c) => c.entryId === "emu")!;
    assert.strictEqual(emu.description, "active");
  });

  test("component SelectorHeader expands to show all component choice items", () => {
    provider.update(makeLoadedState(), activeConfig("T2T1", "hw", "prodtest"));
    provider.setExpandedSelector("component");
    const [, , componentHeader] = getBuildContextChildren(provider) as SelectorHeaderItem[];
    const choices = provider.getChildren(componentHeader) as SelectorChoiceItem[];
    assert.strictEqual(choices.length, 2);
      test("only one selector header is expanded at a time", () => {
        provider.update(makeLoadedState(), activeConfig("T2T1", "hw", "core"));

        provider.setExpandedSelector("model");
        let [modelHeader, targetHeader, componentHeader] = getBuildContextChildren(
          provider
        ) as SelectorHeaderItem[];
        assert.strictEqual(modelHeader.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
        assert.strictEqual(targetHeader.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        assert.strictEqual(componentHeader.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);

        provider.setExpandedSelector("target");
        [modelHeader, targetHeader, componentHeader] = getBuildContextChildren(
          provider
        ) as SelectorHeaderItem[];
        assert.strictEqual(modelHeader.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        assert.strictEqual(targetHeader.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
        assert.strictEqual(componentHeader.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        assert.strictEqual(provider.getChildren(modelHeader).length, 0);
        assert.strictEqual(provider.getChildren(targetHeader).length, 2);
      });

    const prodtest = choices.find((c) => c.entryId === "prodtest")!;
    assert.strictEqual(prodtest.description, "active");
  });
});

// ---------------------------------------------------------------------------
// Suite: Normalization integration with tree update
// ---------------------------------------------------------------------------

suite("ConfigurationTreeProvider – normalization integration", () => {
  let provider: ConfigurationTreeProvider;

  setup(() => {
    provider = new ConfigurationTreeProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  test("normalizing a stale config and updating the tree renders the corrected selection", () => {
    const manifest = makeLoadedState();
    // Saved config has a stale modelId
    const stale = activeConfig("OLD_MODEL", "hw", "core");
    const normalized = normalizeActiveConfig(manifest, stale);
    const normConfig = activeConfig(normalized.modelId, normalized.targetId, normalized.componentId);
    provider.update(manifest, normConfig);

    const [modelHeader] = getBuildContextChildren(provider) as SelectorHeaderItem[];
    // Normalized to first model
    assert.strictEqual(modelHeader.description, "Trezor Model T");
    provider.setExpandedSelector("model");
    const choices = provider.getChildren(modelHeader) as SelectorChoiceItem[];
    const active = choices.find((c) => c.description === "active");
    assert.ok(active, "expected one choice to be active after normalization");
    assert.strictEqual(active!.entryId, "T2T1");
  });

  test("fresh normalization with no saved config defaults to first entries in the tree", () => {
    const manifest = makeLoadedState();
    const normalized = normalizeActiveConfig(manifest);
    const normConfig = activeConfig(normalized.modelId, normalized.targetId, normalized.componentId);
    provider.update(manifest, normConfig);

    const [modelHeader, targetHeader, componentHeader] = getBuildContextChildren(
      provider
    ) as SelectorHeaderItem[];
    assert.strictEqual(modelHeader.description, "Trezor Model T");
    assert.strictEqual(targetHeader.description, "HW");
    assert.strictEqual(componentHeader.description, "Core");
  });
});

// ---------------------------------------------------------------------------
// Suite: IntelliSense artifact state in the Build Artifacts section
// ---------------------------------------------------------------------------

import {
  CompileCommandsArtifactItem,
  PlaceholderItem,
} from "../../ui/configuration-tree";
import { ActiveCompileCommandsArtifact } from "../../intellisense/intellisense-types";

function getBuildArtifactsChildren(
  provider: ConfigurationTreeProvider
): vscode.TreeItem[] {
  const top = provider.getChildren() as vscode.TreeItem[];
  const artifactsSection = top.find(
    (item) => item instanceof SectionItem && (item as SectionItem).sectionId === "build-artifacts"
  ) as SectionItem;
  assert.ok(artifactsSection, "build-artifacts section not found");
  return provider.getChildren(artifactsSection) as vscode.TreeItem[];
}

function makeMissingArtifact(
  overrides: Partial<ActiveCompileCommandsArtifact> = {}
): ActiveCompileCommandsArtifact {
  return {
    path: "/workspace/build/model-t/compile_commands_core.cc.json",
    exists: false,
    status: "missing",
    missingReason: "Expected compile-commands artifact not found.",
    contextKey: "T2T1::hw::core",
    ...overrides,
  };
}

function makeValidArtifact(
  overrides: Partial<ActiveCompileCommandsArtifact> = {}
): ActiveCompileCommandsArtifact {
  return {
    path: "/workspace/build/model-t/compile_commands_core.cc.json",
    exists: true,
    status: "valid",
    contextKey: "T2T1::hw::core",
    ...overrides,
  };
}

suite("ConfigurationTreeProvider – Build Artifacts section (IntelliSense)", () => {
  let provider: ConfigurationTreeProvider;

  setup(() => {
    provider = new ConfigurationTreeProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  test("shows placeholder when no artifact has been resolved yet", () => {
    const children = getBuildArtifactsChildren(provider);
    assert.ok(children[0] instanceof PlaceholderItem, "expected PlaceholderItem before any artifact update");
  });

  test("shows CompileCommandsArtifactItem after updateArtifact with valid artifact", () => {
    provider.updateArtifact(makeValidArtifact());
    const children = getBuildArtifactsChildren(provider);
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof CompileCommandsArtifactItem, "expected CompileCommandsArtifactItem");
    const item = children[0] as CompileCommandsArtifactItem;
    assert.strictEqual(item.description, "valid");
  });

  test("shows CompileCommandsArtifactItem with missing status after updateArtifact", () => {
    provider.updateArtifact(makeMissingArtifact());
    const children = getBuildArtifactsChildren(provider);
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof CompileCommandsArtifactItem);
    const item = children[0] as CompileCommandsArtifactItem;
    assert.strictEqual(item.description, "missing");
  });

  test("tooltip for valid artifact includes the expected path", () => {
    const artifact = makeValidArtifact({ path: "/build/model-t/compile_commands_core.cc.json" });
    provider.updateArtifact(artifact);
    const children = getBuildArtifactsChildren(provider);
    const item = children[0] as CompileCommandsArtifactItem;
    assert.ok(
      String(item.tooltip).includes("/build/model-t/compile_commands_core.cc.json"),
      `tooltip should include path, got: ${item.tooltip}`
    );
  });

  test("tooltip for missing artifact includes the missing reason", () => {
    const artifact = makeMissingArtifact({ missingReason: "Artifact not found at expected path." });
    provider.updateArtifact(artifact);
    const children = getBuildArtifactsChildren(provider);
    const item = children[0] as CompileCommandsArtifactItem;
    assert.ok(
      String(item.tooltip).includes("Artifact not found"),
      `tooltip should include missing reason, got: ${item.tooltip}`
    );
  });

  test("updateArtifact fires tree data change event", (done) => {
    const sub = provider.onDidChangeTreeData(() => {
      sub.dispose();
      done();
    });
    provider.updateArtifact(makeValidArtifact());
  });

  test("switching from valid to null artifact reverts to placeholder", () => {
    provider.updateArtifact(makeValidArtifact());
    provider.updateArtifact(null);
    const children = getBuildArtifactsChildren(provider);
    assert.ok(children[0] instanceof PlaceholderItem, "expected placeholder after null artifact update");
  });

  test("compile-commands artifact path uses artifactFolder, not model id", () => {
    // The artifact path should be constructed from artifactFolder, not from the model id.
    const artifact = makeValidArtifact({
      path: "/artifacts/model-t/compile_commands_core.cc.json",
      contextKey: "T2T1::hw::core",
    });
    provider.updateArtifact(artifact);
    const children = getBuildArtifactsChildren(provider);
    const item = children[0] as CompileCommandsArtifactItem;
    assert.ok(
      String(item.tooltip).includes("model-t"),
      `path should contain artifactFolder 'model-t', not model id`
    );
    assert.ok(
      !String(item.tooltip).includes("T2T1"),
      `path should not contain model id 'T2T1'`
    );
  });

  test("artifact suffix is reflected in the compile-commands path", () => {
    const artifact = makeValidArtifact({
      path: "/artifacts/model-t/compile_commands_core_emu.cc.json",
      contextKey: "T2T1::emu::core",
    });
    provider.updateArtifact(artifact);
    const children = getBuildArtifactsChildren(provider);
    const item = children[0] as CompileCommandsArtifactItem;
    assert.ok(
      String(item.tooltip).includes("compile_commands_core_emu"),
      `path should contain artifact basename with suffix, got: ${item.tooltip}`
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: active-context refresh and stale-state clearing
// ---------------------------------------------------------------------------

suite("ConfigurationTreeProvider – active-context refresh and stale-state clearing", () => {
  let provider: ConfigurationTreeProvider;

  setup(() => {
    provider = new ConfigurationTreeProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  test("switching from valid artifact to null reverts to placeholder (stale-state clearing)", () => {
    provider.updateArtifact(makeValidArtifact({ contextKey: "T2T1::hw::core" }));
    provider.updateArtifact(null);
    const children = getBuildArtifactsChildren(provider);
    assert.ok(
      children[0] instanceof PlaceholderItem,
      "expected PlaceholderItem after null artifact update"
    );
  });

  test("switching context shows new artifact status without reusing old path", () => {
    // Apply valid artifact for first context
    provider.updateArtifact(
      makeValidArtifact({
        path: "/artifacts/model-t/compile_commands_core.cc.json",
        contextKey: "T2T1::hw::core",
      })
    );

    // Context changes to T3W1::hw::core (model switch)
    provider.updateArtifact(
      makeValidArtifact({
        path: "/artifacts/model-t3/compile_commands_core.cc.json",
        contextKey: "T3W1::hw::core",
      })
    );

    const children = getBuildArtifactsChildren(provider);
    const item = children[0] as CompileCommandsArtifactItem;
    // The tree must show the new context's path, not the old model-t path
    assert.ok(
      String(item.tooltip).includes("model-t3"),
      `tooltip should reference model-t3 after context switch, got: ${item.tooltip}`
    );
    assert.ok(
      !String(item.tooltip).includes("model-t/compile"),
      `tooltip must not still reference old model-t path`
    );
  });

  test("switching from valid artifact to missing does not retain old valid tooltip", () => {
    provider.updateArtifact(
      makeValidArtifact({ path: "/artifacts/model-t/compile_commands_core.cc.json" })
    );
    provider.updateArtifact(
      makeMissingArtifact({ path: "/artifacts/nonexistent/compile_commands_core.cc.json" })
    );
    const children = getBuildArtifactsChildren(provider);
    const item = children[0] as CompileCommandsArtifactItem;
    assert.strictEqual(item.description, "missing");
    assert.ok(
      String(item.tooltip).includes("nonexistent"),
      `tooltip should show the new missing path, got: ${item.tooltip}`
    );
  });

  test("target suffix change: _emu suffix shown in tree after context switch to emu target", () => {
    // Start with hw artifact (no suffix)
    provider.updateArtifact(
      makeValidArtifact({
        path: "/artifacts/model-t/compile_commands_core.cc.json",
        contextKey: "T2T1::hw::core",
      })
    );

    // Switch to emu target (with _emu suffix)
    provider.updateArtifact(
      makeValidArtifact({
        path: "/artifacts/model-t/compile_commands_core_emu.cc.json",
        contextKey: "T2T1::emu::core",
      })
    );

    const children = getBuildArtifactsChildren(provider);
    const item = children[0] as CompileCommandsArtifactItem;
    assert.ok(
      String(item.tooltip).includes("_emu"),
      `tooltip should contain _emu suffix after target switch, got: ${item.tooltip}`
    );
    assert.ok(
      !String(item.tooltip).includes("compile_commands_core.cc"),
      `tooltip must not reference hw path after emu switch`
    );
  });

  test("updateArtifact fires onDidChangeTreeData on context switch", (done) => {
    // Initial state
    provider.updateArtifact(makeValidArtifact({ contextKey: "T2T1::hw::core" }));

    const sub = provider.onDidChangeTreeData(() => {
      sub.dispose();
      done();
    });

    // Context switch triggers a new updateArtifact
    provider.updateArtifact(makeValidArtifact({ contextKey: "T3W1::hw::core" }));
  });
});
