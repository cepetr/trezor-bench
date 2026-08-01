/**
 * Integration tests for the Split Configuration Panes contribution surface.
 * Runs inside the VS Code extension host via @vscode/test-electron.
 *
 * Checked against specs/010-split-configuration-panes/contracts/view-contributions.md.
 *
 * Test ownership: this file's US1 suite ("view contributions") deliberately
 * does not assert `visibility` — that belongs to the US2 suite below, added
 * by T012, so the US1 suite stays green whether or not US2 has landed yet.
 */
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getExtPackageJson(): Record<string, unknown> {
  const ext = vscode.extensions.getExtension("cepetr.tf-tools");
  assert.ok(ext, "cepetr.tf-tools extension must be present");
  return ext.packageJSON as Record<string, unknown>;
}

function getContributes(): Record<string, unknown> {
  return getExtPackageJson().contributes as Record<string, unknown>;
}

interface ViewContribution {
  id: string;
  name: string;
  type?: string;
  icon?: string;
  visibility?: string;
  when?: string;
}

function getTfToolsViews(): ViewContribution[] {
  const views = getContributes().views as Record<string, ViewContribution[]>;
  return views["tf-tools"] ?? [];
}

const INHERITED_VIEW_ID = "tfTools.configuration";
const BUILD_OPTIONS_VIEW_ID = "tfTools.buildOptions";
const BUILD_ARTIFACTS_VIEW_ID = "tfTools.buildArtifacts";

interface MenuEntry {
  command: string;
  when?: string;
  group?: string;
  enablement?: string;
}

function getMenuEntries(menuId: string): MenuEntry[] {
  const menus = getContributes().menus as Record<string, MenuEntry[]>;
  return menus[menuId] ?? [];
}

// ---------------------------------------------------------------------------
// US1 — three views contributed, in order, with contract titles/type/icon
// ---------------------------------------------------------------------------

suite("Configuration panes – view contributions (US1)", () => {
  test("contributes exactly three views for the tf-tools container", () => {
    const views = getTfToolsViews();
    assert.strictEqual(views.length, 3, `expected exactly 3 views, got ${views.length}`);
  });

  test("declares the three views in the contract's exact order: Build Selection, Build Artifacts, Build Options", () => {
    const views = getTfToolsViews();
    assert.deepStrictEqual(
      views.map((v) => v.name),
      ["Build Selection", "Build Artifacts", "Build Options"]
    );
  });

  test("entry 1 reuses the inherited view id (FR-017)", () => {
    const [first] = getTfToolsViews();
    assert.strictEqual(first.id, INHERITED_VIEW_ID);
  });

  test("entry 2 and entry 3 declare new tfTools.-prefixed ids, distinct from the inherited id and each other", () => {
    const [, second, third] = getTfToolsViews();
    assert.ok(second.id.startsWith("tfTools."));
    assert.ok(third.id.startsWith("tfTools."));
    assert.notStrictEqual(second.id, INHERITED_VIEW_ID);
    assert.notStrictEqual(third.id, INHERITED_VIEW_ID);
    assert.notStrictEqual(second.id, third.id);
  });

  test("the id order matches the title order: inherited, Build Artifacts, Build Options", () => {
    assert.deepStrictEqual(
      getTfToolsViews().map((v) => v.id),
      [INHERITED_VIEW_ID, BUILD_ARTIFACTS_VIEW_ID, BUILD_OPTIONS_VIEW_ID]
    );
  });

  test("every view id stays under 25 characters (constitution principle V)", () => {
    for (const view of getTfToolsViews()) {
      assert.ok(
        view.id.length < 25,
        `expected '${view.id}' to be under 25 characters, got ${view.id.length}`
      );
    }
  });

  test("every view declares type 'tree' and the tf-tools icon", () => {
    for (const view of getTfToolsViews()) {
      assert.strictEqual(view.type, "tree", `expected '${view.id}' to declare type 'tree'`);
      assert.strictEqual(
        view.icon,
        "images/tf-tools.svg",
        `expected '${view.id}' to use the tf-tools icon`
      );
    }
  });

  test("no view declares a 'when' clause — all three panes are always contributed (FR-012)", () => {
    for (const view of getTfToolsViews()) {
      assert.strictEqual(view.when, undefined, `expected '${view.id}' to omit 'when'`);
    }
  });
});

