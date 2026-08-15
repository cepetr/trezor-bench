/**
 * Integration tests for the Split Configuration Panes contribution surface.
 * Runs inside the VS Code extension host via @vscode/test-electron.
 *
 * Test ownership: this file's "view contributions" suite deliberately does
 * not assert `visibility` — that belongs to the initial-collapse-state suite
 * below, so each suite stays green on its own.
 */
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getExtPackageJson(): Record<string, unknown> {
  const ext = vscode.extensions.getExtension("cepetr.tbench");
  assert.ok(ext, "cepetr.tbench extension must be present");
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

function getTbenchViews(): ViewContribution[] {
  const views = getContributes().views as Record<string, ViewContribution[]>;
  return views["tbench"] ?? [];
}

interface ViewContainerContribution {
  id: string;
  title: string;
  icon?: string;
}

function getActivityBarContainers(): ViewContainerContribution[] {
  const containers = getContributes().viewsContainers as Record<
    string,
    ViewContainerContribution[]
  >;
  return containers?.activitybar ?? [];
}

const INHERITED_VIEW_ID = "tbench.configuration";
const BUILD_OPTIONS_VIEW_ID = "tbench.buildOptions";
const BUILD_ARTIFACTS_VIEW_ID = "tbench.buildArtifacts";

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
// three views contributed, in order, with contract titles/type/icon
// ---------------------------------------------------------------------------

suite("Configuration panes – view container", () => {
  test("contributes exactly one activity-bar container, with the tbench id and icon", () => {
    const containers = getActivityBarContainers();
    assert.strictEqual(
      containers.length,
      1,
      `expected exactly 1 activity-bar container, got ${containers.length}`
    );
    assert.strictEqual(containers[0].id, "tbench");
    assert.strictEqual(containers[0].icon, "images/tbench.svg");
  });

  test("the container title is the formal product name", () => {
    const [container] = getActivityBarContainers();
    assert.strictEqual(container.title, "Trezor Bench");
  });
});

suite("Configuration panes – view contributions", () => {
  test("contributes exactly three views for the tbench container", () => {
    const views = getTbenchViews();
    assert.strictEqual(views.length, 3, `expected exactly 3 views, got ${views.length}`);
  });

  test("declares the three views in the contract's exact order: Build Selection, Build Artifacts, Build Options", () => {
    const views = getTbenchViews();
    assert.deepStrictEqual(
      views.map((v) => v.name),
      ["Build Selection", "Build Artifacts", "Build Options"]
    );
  });

  test("entry 1 reuses the inherited view id", () => {
    const [first] = getTbenchViews();
    assert.strictEqual(first.id, INHERITED_VIEW_ID);
  });

  test("entry 2 and entry 3 declare new tbench.-prefixed ids, distinct from the inherited id and each other", () => {
    const [, second, third] = getTbenchViews();
    assert.ok(second.id.startsWith("tbench."));
    assert.ok(third.id.startsWith("tbench."));
    assert.notStrictEqual(second.id, INHERITED_VIEW_ID);
    assert.notStrictEqual(third.id, INHERITED_VIEW_ID);
    assert.notStrictEqual(second.id, third.id);
  });

  test("the id order matches the title order: inherited, Build Artifacts, Build Options", () => {
    assert.deepStrictEqual(
      getTbenchViews().map((v) => v.id),
      [INHERITED_VIEW_ID, BUILD_ARTIFACTS_VIEW_ID, BUILD_OPTIONS_VIEW_ID]
    );
  });

  test("every view id stays under 25 characters (constitution principle V)", () => {
    for (const view of getTbenchViews()) {
      assert.ok(
        view.id.length < 25,
        `expected '${view.id}' to be under 25 characters, got ${view.id.length}`
      );
    }
  });

  test("every view declares type 'tree' and the tbench icon", () => {
    for (const view of getTbenchViews()) {
      assert.strictEqual(view.type, "tree", `expected '${view.id}' to declare type 'tree'`);
      assert.strictEqual(
        view.icon,
        "images/tbench.svg",
        `expected '${view.id}' to use the tbench icon`
      );
    }
  });

  test("no view declares a 'when' clause — all three panes are always contributed", () => {
    for (const view of getTbenchViews()) {
      assert.strictEqual(view.when, undefined, `expected '${view.id}' to omit 'when'`);
    }
  });
});

// ---------------------------------------------------------------------------
// Host-constraint guardrails: the whole container-toolbar
// decision depends on none of these ever being (re)introduced.
// ---------------------------------------------------------------------------

suite("Configuration panes – host-constraint guardrails", () => {
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
// Initial collapse state. This suite owns every `visibility` assertion;
// the view-contributions suite above deliberately leaves it alone.
// ---------------------------------------------------------------------------

suite("Configuration panes – initial collapse state", () => {
  test("Build Options declares visibility: collapsed", () => {
    const views = getTbenchViews();
    const buildOptions = views.find((v) => v.name === "Build Options");
    assert.ok(buildOptions, "expected a Build Options view entry");
    assert.strictEqual(buildOptions!.visibility, "collapsed");
  });

  test("Build Selection omits visibility (defaults to visible)", () => {
    const views = getTbenchViews();
    const buildSelection = views.find((v) => v.name === "Build Selection");
    assert.ok(buildSelection, "expected a Build Selection view entry");
    assert.strictEqual(buildSelection!.visibility, undefined);
  });

  test("Build Artifacts omits visibility (defaults to visible)", () => {
    const views = getTbenchViews();
    const buildArtifacts = views.find((v) => v.name === "Build Artifacts");
    assert.ok(buildArtifacts, "expected a Build Artifacts view entry");
    assert.strictEqual(buildArtifacts!.visibility, undefined);
  });
});

// ---------------------------------------------------------------------------
// No pane offers Collapse All — the extension stays the sole owner
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
// The workflow toolbar stays whole on Build Selection.
// Every existing view/title entry keeps its command, group, and
// enablement, and stays bound to the inherited view id.
// ---------------------------------------------------------------------------

suite("Configuration panes – view/title toolbar targets only Build Selection", () => {
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
      { command: "tbench.build", group: "navigation@1", enablement: "!tbench.workflowBlocked && !tbench.presetBlocked" },
      { command: "tbench.startDebugging", group: "navigation@2", enablement: "tbench.startDebuggingEnabled" },
      { command: "tbench.build", group: "overflow@1", enablement: "!tbench.workflowBlocked && !tbench.presetBlocked" },
      { command: "tbench.clippy", group: "overflow@2", enablement: "!tbench.workflowBlocked && !tbench.presetBlocked" },
      { command: "tbench.check", group: "overflow@3", enablement: "!tbench.workflowBlocked && !tbench.presetBlocked" },
      { command: "tbench.clean", group: "overflow@4", enablement: "!tbench.workflowBlocked" },
      { command: "tbench.flash", group: "overflow@5", enablement: "tbench.binaryExists" },
      { command: "tbench.upload", group: "overflow@6", enablement: "tbench.binaryExists" },
      { command: "tbench.startDebugging", group: "overflow@7", enablement: "tbench.startDebuggingEnabled" },
      { command: "tbench.refreshIntelliSense", group: "overflow@8" },
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
// Artifact row actions move to Build Artifacts.
// ---------------------------------------------------------------------------

suite("Configuration panes – view/item/context targets only Build Artifacts", () => {
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
      { command: "tbench.flash", viewItem: "artifact-binary", group: "inline@1", enablement: "tbench.binaryExists" },
      { command: "tbench.upload", viewItem: "artifact-binary", group: "inline@2", enablement: "tbench.binaryExists" },
      { command: "tbench.openMapFile", viewItem: "artifact-map", group: "inline@1", enablement: "tbench.mapExists" },
      { command: "tbench.startDebugging", viewItem: "artifact-executable", group: "inline@1", enablement: "tbench.startDebuggingEnabled" },
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
