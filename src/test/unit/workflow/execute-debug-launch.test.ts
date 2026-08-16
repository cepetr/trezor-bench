/**
 * Unit tests for the Start Debugging command handler (`executeDebugLaunch`).
 *
 * Template machinery and profile matching are covered by `debug-launch.test.ts`;
 * these tests cover the command flow: blocked-state early returns, default vs
 * QuickPick profile selection, the proxy configuration handed to
 * `vscode.debug.startDebugging`, and start-failure reporting.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import { executeDebugLaunch } from "../../../commands/debug-launch";
import { makeContextKey } from "../../../build/artifact-resolution";
import { BuildContext } from "../../../manifest/manifest-types";
import { makeComponentDebugProfile, makeDebugLoadedState } from "../workflow-test-helpers";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_FOLDER = {
  uri: vscode.Uri.file("/workspace"),
  name: "workspace",
  index: 0,
} as vscode.WorkspaceFolder;

const BUILD_CONTEXT: BuildContext = {
  modelId: "T2T1",
  targetId: "hw",
  componentId: "core",
};

function gdbProfile() {
  return makeComponentDebugProfile({ name: "GDB Remote", template: "gdb-remote.json" });
}

function openocdProfile() {
  return makeComponentDebugProfile({
    name: "OpenOCD",
    template: "openocd.json",
    declarationIndex: 1,
  });
}

// ---------------------------------------------------------------------------
// Module-level mock access with call recording
// ---------------------------------------------------------------------------

const windowMock = vscode.window as unknown as {
  showQuickPick: (items: unknown[], options?: unknown) => Promise<unknown>;
  showErrorMessage: (message: string) => Promise<unknown>;
};
const debugMock = vscode.debug as unknown as {
  startDebugging: (folder: unknown, config: unknown) => Promise<boolean>;
};
const commandsMock = vscode.commands as unknown as {
  executeCommand: (command: string) => Promise<unknown>;
};

suite("executeDebugLaunch", () => {
  let originalQuickPick: typeof windowMock.showQuickPick;
  let originalErrorMessage: typeof windowMock.showErrorMessage;
  let originalStartDebugging: typeof debugMock.startDebugging;
  let originalExecuteCommand: typeof commandsMock.executeCommand;

  let errorMessages: string[];
  let startedConfigs: Record<string, unknown>[];
  let executedCommands: string[];
  let quickPickShown: boolean;

  setup(() => {
    originalQuickPick = windowMock.showQuickPick;
    originalErrorMessage = windowMock.showErrorMessage;
    originalStartDebugging = debugMock.startDebugging;
    originalExecuteCommand = commandsMock.executeCommand;

    errorMessages = [];
    startedConfigs = [];
    executedCommands = [];
    quickPickShown = false;

    windowMock.showErrorMessage = (message: string) => {
      errorMessages.push(message);
      return Promise.resolve(undefined);
    };
    debugMock.startDebugging = (_folder, config) => {
      startedConfigs.push(config as Record<string, unknown>);
      return Promise.resolve(true);
    };
    commandsMock.executeCommand = (command: string) => {
      executedCommands.push(command);
      return Promise.resolve(undefined);
    };
    windowMock.showQuickPick = () => {
      quickPickShown = true;
      return Promise.resolve(undefined);
    };
  });

  teardown(() => {
    windowMock.showQuickPick = originalQuickPick;
    windowMock.showErrorMessage = originalErrorMessage;
    debugMock.startDebugging = originalStartDebugging;
    commandsMock.executeCommand = originalExecuteCommand;
  });

  // -------------------------------------------------------------------------
  // Blocked states
  // -------------------------------------------------------------------------

  test("reports an error and does not launch when the manifest has debug issues", async () => {
    const state = makeDebugLoadedState([gdbProfile()], { hasDebugBlockingIssues: true });

    await executeDebugLaunch(WORKSPACE_FOLDER, state, BUILD_CONTEXT);

    assert.strictEqual(errorMessages.length, 1);
    assert.ok(errorMessages[0].includes("validation errors"), errorMessages[0]);
    assert.strictEqual(startedConfigs.length, 0);
  });

  test("reports an error when the active configuration does not resolve", async () => {
    const state = makeDebugLoadedState([gdbProfile()]);

    await executeDebugLaunch(WORKSPACE_FOLDER, state, {
      ...BUILD_CONTEXT,
      componentId: "MISSING",
    });

    assert.strictEqual(errorMessages.length, 1);
    assert.ok(errorMessages[0].includes("unknown component"), errorMessages[0]);
    assert.strictEqual(startedConfigs.length, 0);
  });

  test("reports an error when no debug profile matches the context", async () => {
    const state = makeDebugLoadedState([
      makeComponentDebugProfile({
        name: "GDB Remote",
        template: "gdb-remote.json",
        when: { type: "model", id: "T3W1" },
      }),
    ]);

    await executeDebugLaunch(WORKSPACE_FOLDER, state, BUILD_CONTEXT);

    assert.strictEqual(errorMessages.length, 1);
    assert.ok(errorMessages[0].includes("no debug profile matches"), errorMessages[0]);
    assert.strictEqual(startedConfigs.length, 0);
  });

  test("reports a no-match error when the component declares no debug profiles", async () => {
    const state = makeDebugLoadedState([]);

    await executeDebugLaunch(WORKSPACE_FOLDER, state, BUILD_CONTEXT);

    assert.strictEqual(errorMessages.length, 1);
    assert.ok(errorMessages[0].includes("no debug profile matches"), errorMessages[0]);
    assert.strictEqual(startedConfigs.length, 0);
  });

  // -------------------------------------------------------------------------
  // Launch flow
  // -------------------------------------------------------------------------

  test("launches the single matching profile without a QuickPick", async () => {
    const profile = gdbProfile();
    const state = makeDebugLoadedState([profile]);

    await executeDebugLaunch(WORKSPACE_FOLDER, state, BUILD_CONTEXT);

    assert.strictEqual(quickPickShown, false, "single match must not open a QuickPick");
    assert.strictEqual(errorMessages.length, 0);
    assert.deepStrictEqual(startedConfigs, [
      {
        type: "tbench",
        request: "launch",
        name: "Trezor Bench",
        tbenchMode: "default",
        tbenchProfileId: profile.id,
        tbenchContextKey: makeContextKey(BUILD_CONTEXT),
      },
    ]);
    assert.deepStrictEqual(executedCommands, ["workbench.view.debug"]);
  });

  test("opens a QuickPick for multiple matches and launches the chosen profile", async () => {
    const secondary = openocdProfile();
    const state = makeDebugLoadedState([gdbProfile(), secondary]);

    windowMock.showQuickPick = (items: unknown[]) => {
      quickPickShown = true;
      const typed = items as Array<{ label: string; profile: unknown }>;
      return Promise.resolve(typed.find((i) => i.label === "OpenOCD"));
    };

    await executeDebugLaunch(WORKSPACE_FOLDER, state, BUILD_CONTEXT);

    assert.strictEqual(quickPickShown, true);
    assert.strictEqual(startedConfigs.length, 1);
    assert.strictEqual(startedConfigs[0].tbenchMode, "profile");
    assert.strictEqual(startedConfigs[0].tbenchProfileId, secondary.id);
    assert.strictEqual(startedConfigs[0].name, "Trezor Bench: OpenOCD");
  });

  test("launches in default mode when the QuickPick choice is the default profile", async () => {
    const primary = gdbProfile();
    const state = makeDebugLoadedState([primary, openocdProfile()]);

    windowMock.showQuickPick = (items: unknown[]) => {
      const typed = items as Array<{ label: string; profile: unknown }>;
      return Promise.resolve(typed.find((i) => i.label === "GDB Remote"));
    };

    await executeDebugLaunch(WORKSPACE_FOLDER, state, BUILD_CONTEXT);

    assert.strictEqual(startedConfigs.length, 1);
    assert.strictEqual(startedConfigs[0].tbenchMode, "default");
    assert.strictEqual(startedConfigs[0].tbenchProfileId, primary.id);
    assert.strictEqual(startedConfigs[0].name, "Trezor Bench");
  });

  test("does nothing when the QuickPick is dismissed", async () => {
    const state = makeDebugLoadedState([gdbProfile(), openocdProfile()]);

    await executeDebugLaunch(WORKSPACE_FOLDER, state, BUILD_CONTEXT);

    assert.strictEqual(quickPickShown, true);
    assert.strictEqual(startedConfigs.length, 0);
    assert.strictEqual(errorMessages.length, 0);
    assert.strictEqual(executedCommands.length, 0);
  });

  test("reports an error when startDebugging fails to launch", async () => {
    const state = makeDebugLoadedState([gdbProfile()]);
    debugMock.startDebugging = (_folder, config) => {
      startedConfigs.push(config as Record<string, unknown>);
      return Promise.resolve(false);
    };

    await executeDebugLaunch(WORKSPACE_FOLDER, state, BUILD_CONTEXT);

    assert.strictEqual(startedConfigs.length, 1);
    assert.strictEqual(errorMessages.length, 1);
    assert.ok(errorMessages[0].includes("failed to start"), errorMessages[0]);
    assert.strictEqual(executedCommands.length, 0, "debug view must not open on failure");
  });
});
