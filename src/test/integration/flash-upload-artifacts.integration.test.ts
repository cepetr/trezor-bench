/**
 * Integration tests for Binary and Map File artifact rows.
 *
 * Covers:
 *  - BinaryArtifactItem and MapArtifactItem contextValues are correct for row-scoped actions
 *  - package.json view/item/context entries exist with proper enablement rules
 *  - Binary row flash enablement expression references binaryExists
 *  - Map row openMapFile enablement expression references mapExists
 */

import * as assert from "assert";
import * as vscode from "vscode";
import {
  BinaryArtifactItem,
  MapArtifactItem,
} from "../../ui/build-artifacts-pane";
import { ResolvedArtifact } from "../../build/artifact-resolution";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePresentBinaryArtifact(): ResolvedArtifact {
  return {
    path: "/build/model-t/firmware_core.bin",
    exists: true,
    status: "present",
    contextKey: "T2T1::hw::core",
  };
}

function makeMissingBinaryArtifact(): ResolvedArtifact {
  return {
    path: "/build/model-t/firmware_core.bin",
    exists: false,
    status: "missing",
    missingReason: "Binary not found. Build the firmware first.",
    contextKey: "T2T1::hw::core",
  };
}

function makePresentMapArtifact(): ResolvedArtifact {
  return {
    path: "/build/model-t/firmware_core.map",
    exists: true,
    status: "present",
    contextKey: "T2T1::hw::core",
  };
}

function makeMissingMapArtifact(): ResolvedArtifact {
  return {
    path: "/build/model-t/firmware_core.map",
    exists: false,
    status: "missing",
    missingReason: "Map file not found.",
    contextKey: "T2T1::hw::core",
  };
}

// ---------------------------------------------------------------------------
// Suite: BinaryArtifactItem context values (row-scoped actions)
// ---------------------------------------------------------------------------

