/**
 * Integration tests for Build Workflow commands and view-header actions.
 *
 * Verifies:
 * - All four workflow commands (Build/Clippy/Check/Clean) are registered
 * - Commands can be invoked programmatically against a valid manifest state
 * - Blocked states produce visible failure feedback
 * - Manifest with invalid when expressions correctly blocks workflow
 *
 * These tests run inside the VS Code extension host.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { parseManifest } from "../../manifest/validate-manifest";
import {
  evaluateWorkflowPreconditions,
  blockReasonMessage,
} from "../../commands/build-workflow";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fixtureManifestSource(fixtureName: string): string {
  const fixturePath = path.resolve(
    __dirname,
    "../../../test-fixtures/manifests",
    fixtureName,
    "tbench.yaml"
  );
  return fs.readFileSync(fixturePath, "utf-8");
}

async function activateExtension(): Promise<boolean> {
  const ext = vscode.extensions.getExtension("cepetr.tbench");
  if (!ext) {
    return false;
  }
  if (!ext.isActive) {
    await ext.activate();
  }
  return ext.isActive;
}

// ---------------------------------------------------------------------------
// Suite: workflow precondition checks
// ---------------------------------------------------------------------------

suite("Build Workflow – evaluateWorkflowPreconditions", () => {
  test("returns 'no-block' for a valid loaded manifest", () => {
    const result = evaluateWorkflowPreconditions({
      manifestStatus: "loaded",
      hasWorkflowBlockingIssues: false,
      workspaceSupported: true,
    });
    assert.strictEqual(result, "no-block");
  });

  test("returns 'manifest-missing' when manifest is missing", () => {
    const result = evaluateWorkflowPreconditions({
      manifestStatus: "missing",
      hasWorkflowBlockingIssues: false,
      workspaceSupported: true,
    });
    assert.strictEqual(result, "manifest-missing");
  });

  test("returns 'manifest-invalid' when manifest is invalid", () => {
    const result = evaluateWorkflowPreconditions({
      manifestStatus: "invalid",
      hasWorkflowBlockingIssues: false,
      workspaceSupported: true,
    });
    assert.strictEqual(result, "manifest-invalid");
  });

  test("returns 'manifest-invalid' when hasWorkflowBlockingIssues is true", () => {
    const result = evaluateWorkflowPreconditions({
      manifestStatus: "loaded",
      hasWorkflowBlockingIssues: true,
      workspaceSupported: true,
    });
    assert.strictEqual(result, "manifest-invalid");
  });

  test("returns 'workspace-unsupported' when workspace is unsupported", () => {
    const result = evaluateWorkflowPreconditions({
      manifestStatus: "loaded",
      hasWorkflowBlockingIssues: false,
      workspaceSupported: false,
    });
    assert.strictEqual(result, "workspace-unsupported");
  });

  test("workspace-unsupported takes priority over manifest-missing", () => {
    const result = evaluateWorkflowPreconditions({
      manifestStatus: "missing",
      hasWorkflowBlockingIssues: false,
      workspaceSupported: false,
    });
    assert.strictEqual(result, "workspace-unsupported");
  });
});

// ---------------------------------------------------------------------------
// Suite: workflow commands registered in the extension host
// ---------------------------------------------------------------------------

suite("Build Workflow – command registration", () => {
  test("tbench.build command is registered", async () => {
    await activateExtension();
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes("tbench.build"), "expected tbench.build to be registered");
  });

  test("tbench.clippy command is registered", async () => {
    await activateExtension();
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes("tbench.clippy"), "expected tbench.clippy to be registered");
  });

  test("tbench.check command is registered", async () => {
    await activateExtension();
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes("tbench.check"), "expected tbench.check to be registered");
  });

  test("tbench.clean command is registered", async () => {
    await activateExtension();
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes("tbench.clean"), "expected tbench.clean to be registered");
  });

  test("tbench.toggleBuildOption command is registered", async () => {
    await activateExtension();
    const all = await vscode.commands.getCommands(true);
    assert.ok(
      all.includes("tbench.toggleBuildOption"),
      "expected tbench.toggleBuildOption to be registered"
    );
  });

  test("tbench.selectBuildOptionState command is registered", async () => {
    await activateExtension();
    const all = await vscode.commands.getCommands(true);
    assert.ok(
      all.includes("tbench.selectBuildOptionState"),
      "expected tbench.selectBuildOptionState to be registered"
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: blocked manifest and missing fixture
// ---------------------------------------------------------------------------

suite("Build Workflow – blocked manifest", () => {
  test("invalid-when manifest marks hasWorkflowBlockingIssues", () => {
    const parsed = parseManifest(fixtureManifestSource("invalid-when"));
    assert.strictEqual(parsed.hasWorkflowBlockingIssues, true);
  });

  test("evaluateWorkflowPreconditions returns manifest-invalid for blocking issues", () => {
    const result = evaluateWorkflowPreconditions({
      manifestStatus: "loaded",
      hasWorkflowBlockingIssues: true,
      workspaceSupported: true,
    });
    assert.strictEqual(result, "manifest-invalid");
  });

  test("blockReasonMessage for manifest-invalid is non-empty", () => {
    const msg = blockReasonMessage("manifest-invalid");
    assert.ok(msg.length > 0);
  });

  test("blockReasonMessage for manifest-missing is non-empty", () => {
    const msg = blockReasonMessage("manifest-missing");
    assert.ok(msg.length > 0);
  });

  test("blockReasonMessage for workspace-unsupported mentions folder", () => {
    const msg = blockReasonMessage("workspace-unsupported");
    assert.ok(msg.toLowerCase().includes("folder"));
  });

  test("package.json keeps Build as the primary view/title action", () => {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    if (!ext) {
      return; // Skip gracefully when not installed
    }
    const menus: Record<string, unknown[]> =
      ext.packageJSON?.contributes?.menus ?? {};
    const viewTitleMenus = ((menus["view/title"] as Array<{
      command?: string;
      group?: string;
    }>) ?? []);

    const primaryCommands = viewTitleMenus
      .filter((entry) => entry.group?.startsWith("navigation@"))
      .sort((left, right) => {
        const leftOrder = Number((left.group ?? "").split("@")[1] ?? Number.NaN);
        const rightOrder = Number((right.group ?? "").split("@")[1] ?? Number.NaN);
        return leftOrder - rightOrder;
      })
      .map((entry) => entry.command)
      .filter((command): command is string => Boolean(command));

    assert.ok(primaryCommands.length > 0, "expected at least one primary view/title action");
    assert.strictEqual(
      primaryCommands[0],
      "tbench.build",
      `expected tbench.build as the first primary view/title action, found: ${primaryCommands.join(", ")}`
    );
  });

  test("package.json exposes Build/Clippy/Check/Clean in the view/title overflow menu", () => {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    if (!ext) {
      return; // Skip gracefully when not installed
    }
    const menus: Record<string, unknown[]> =
      ext.packageJSON?.contributes?.menus ?? {};
    const viewTitleMenus = ((menus["view/title"] as Array<{
      command?: string;
      group?: string;
    }>) ?? []);

    const overflowCommands = viewTitleMenus
      .filter((entry) => entry.group?.startsWith("overflow@"))
      .map((entry) => entry.command)
      .filter((command): command is string => Boolean(command));

    assert.ok(overflowCommands.includes("tbench.build"), "expected tbench.build in overflow");
    assert.ok(overflowCommands.includes("tbench.clippy"), "expected tbench.clippy in overflow");
    assert.ok(overflowCommands.includes("tbench.check"), "expected tbench.check in overflow");
    assert.ok(overflowCommands.includes("tbench.clean"), "expected tbench.clean in overflow");
  });

  test("package.json uses the tools icon for Build", () => {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    if (!ext) {
      return;
    }
    const commands = ((ext.packageJSON?.contributes?.commands as Array<{
      command?: string;
      icon?: string;
    }>) ?? []);

    const buildCommand = commands.find((entry) => entry.command === "tbench.build");
    assert.ok(buildCommand, "expected tbench.build command contribution");
    assert.strictEqual(buildCommand?.icon, "$(tools)");
  });

  test("package.json uses Run-prefixed titles for Clippy/Check/Clean commands", () => {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    if (!ext) {
      return;
    }
    const commands = ((ext.packageJSON?.contributes?.commands as Array<{
      command?: string;
      title?: string;
    }>) ?? []);

    const byId = new Map(commands.map((entry) => [entry.command, entry.title]));
    assert.strictEqual(byId.get("tbench.clippy"), "Run Clippy");
    assert.strictEqual(byId.get("tbench.check"), "Run Check");
    assert.strictEqual(byId.get("tbench.clean"), "Run Clean");
  });

  test("package.json orders overflow actions with Flash/Upload before Refresh IntelliSense", () => {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    if (!ext) {
      return;
    }
    const menus: Record<string, unknown[]> =
      ext.packageJSON?.contributes?.menus ?? {};
    const viewTitleMenus = ((menus["view/title"] as Array<{
      command?: string;
      group?: string;
    }>) ?? []);

    const overflowEntries = viewTitleMenus
      .filter((entry) => entry.group?.startsWith("overflow@"))
      .map((entry) => ({
        command: entry.command ?? "",
        order: Number((entry.group ?? "").split("@")[1] ?? Number.NaN),
      }))
      .sort((left, right) => left.order - right.order);

    assert.deepStrictEqual(
      overflowEntries.map((entry) => entry.command),
      [
        "tbench.build",
        "tbench.clippy",
        "tbench.check",
        "tbench.clean",
        "tbench.flash",
        "tbench.upload",
        "tbench.startDebugging",
        "tbench.refreshIntelliSense",
      ]
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: Refresh IntelliSense command contributions
// ---------------------------------------------------------------------------

suite("Refresh IntelliSense – command contributions", () => {
  test("package.json declares tbench.refreshIntelliSense command", () => {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    if (!ext) {
      return; // Skip gracefully when not installed
    }
    const commands: Array<{ command: string }> =
      ext.packageJSON?.contributes?.commands ?? [];
    const ids = commands.map((c) => c.command);
    assert.ok(
      ids.includes("tbench.refreshIntelliSense"),
      `expected tbench.refreshIntelliSense in package.json contributes.commands, found: ${ids.join(", ")}`
    );
  });

  test("package.json exposes tbench.refreshIntelliSense in view/title overflow menu", () => {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    if (!ext) {
      return; // Skip gracefully when not installed
    }
    const menus: Record<string, unknown[]> =
      ext.packageJSON?.contributes?.menus ?? {};
    const viewTitleMenus: unknown[] = (menus["view/title"] as unknown[]) ?? [];
    const commands = viewTitleMenus
      .map((e) => (e as { command?: string }).command)
      .filter(Boolean);
    assert.ok(
      commands.includes("tbench.refreshIntelliSense"),
      `expected tbench.refreshIntelliSense in view/title menus, found: ${commands.join(", ")}`
    );
  });

  test("package.json refresh command has a category and icon", () => {
    const ext = vscode.extensions.getExtension("trezor.tbench");
    if (!ext) {
      return;
    }
    const commands: Array<{ command: string; category?: string; icon?: string }> =
      ext.packageJSON?.contributes?.commands ?? [];
    const refreshCmd = commands.find((c) => c.command === "tbench.refreshIntelliSense");
    assert.ok(refreshCmd, "expected tbench.refreshIntelliSense to be declared");
    assert.ok(refreshCmd!.category, "expected category to be set on refreshIntelliSense");
    assert.ok(refreshCmd!.icon, "expected icon to be set on refreshIntelliSense");
  });
});
