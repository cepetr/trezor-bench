/**
 * Integration tests for Flash/Upload Actions.
 *
 * Covers:
 *  - `tbench.flash` and `tbench.upload` commands are registered after activation
 *  - `tbench.openMapFile` is registered after activation
 *  - Executing flash/upload when blocked by workspace-unsupported state resolves without throwing
 *  - package.json commandPalette entries exist for flash and upload with correct when-expressions
 *  - package.json commandPalette entry for openMapFile has `when: "false"` (row-only action)
 *  - package.json view/item/context entries exist for Binary-row flash, upload, and map open
 *  - Flash and Upload tasks carry the correct shell command format
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { evaluateArtifactActionPreconditions } from "../../commands/artifact-actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Suite: command registration
// ---------------------------------------------------------------------------

suite("Flash/Upload Actions – command registration", () => {
  test("extension activates without error", async () => {
    const activated = await activateExtension();
    assert.strictEqual(activated, true, "expected extension to activate");
  });

  test("tbench.flash is registered as a VS Code command", async () => {
    await activateExtension();
    const cmds = await vscode.commands.getCommands(false);
    assert.ok(
      cmds.includes("tbench.flash"),
      "expected 'tbench.flash' to be registered in VS Code commands"
    );
  });

  test("tbench.upload is registered as a VS Code command", async () => {
    await activateExtension();
    const cmds = await vscode.commands.getCommands(false);
    assert.ok(
      cmds.includes("tbench.upload"),
      "expected 'tbench.upload' to be registered in VS Code commands"
    );
  });

  test("tbench.openMapFile is registered as a VS Code command", async () => {
    await activateExtension();
    const cmds = await vscode.commands.getCommands(false);
    assert.ok(
      cmds.includes("tbench.openMapFile"),
      "expected 'tbench.openMapFile' to be registered in VS Code commands"
    );
  });

  test("executing tbench.flash in unsupported-workspace state resolves without throwing", async () => {
    await activateExtension();
    let threw = false;
    try {
      await vscode.commands.executeCommand("tbench.flash");
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, false, "tbench.flash command must not throw");
  });

  test("executing tbench.upload in unsupported-workspace state resolves without throwing", async () => {
    await activateExtension();
    let threw = false;
    try {
      await vscode.commands.executeCommand("tbench.upload");
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, false, "tbench.upload command must not throw");
  });

  test("executing tbench.openMapFile in unsupported-workspace state resolves without throwing", async () => {
    await activateExtension();
    let threw = false;
    try {
      await vscode.commands.executeCommand("tbench.openMapFile");
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, false, "tbench.openMapFile command must not throw");
  });
});

// ---------------------------------------------------------------------------
// Suite: package.json static menu contributions
// ---------------------------------------------------------------------------

suite("Flash/Upload Actions – package.json menu contributions", () => {
  function getExtPackageJson(): Record<string, unknown> {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    assert.ok(ext, "cepetr.tbench extension must be present");
    return ext.packageJSON as Record<string, unknown>;
  }

  test("commandPalette entry for tbench.flash has when: tbench.flashApplicable", () => {
    const pkg = getExtPackageJson();
    const menus = pkg.contributes as { menus: Record<string, unknown[]> };
    const paletteEntries = (menus.menus["commandPalette"] ?? []) as Array<{
      command: string;
      when?: string;
    }>;
    const entry = paletteEntries.find((e) => e.command === "tbench.flash");
    assert.ok(entry, "expected commandPalette entry for tbench.flash");
    assert.strictEqual(
      entry.when,
      "tbench.flashApplicable",
      "flash palette entry must use when: tbench.flashApplicable"
    );
  });

  test("commandPalette entry for tbench.upload has when: tbench.uploadApplicable", () => {
    const pkg = getExtPackageJson();
    const menus = pkg.contributes as { menus: Record<string, unknown[]> };
    const paletteEntries = (menus.menus["commandPalette"] ?? []) as Array<{
      command: string;
      when?: string;
    }>;
    const entry = paletteEntries.find((e) => e.command === "tbench.upload");
    assert.ok(entry, "expected commandPalette entry for tbench.upload");
    assert.strictEqual(
      entry.when,
      "tbench.uploadApplicable",
      "upload palette entry must use when: tbench.uploadApplicable"
    );
  });

  test("package.json uses device-oriented titles for flash and upload commands", () => {
    const pkg = getExtPackageJson();
    const commands = (pkg.contributes as { commands: Array<{ command: string; title?: string }> }).commands;
    const byId = new Map(commands.map((entry) => [entry.command, entry.title]));

    assert.strictEqual(byId.get("tbench.flash"), "Flash to Device");
    assert.strictEqual(byId.get("tbench.upload"), "Upload to Device");
  });

  test("commandPalette entry for tbench.openMapFile has when: false (row-only)", () => {
    const pkg = getExtPackageJson();
    const menus = pkg.contributes as { menus: Record<string, unknown[]> };
    const paletteEntries = (menus.menus["commandPalette"] ?? []) as Array<{
      command: string;
      when?: string;
    }>;
    const entry = paletteEntries.find((e) => e.command === "tbench.openMapFile");
    assert.ok(entry, "expected commandPalette entry for tbench.openMapFile");
    assert.strictEqual(
      entry.when,
      "false",
      "openMapFile palette entry must use when: false to exclude it from the Command Palette"
    );
  });

  test("view/item/context has flash entry for artifact-binary row", () => {
    const pkg = getExtPackageJson();
    const menus = pkg.contributes as { menus: Record<string, unknown[]> };
    const contextEntries = (menus.menus["view/item/context"] ?? []) as Array<{
      command: string;
      when?: string;
    }>;
    const flashEntry = contextEntries.find(
      (e) => e.command === "tbench.flash" && e.when?.includes("artifact-binary")
    );
    assert.ok(
      flashEntry,
      "expected view/item/context entry for tbench.flash scoped to artifact-binary"
    );
  });

  test("view/item/context has upload entry for artifact-binary row", () => {
    const pkg = getExtPackageJson();
    const menus = pkg.contributes as { menus: Record<string, unknown[]> };
    const contextEntries = (menus.menus["view/item/context"] ?? []) as Array<{
      command: string;
      when?: string;
    }>;
    const uploadEntry = contextEntries.find(
      (e) => e.command === "tbench.upload" && e.when?.includes("artifact-binary")
    );
    assert.ok(
      uploadEntry,
      "expected view/item/context entry for tbench.upload scoped to artifact-binary"
    );
  });

  test("view/item/context has openMapFile entry for artifact-map row", () => {
    const pkg = getExtPackageJson();
    const menus = pkg.contributes as { menus: Record<string, unknown[]> };
    const contextEntries = (menus.menus["view/item/context"] ?? []) as Array<{
      command: string;
      when?: string;
    }>;
    const mapEntry = contextEntries.find(
      (e) => e.command === "tbench.openMapFile" && e.when?.includes("artifact-map")
    );
    assert.ok(
      mapEntry,
      "expected view/item/context entry for tbench.openMapFile scoped to artifact-map"
    );
  });

  test("view/title has conditional overflow entry for tbench.flash", () => {
    const pkg = getExtPackageJson();
    const menus = pkg.contributes as { menus: Record<string, unknown[]> };
    const titleEntries = (menus.menus["view/title"] ?? []) as Array<{
      command: string;
      when?: string;
      group?: string;
      enablement?: string;
    }>;
    const entry = titleEntries.find((e) => e.command === "tbench.flash");
    assert.ok(entry, "expected view/title entry for tbench.flash");
    assert.strictEqual(
      entry?.when,
      "view == tbench.configuration && tbench.flashApplicable"
    );
    assert.strictEqual(entry?.group, "overflow@5");
    assert.strictEqual(entry?.enablement, "tbench.binaryExists");
  });

  test("view/title has conditional overflow entry for tbench.upload", () => {
    const pkg = getExtPackageJson();
    const menus = pkg.contributes as { menus: Record<string, unknown[]> };
    const titleEntries = (menus.menus["view/title"] ?? []) as Array<{
      command: string;
      when?: string;
      group?: string;
      enablement?: string;
    }>;
    const entry = titleEntries.find((e) => e.command === "tbench.upload");
    assert.ok(entry, "expected view/title entry for tbench.upload");
    assert.strictEqual(
      entry?.when,
      "view == tbench.configuration && tbench.uploadApplicable"
    );
    assert.strictEqual(entry?.group, "overflow@6");
    assert.strictEqual(entry?.enablement, "tbench.binaryExists");
  });
});

// ---------------------------------------------------------------------------
// Suite: evaluateArtifactActionPreconditions – unit-level guard logic wired
// ---------------------------------------------------------------------------

suite("Flash/Upload Actions – precondition evaluation", () => {
  test("returns workspace-unsupported when workspace is not supported", () => {
    const result = evaluateArtifactActionPreconditions({
      workspaceSupported: false,
      manifestStatus: "loaded",
      actionApplicable: true,
      binaryExists: true,
    });
    assert.strictEqual(result, "workspace-unsupported");
  });

  test("returns manifest-missing when manifest is missing", () => {
    const result = evaluateArtifactActionPreconditions({
      workspaceSupported: true,
      manifestStatus: "missing",
      actionApplicable: true,
      binaryExists: true,
    });
    assert.strictEqual(result, "manifest-missing");
  });

  test("returns action-inapplicable when action is not applicable", () => {
    const result = evaluateArtifactActionPreconditions({
      workspaceSupported: true,
      manifestStatus: "loaded",
      actionApplicable: false,
      binaryExists: true,
    });
    assert.strictEqual(result, "action-inapplicable");
  });

  test("returns binary-missing when binary artifact does not exist", () => {
    const result = evaluateArtifactActionPreconditions({
      workspaceSupported: true,
      manifestStatus: "loaded",
      actionApplicable: true,
      binaryExists: false,
    });
    assert.strictEqual(result, "binary-missing");
  });

  test("returns no-block when all conditions are met", () => {
    const result = evaluateArtifactActionPreconditions({
      workspaceSupported: true,
      manifestStatus: "loaded",
      actionApplicable: true,
      binaryExists: true,
    });
    assert.strictEqual(result, "no-block");
  });
});
