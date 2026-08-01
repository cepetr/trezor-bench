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

// ---------------------------------------------------------------------------
// US1 — three views contributed, in order, with contract titles/type/icon
// ---------------------------------------------------------------------------

suite("Configuration panes – view contributions (US1)", () => {
  test("contributes exactly three views for the tf-tools container", () => {
    const views = getTfToolsViews();
    assert.strictEqual(views.length, 3, `expected exactly 3 views, got ${views.length}`);
  });

  test("declares the three views in the contract's exact order: Build Selection, Build Options, Build Artifacts", () => {
    const views = getTfToolsViews();
    assert.deepStrictEqual(
      views.map((v) => v.name),
      ["Build Selection", "Build Options", "Build Artifacts"]
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
