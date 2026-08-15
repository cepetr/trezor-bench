/**
 * Unit tests for blocked-action gating and failure reasons.
 *
 * Blocked Build/Clippy/Check/Clean actions produce visible failure feedback.
 * Unsupported workspaces block all four workflow actions.
 * Failed tasks produce a visible notification and a persistent log entry.
 */
import * as assert from "assert";
import {
  evaluateWorkflowPreconditions,
  blockReasonMessage,
  WorkflowBlockReason,
  PreconditionInputs,
} from "../../../commands/build-workflow";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inputs(
  manifestStatus: "loaded" | "missing" | "invalid",
  hasWorkflowBlockingIssues: boolean,
  workspaceSupported: boolean,
  presetsInvalid: boolean = false,
  presetsUnavailable: boolean = false
): PreconditionInputs {
  return {
    manifestStatus,
    hasWorkflowBlockingIssues,
    workspaceSupported,
    buildSelectionResolved: true,
    presetsInvalid,
    presetsUnavailable,
  };
}

// ---------------------------------------------------------------------------
// Suite: evaluateWorkflowPreconditions
// ---------------------------------------------------------------------------

suite("evaluateWorkflowPreconditions – blocking logic", () => {
  test("returns no-block when all preconditions are met", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("loaded", false, true)),
      "no-block"
    );
  });

  test("workspace-unsupported blocks when workspace has multiple/no folders", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("loaded", false, false)),
      "workspace-unsupported"
    );
  });

  test("manifest-missing blocks when manifest file absent", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("missing", false, true)),
      "manifest-missing"
    );
  });

  test("manifest-invalid blocks when manifest has structural errors", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("invalid", false, true)),
      "manifest-invalid"
    );
  });

  test("manifest-invalid blocks when manifest has invalid when expressions", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("loaded", true, true)),
      "manifest-invalid"
    );
  });

  test("context-unresolved blocks when the active configuration no longer resolves", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions({ ...inputs("loaded", false, true), buildSelectionResolved: false }),
      "context-unresolved"
    );
  });

  test("workspace-unsupported takes priority over manifest-missing", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("missing", false, false)),
      "workspace-unsupported"
    );
  });

  test("workspace-unsupported takes priority over manifest-invalid", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("invalid", false, false)),
      "workspace-unsupported"
    );
  });

  test("workspace-unsupported takes priority over hasWorkflowBlockingIssues", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("loaded", true, false)),
      "workspace-unsupported"
    );
  });

  // -------------------------------------------------------------------------
  // presets-invalid
  // -------------------------------------------------------------------------

  test("presets-invalid blocks when preset data is invalid or an option mismatches", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("loaded", false, true, true)),
      "presets-invalid"
    );
  });

  test("presets-invalid does not block when preset data is valid", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("loaded", false, true, false)),
      "no-block"
    );
  });

  test("manifest-invalid takes priority over presets-invalid", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("invalid", false, true, true)),
      "manifest-invalid"
    );
  });

  test("manifest-missing takes priority over presets-invalid", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("missing", false, true, true)),
      "manifest-missing"
    );
  });

  test("workspace-unsupported takes priority over presets-invalid", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("loaded", false, false, true)),
      "workspace-unsupported"
    );
  });

  // -------------------------------------------------------------------------
  // presets-unavailable (evaluated after manifest-invalid and before
  // presets-invalid)
  // -------------------------------------------------------------------------

  test("presets-unavailable blocks when the shared presets.toml does not exist", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("loaded", false, true, false, true)),
      "presets-unavailable"
    );
  });

  test("presets-unavailable takes priority over presets-invalid, which it also implies", () => {
    // extension.ts sets both flags for an absent shared file, since the
    // unavailable state is preset-blocking too — the more specific reason wins.
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("loaded", false, true, true, true)),
      "presets-unavailable"
    );
  });

  test("manifest-invalid takes priority over presets-unavailable", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("invalid", false, true, false, true)),
      "manifest-invalid"
    );
  });

  test("manifest-missing takes priority over presets-unavailable", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("missing", false, true, false, true)),
      "manifest-missing"
    );
  });

  test("workspace-unsupported takes priority over presets-unavailable", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("loaded", false, false, false, true)),
      "workspace-unsupported"
    );
  });

  test("presets-unavailable does not block when the shared file is present", () => {
    assert.strictEqual(
      evaluateWorkflowPreconditions(inputs("loaded", false, true, false, false)),
      "no-block"
    );
  });

  test("every existing reason and priority is unchanged when presets are valid", () => {
    assert.strictEqual(evaluateWorkflowPreconditions(inputs("loaded", false, true, false)), "no-block");
    assert.strictEqual(evaluateWorkflowPreconditions(inputs("missing", false, true, false)), "manifest-missing");
    assert.strictEqual(evaluateWorkflowPreconditions(inputs("invalid", false, true, false)), "manifest-invalid");
    assert.strictEqual(evaluateWorkflowPreconditions(inputs("loaded", false, false, false)), "workspace-unsupported");
  });
});