suite("Flash/Upload artifacts – BinaryArtifactItem", () => {
  test("contextValue is 'artifact-binary' for valid artifact", () => {
    const item = new BinaryArtifactItem(makePresentBinaryArtifact());
    assert.strictEqual(
      item.contextValue,
      "artifact-binary",
      "Binary row must have contextValue 'artifact-binary' to enable Flash/Upload actions"
    );
  });

  test("contextValue is 'artifact-binary' for missing artifact (action visible but disabled)", () => {
    const item = new BinaryArtifactItem(makeMissingBinaryArtifact());
    assert.strictEqual(
      item.contextValue,
      "artifact-binary",
      "Missing Binary row must keep contextValue 'artifact-binary' so actions remain visible"
    );
  });

  test("id is 'artifact:binary'", () => {
    const item = new BinaryArtifactItem(makePresentBinaryArtifact());
    assert.strictEqual(item.id, "artifact:binary");
  });

  test("valid binary shows 'present' description", () => {
    const item = new BinaryArtifactItem(makePresentBinaryArtifact());
    assert.strictEqual(item.description, "present");
  });

  test("missing binary shows 'missing' description", () => {
    const item = new BinaryArtifactItem(makeMissingBinaryArtifact());
    assert.strictEqual(item.description, "missing");
  });

  test("missing binary tooltip includes missingReason", () => {
    const item = new BinaryArtifactItem(makeMissingBinaryArtifact());
    assert.ok(
      String(item.tooltip).includes("Build the firmware first"),
      `expected missingReason in tooltip, got: ${item.tooltip}`
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: MapArtifactItem context values (row-scoped actions)
// ---------------------------------------------------------------------------

suite("Flash/Upload artifacts – MapArtifactItem", () => {
  test("contextValue is 'artifact-map' for valid artifact", () => {
    const item = new MapArtifactItem(makePresentMapArtifact());
    assert.strictEqual(
      item.contextValue,
      "artifact-map",
      "Map File row must have contextValue 'artifact-map' to enable openMapFile action"
    );
  });

  test("contextValue is 'artifact-map' for missing artifact (action visible but disabled)", () => {
    const item = new MapArtifactItem(makeMissingMapArtifact());
    assert.strictEqual(
      item.contextValue,
      "artifact-map",
      "Missing Map row must keep contextValue 'artifact-map' so openMapFile remains visible"
    );
  });

  test("id is 'artifact:map'", () => {
    const item = new MapArtifactItem(makePresentMapArtifact());
    assert.strictEqual(item.id, "artifact:map");
  });

  test("valid map shows 'present' description", () => {
    const item = new MapArtifactItem(makePresentMapArtifact());
    assert.strictEqual(item.description, "present");
  });

  test("missing map shows 'missing' description", () => {
    const item = new MapArtifactItem(makeMissingMapArtifact());
    assert.strictEqual(item.description, "missing");
  });

  test("missing map tooltip includes missingReason", () => {
    const item = new MapArtifactItem(makeMissingMapArtifact());
    assert.ok(
      String(item.tooltip).includes("Map file not found"),
      `expected missingReason in tooltip, got: ${item.tooltip}`
    );
  });
});

// ---------------------------------------------------------------------------
// Suite: package.json view/item/context enablement rules
// ---------------------------------------------------------------------------

suite("Flash/Upload artifacts – menu enablement rules", () => {
  function getExtPackageJson(): Record<string, unknown> | undefined {
    const ext = vscode.extensions.getExtension("cepetr.tbench");
    return ext?.packageJSON as Record<string, unknown> | undefined;
  }

  test("Binary-row flash entry has enablement: tbench.binaryExists", () => {
    const pkg = getExtPackageJson();
    if (!pkg) { return; } // Skip if extension not loaded
    const menus = pkg.contributes as { menus: Record<string, unknown[]> };
    const contextEntries = (menus.menus["view/item/context"] ?? []) as Array<{
      command: string;
      when?: string;
      enablement?: string;
    }>;
    const flashEntry = contextEntries.find(
      (e) => e.command === "tbench.flash" && e.when?.includes("artifact-binary")
    );
    assert.ok(flashEntry, "expected view/item/context flash entry for artifact-binary");
    assert.strictEqual(
      flashEntry.enablement,
      "tbench.binaryExists",
      "flash enablement must be 'tbench.binaryExists'"
    );
  });

  test("Binary-row upload entry has enablement: tbench.binaryExists", () => {
    const pkg = getExtPackageJson();
    if (!pkg) { return; }
    const menus = pkg.contributes as { menus: Record<string, unknown[]> };
    const contextEntries = (menus.menus["view/item/context"] ?? []) as Array<{
      command: string;
      when?: string;
      enablement?: string;
    }>;
    const uploadEntry = contextEntries.find(
      (e) => e.command === "tbench.upload" && e.when?.includes("artifact-binary")
    );
    assert.ok(uploadEntry, "expected view/item/context upload entry for artifact-binary");
    assert.strictEqual(
      uploadEntry.enablement,
      "tbench.binaryExists",
      "upload enablement must be 'tbench.binaryExists'"
    );
  });

  test("Map-row openMapFile entry has enablement: tbench.mapExists", () => {
    const pkg = getExtPackageJson();
    if (!pkg) { return; }
    const menus = pkg.contributes as { menus: Record<string, unknown[]> };
    const contextEntries = (menus.menus["view/item/context"] ?? []) as Array<{
      command: string;
      when?: string;
      enablement?: string;
    }>;
    const mapEntry = contextEntries.find(
      (e) => e.command === "tbench.openMapFile" && e.when?.includes("artifact-map")
    );
    assert.ok(mapEntry, "expected view/item/context openMapFile entry for artifact-map");
    assert.strictEqual(
      mapEntry.enablement,
      "tbench.mapExists",
      "openMapFile enablement must be 'tbench.mapExists'"
    );
  });
});
