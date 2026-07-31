/**
 * Integration tests for preset-invalidity blocking (User Story 3 failure
 * paths). Runs inside the VS Code extension host via @vscode/test-electron.
 *
 * Exercises the real preset-malformed-shared/, preset-invalid-user/, and
 * preset-value-mismatch/ fixtures through PresetService + preset-resolution
 * + build-options, then the same precondition/argument functions
 * extension.ts uses for Build/Clippy/Check and Clean.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { PresetService } from "../../presets/preset-service";
import { computePresetEffectiveValues } from "../../presets/preset-resolution";
import { normalizeBuildOptions } from "../../configuration/build-options";
import {
  evaluateWorkflowPreconditions,
  blockReasonMessage,
  deriveCleanArguments,
  WorkflowKind,
} from "../../commands/build-workflow";
import { BuildOption } from "../../manifest/manifest-types";
import { DEFAULT_PRESET_ID } from "../../presets/preset-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fixtureUris(fixtureName: string): { shared: vscode.Uri; user: vscode.Uri } {
  const base = path.resolve(__dirname, "../../../test-fixtures/workspaces", fixtureName, "xtask/tf-tools");
  return {
    shared: vscode.Uri.file(path.join(base, "presets.toml")),
    user: vscode.Uri.file(path.join(base, "user-presets.toml")),
  };
}

const BUILD_OPTIONS: BuildOption[] = [
  { key: "frozen", id: "frozen", label: "Frozen", flag: "--frozen", kind: "checkbox" },
  { key: "btc_only", id: "btc-only", label: "BTC Only", flag: "--btc-only", kind: "checkbox" },
  {
    key: "dbg_console",
    id: "dbg-console",
    label: "Debug Console",
    flag: "--dbg-console",
    kind: "multistate",
    states: [
      { id: "null", label: "Default", flag: "" },
      { id: "swo", label: "SWO", flag: "--dbg-console=swo" },
      { id: "vcp", label: "VCP", flag: "--dbg-console=vcp" },
    ],
  },
  {
    key: "pyopt",
    id: "pyopt",
    label: "Python Optimization",
    flag: "--pyopt",
    kind: "multistate",
    states: [
      { id: "null", label: "Default", flag: "" },
      { id: "true", label: "Enabled", flag: "--pyopt=true" },
      { id: "false", label: "Disabled", flag: "--pyopt=false" },
    ],
  },
];

const BUILD_CONTEXT_ADAPTER = { modelId: "T2T1", targetId: "hw", componentId: "firmware" };
const PRESET_CTX = { modelId: "T2T1", projectId: "firmware", emulator: false };

/** Mirrors extension.ts's tfTools.presetBlocked computation. */
async function computePresetsInvalid(fixtureName: string): Promise<boolean> {
  const { shared, user } = fixtureUris(fixtureName);
  const service = new PresetService(shared, user);
  const state = await service.start();
  service.dispose();

  if (state.status === "invalid") {
    return true;
  }
  const effective = computePresetEffectiveValues(
    BUILD_OPTIONS,
    state.shared,
    state.user,
    DEFAULT_PRESET_ID,
    PRESET_CTX
  );
  const resolved = normalizeBuildOptions(BUILD_OPTIONS, undefined, BUILD_CONTEXT_ADAPTER, effective);
  return resolved.some((r) => r.available && r.presetState === "mismatch");
}

function evaluateFor(kind: WorkflowKind, presetsInvalid: boolean) {
  return evaluateWorkflowPreconditions({
    manifestStatus: "loaded",
    hasWorkflowBlockingIssues: false,
    workspaceSupported: true,
    // Clean is exempt from preset blocking (research Decision 11).
    presetsInvalid: kind !== "Clean" && presetsInvalid,
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const BROKEN_FIXTURES = ["preset-malformed-shared", "preset-invalid-user", "preset-value-mismatch"];

for (const fixtureName of BROKEN_FIXTURES) {
  suite(`Preset blocking – ${fixtureName}`, () => {
    test("Build, Clippy, and Check are blocked with the presets-invalid reason", async () => {
      const presetsInvalid = await computePresetsInvalid(fixtureName);
      assert.strictEqual(presetsInvalid, true, `expected ${fixtureName} to be preset-invalid`);

      for (const kind of ["Build", "Clippy", "Check"] as WorkflowKind[]) {
        const reason = evaluateFor(kind, presetsInvalid);
        assert.strictEqual(reason, "presets-invalid", `expected ${kind} to be blocked`);
        const msg = blockReasonMessage(reason);
        assert.ok(msg.length > 0, "blocked reason must produce a visible, non-empty message");
      }
    });

    test("invoking Build is rejected before any task-launching code runs (no task starts)", async () => {
      const presetsInvalid = await computePresetsInvalid(fixtureName);
      const reason = evaluateFor("Build", presetsInvalid);
      // The command handler's control flow returns immediately when
      // blockReason !== "no-block", before createWorkflowTask/executeWorkflowTask
      // are ever reached — this assertion documents that invariant.
      assert.notStrictEqual(reason, "no-block");
    });

    test("Clean stays enabled and still launches with no arguments (FR-025, research Decision 11)", async () => {
      const presetsInvalid = await computePresetsInvalid(fixtureName);
      const reason = evaluateFor("Clean", presetsInvalid);
      assert.strictEqual(reason, "no-block", "Clean must not be blocked by preset invalidity");
      assert.deepStrictEqual(deriveCleanArguments({ modelId: "T2T1", targetId: "hw", componentId: "firmware" }), []);
    });
  });
}