// ---------------------------------------------------------------------------
// T006a — host-constraint guardrails (FR-009c): the whole container-toolbar
// decision depends on none of these ever being (re)introduced.
// ---------------------------------------------------------------------------

suite("Configuration panes – host-constraint guardrails (FR-009c)", () => {
  test("package.json declares no enabledApiProposals", () => {
    const pkg = getExtPackageJson();
    assert.strictEqual(pkg.enabledApiProposals, undefined);
  });

  test("package.json contributes no viewContainer/title menu", () => {
    const menus = getContributes().menus as Record<string, unknown>;
    assert.strictEqual(menus["viewContainer/title"], undefined);
  });

  test("package.json contributes no configurationDefaults entry", () => {
    const pkg = getExtPackageJson();
    assert.strictEqual(pkg.configurationDefaults, undefined);
  });
});

// ---------------------------------------------------------------------------
// US2 — initial collapse state. This suite owns every `visibility` assertion
// (contracts/view-contributions.md §2); the US1 suite above deliberately
// leaves it alone so it stays green whether or not US2 has landed yet.
// ---------------------------------------------------------------------------

suite("Configuration panes – initial collapse state (US2)", () => {
  test("Build Options declares visibility: collapsed", () => {
    const views = getTfToolsViews();
    const buildOptions = views.find((v) => v.name === "Build Options");
    assert.ok(buildOptions, "expected a Build Options view entry");
    assert.strictEqual(buildOptions!.visibility, "collapsed");
  });

  test("Build Selection omits visibility (defaults to visible)", () => {
    const views = getTfToolsViews();
    const buildSelection = views.find((v) => v.name === "Build Selection");
    assert.ok(buildSelection, "expected a Build Selection view entry");
    assert.strictEqual(buildSelection!.visibility, undefined);
  });

  test("Build Artifacts omits visibility (defaults to visible)", () => {
    const views = getTfToolsViews();
    const buildArtifacts = views.find((v) => v.name === "Build Artifacts");
    assert.ok(buildArtifacts, "expected a Build Artifacts view entry");
    assert.strictEqual(buildArtifacts!.visibility, undefined);
  });
});

// ---------------------------------------------------------------------------
// No pane offers Collapse All (FR-009d) — the extension stays the sole owner
// of option-group and multistate expansion state.
// ---------------------------------------------------------------------------

