import * as assert from "assert";
import {
  isSuccessfulArtifactRefreshTaskProcess,
  TaskProcessEndLike,
} from "../../../extension";

function makeEvent(overrides: Partial<TaskProcessEndLike> = {}): TaskProcessEndLike {
  return {
    exitCode: 0,
    execution: {
      task: {
        definition: { type: "tfTools" },
        name: "Build Trezor Model T (v1) | HW | Core",
      },
    },
    ...overrides,
  };
}

suite("isSuccessfulArtifactRefreshTaskProcess", () => {
  test("returns true for a successful tfTools Build task", () => {
    assert.strictEqual(isSuccessfulArtifactRefreshTaskProcess(makeEvent()), true);
  });

  test("returns true for a successful tfTools Clean task", () => {
    assert.strictEqual(
      isSuccessfulArtifactRefreshTaskProcess(
        makeEvent({
          execution: {
            task: {
              definition: { type: "tfTools" },
              name: "Clean",
            },
          },
        })
      ),
      true
    );
  });

  test("returns false when the task failed", () => {
    assert.strictEqual(
      isSuccessfulArtifactRefreshTaskProcess(makeEvent({ exitCode: 1 })),
      false
    );
  });

  test("returns false for non-artifact-producing tfTools tasks", () => {
    assert.strictEqual(
      isSuccessfulArtifactRefreshTaskProcess(
        makeEvent({
          execution: {
            task: {
              definition: { type: "tfTools" },
              name: "Check Trezor Model T (v1) | HW | Core",
            },
          },
        })
      ),
      false
    );
  });

  test("returns false for non-tfTools tasks", () => {
    assert.strictEqual(
      isSuccessfulArtifactRefreshTaskProcess(
        makeEvent({
          execution: {
            task: {
              definition: { type: "shell" },
              name: "Build Trezor Model T (v1) | HW | Core",
            },
          },
        })
      ),
      false
    );
  });
});