// ---------------------------------------------------------------------------
// Suite: blockReasonMessage
// ---------------------------------------------------------------------------

suite("blockReasonMessage – user-facing failure text", () => {
  const REASONS: WorkflowBlockReason[] = [
    "workspace-unsupported",
    "manifest-missing",
    "manifest-invalid",
    "context-unresolved",
    "presets-unavailable",
    "presets-invalid",
  ];

  for (const reason of REASONS) {
    test(`produces non-empty message for ${reason}`, () => {
      const msg = blockReasonMessage(reason);
      assert.ok(msg.length > 0, `expected non-empty message for ${reason}`);
    });
  }

  test("workspace-unsupported message mentions single folder requirement", () => {
    const msg = blockReasonMessage("workspace-unsupported");
    assert.ok(
      msg.toLowerCase().includes("folder"),
      "message should mention workspace folder requirement"
    );
  });

  test("manifest-missing message mentions the manifest file", () => {
    const msg = blockReasonMessage("manifest-missing");
    assert.ok(
      msg.toLowerCase().includes("manifest"),
      "message should mention the manifest file"
    );
    assert.ok(msg.includes("manifest.yaml"), "message should name manifest.yaml");
    assert.ok(
      msg.includes("[paths].manifest in tbench.toml"),
      "message should identify the manifest path setting"
    );
  });

  test("manifest-invalid message mentions validation errors or availability rules", () => {
    const msg = blockReasonMessage("manifest-invalid");
    assert.ok(
      msg.toLowerCase().includes("validation") ||
        msg.toLowerCase().includes("error") ||
        msg.toLowerCase().includes("availability"),
      "message should mention errors or validation"
    );
  });

  test("presets-invalid message is distinct from manifest-invalid's message and mentions presets", () => {
    const msg = blockReasonMessage("presets-invalid");
    assert.ok(msg.toLowerCase().includes("preset"), "message should mention presets");
    assert.notStrictEqual(msg, blockReasonMessage("manifest-invalid"));
  });

  test("presets-unavailable message names presets.toml and is distinct from presets-invalid's", () => {
    const msg = blockReasonMessage("presets-unavailable");
    assert.ok(msg.includes("presets.toml"), "message should name the missing file");
    assert.ok(
      msg.includes("xtask-presets"),
      "message should identify the configured presets path"
    );
    assert.ok(
      msg.includes("core/embed/xtask"),
      "message should name the default presets directory"
    );
    assert.ok(!msg.includes("cargo workspace"), "message should not refer to cargo workspace");
    assert.ok(!msg.includes("xtask/tf-tools"), "message should not use the manifest subdirectory");
    assert.notStrictEqual(msg, blockReasonMessage("presets-invalid"));
  });

  test("no-block returns an empty string", () => {
    assert.strictEqual(blockReasonMessage("no-block"), "");
  });
});