suite("Configuration panes – no Collapse All on any view", () => {
  // showCollapseAll is a vscode.window.createTreeView() option, not a
  // package.json contribution field, so it cannot be introspected from the
  // running extension's manifest — this reads the compiled extension.js
  // that this very test process is running alongside.
  test("extension.ts creates all three TreeViews with showCollapseAll: false", () => {
    const extensionJsPath = path.join(__dirname, "../../extension.js");
    const extensionSource = fs.readFileSync(extensionJsPath, "utf-8");
    const createTreeViewCalls = extensionSource.match(/createTreeView\([^;]*?\}\)/gs) ?? [];
    assert.strictEqual(createTreeViewCalls.length, 3, "expected exactly 3 createTreeView calls");
    for (const call of createTreeViewCalls) {
      assert.ok(
        /showCollapseAll\s*:\s*false/.test(call),
        `expected showCollapseAll: false in call: ${call}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// US3 — the workflow toolbar stays whole on Build Selection (FR-009, FR-009a,
// FR-009b). Every existing view/title entry keeps its command, group, and
// enablement, and stays bound to the inherited view id.
// ---------------------------------------------------------------------------

suite("Configuration panes – view/title toolbar targets only Build Selection (US3)", () => {
  test("declares exactly ten view/title entries", () => {
    assert.strictEqual(getMenuEntries("view/title").length, 10);
  });

  test("every view/title entry targets the inherited view id", () => {
    for (const entry of getMenuEntries("view/title")) {
      assert.ok(
        entry.when?.includes(`view == ${INHERITED_VIEW_ID}`),
        `expected '${entry.command}' (${entry.group}) to target the inherited view id, got when: ${entry.when}`
      );
    }
  });

  test("no view/title entry targets Build Options or Build Artifacts", () => {
    for (const entry of getMenuEntries("view/title")) {
      assert.ok(
        !entry.when?.includes(`view == ${BUILD_OPTIONS_VIEW_ID}`),
        `'${entry.command}' (${entry.group}) must not target Build Options`
      );
      assert.ok(
        !entry.when?.includes(`view == ${BUILD_ARTIFACTS_VIEW_ID}`),
        `'${entry.command}' (${entry.group}) must not target Build Artifacts`
      );
    }
  });

  test("matches the contract's command/group/enablement table exactly, in order", () => {
    const expected: Array<{ command: string; group: string; enablement?: string }> = [
      { command: "tfTools.build", group: "navigation@1", enablement: "!tfTools.workflowBlocked && !tfTools.presetBlocked" },
      { command: "tfTools.startDebugging", group: "navigation@2", enablement: "tfTools.startDebuggingEnabled" },
      { command: "tfTools.build", group: "overflow@1", enablement: "!tfTools.workflowBlocked && !tfTools.presetBlocked" },
      { command: "tfTools.clippy", group: "overflow@2", enablement: "!tfTools.workflowBlocked && !tfTools.presetBlocked" },
      { command: "tfTools.check", group: "overflow@3", enablement: "!tfTools.workflowBlocked && !tfTools.presetBlocked" },
      { command: "tfTools.clean", group: "overflow@4", enablement: "!tfTools.workflowBlocked" },
      { command: "tfTools.flash", group: "overflow@5", enablement: "tfTools.binaryExists" },
      { command: "tfTools.upload", group: "overflow@6", enablement: "tfTools.binaryExists" },
      { command: "tfTools.startDebugging", group: "overflow@7", enablement: "tfTools.startDebuggingEnabled" },
      { command: "tfTools.refreshIntelliSense", group: "overflow@8" },
    ];
    const actual = getMenuEntries("view/title").map((e) =>
      e.enablement === undefined
        ? { command: e.command, group: e.group }
        : { command: e.command, group: e.group, enablement: e.enablement }
    );
    assert.deepStrictEqual(actual, expected);
  });

  test("the status-bar command still equals '<inherited view id>.focus'", () => {
    const statusBarSource = fs.readFileSync(
      path.join(__dirname, "../../ui/status-bar.js"),
      "utf-8"
    );
    assert.ok(
      statusBarSource.includes(`${INHERITED_VIEW_ID}.focus`),
      `expected status-bar command '${INHERITED_VIEW_ID}.focus' in status-bar.js`
    );
  });
});

// ---------------------------------------------------------------------------
// US3 — artifact row actions move to Build Artifacts (FR-008).
// ---------------------------------------------------------------------------

suite("Configuration panes – view/item/context targets only Build Artifacts (US3)", () => {
  test("declares exactly four view/item/context entries", () => {
    assert.strictEqual(getMenuEntries("view/item/context").length, 4);
  });

  test("every view/item/context entry targets the Build Artifacts view id", () => {
    for (const entry of getMenuEntries("view/item/context")) {
      assert.ok(
        entry.when?.includes(`view == ${BUILD_ARTIFACTS_VIEW_ID}`),
        `expected '${entry.command}' to target Build Artifacts, got when: ${entry.when}`
      );
    }
  });

  test("no view/item/context entry targets the inherited view id or Build Options", () => {
    for (const entry of getMenuEntries("view/item/context")) {
      assert.ok(!entry.when?.includes(`view == ${INHERITED_VIEW_ID}`));
      assert.ok(!entry.when?.includes(`view == ${BUILD_OPTIONS_VIEW_ID}`));
    }
  });

  test("matches the contract's command/viewItem/group/enablement table exactly", () => {
    const expected: Array<{ command: string; viewItem: string; group: string; enablement?: string }> = [
      { command: "tfTools.flash", viewItem: "artifact-binary", group: "inline@1", enablement: "tfTools.binaryExists" },
      { command: "tfTools.upload", viewItem: "artifact-binary", group: "inline@2", enablement: "tfTools.binaryExists" },
      { command: "tfTools.openMapFile", viewItem: "artifact-map", group: "inline@1", enablement: "tfTools.mapExists" },
      { command: "tfTools.startDebugging", viewItem: "artifact-executable", group: "inline@1", enablement: "tfTools.startDebuggingEnabled" },
    ];
    const actual = getMenuEntries("view/item/context").map((e) => {
      const viewItemMatch = /viewItem == ([\w-]+)/.exec(e.when ?? "");
      return {
        command: e.command,
        viewItem: viewItemMatch?.[1],
        group: e.group,
        enablement: e.enablement,
      };
    });
    assert.deepStrictEqual(actual, expected);
  });
});
