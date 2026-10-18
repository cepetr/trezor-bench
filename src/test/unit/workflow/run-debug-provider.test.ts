/**
 * Unit tests for `RunDebugConfigProvider`.
 *
 * Entry-set generation rules are covered by `debug-launch.test.ts`; these
 * tests cover the provider class itself: `provideDebugConfigurations`
 * dependency guards and delegation, and `resolveDebugConfiguration`
 * pass-through, failure paths, and proxy-to-real materialization.
 */
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { RunDebugConfigProvider } from "../../../debug/run-debug-provider";
import { disposeLogChannel } from "../../../observability/log-channel";
import { buildTbenchProxyDebugConfiguration } from "../../../commands/debug-launch";
import { BuildContext, ManifestStateLoaded } from "../../../manifest/manifest-types";
import {
  makeComponentDebugProfile,
  makeIntelliSenseLoadedState,
  debugLaunchValidTemplatesRoot,
} from "../workflow-test-helpers";

const CANCELLATION_TOKEN = {} as vscode.CancellationToken;

const BUILD_CONTEXT: BuildContext = {
  modelId: "T2T1",
  targetId: "hw",
  componentId: "core",
};

const GDB_PROFILE = makeComponentDebugProfile({ name: "GDB", template: "gdb-remote.json" });
const OPENOCD_PROFILE = makeComponentDebugProfile({
  name: "OpenOCD",
  template: "gdb-remote.json",
  declarationIndex: 1,
});

/** Loaded state whose core component resolves `firmware.elf` under model-t/. */
function makeManifest(
  profiles = [GDB_PROFILE],
  overrides: Partial<ManifestStateLoaded> = {}
): ManifestStateLoaded {
  return makeIntelliSenseLoadedState({
    targets: [{
      kind: "target",
      id: "hw",
      name: "Hardware",
      shortName: "HW",
      executableExtension: ".elf",
    } as ManifestStateLoaded["targets"][0]],
    components: [{
      kind: "component",
      id: "core",
      name: "Core",
      artifactName: "firmware",
      debug: profiles,
    } as ManifestStateLoaded["components"][0]],
    ...overrides,
  });
}

const SELECTED_FOLDER = {
  uri: vscode.Uri.file("/ws/trezor-firmware"),
  name: "trezor-firmware",
  index: 1,
} as vscode.WorkspaceFolder;

const OTHER_FOLDER = {
  uri: vscode.Uri.file("/ws/notes"),
  name: "notes",
  index: 0,
} as vscode.WorkspaceFolder;

function makeProvider(options: {
  manifest?: ManifestStateLoaded;
  buildContext?: BuildContext;
  artifactsRoot: string;
  /** Defaults to the selected folder; pass `null` for the released state. */
  folder?: vscode.WorkspaceFolder | null;
}): RunDebugConfigProvider {
  const folder = options.folder === undefined ? SELECTED_FOLDER : options.folder ?? undefined;
  return new RunDebugConfigProvider(
    () => options.manifest,
    () => options.buildContext,
    () => options.artifactsRoot,
    () => debugLaunchValidTemplatesRoot(),
    () => folder
  );
}

suite("RunDebugConfigProvider", () => {
  let tmpDir: string;
  let errorMessages: string[];
  const windowMock = vscode.window as unknown as {
    showErrorMessage: (message: string) => Promise<unknown>;
  };
  let originalErrorMessage: typeof windowMock.showErrorMessage;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-rdp-unit-"));
    fs.mkdirSync(path.join(tmpDir, "model-t"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");

    errorMessages = [];
    originalErrorMessage = windowMock.showErrorMessage;
    windowMock.showErrorMessage = (message: string) => {
      errorMessages.push(message);
      return Promise.resolve(undefined);
    };
  });

  teardown(() => {
    windowMock.showErrorMessage = originalErrorMessage;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function proxyConfig(mode: "default" | "profile" = "default", profile = GDB_PROFILE) {
    return buildTbenchProxyDebugConfiguration(BUILD_CONTEXT, profile, mode);
  }

  // -------------------------------------------------------------------------
  // provideDebugConfigurations
  // -------------------------------------------------------------------------

  test("provides no entries when the manifest is unavailable", () => {
    const provider = makeProvider({ buildContext: BUILD_CONTEXT, artifactsRoot: tmpDir });
    assert.deepStrictEqual(
      provider.provideDebugConfigurations(SELECTED_FOLDER, CANCELLATION_TOKEN),
      []
    );
  });

  test("provides no entries when no configuration is active", () => {
    const provider = makeProvider({ manifest: makeManifest(), artifactsRoot: tmpDir });
    assert.deepStrictEqual(
      provider.provideDebugConfigurations(SELECTED_FOLDER, CANCELLATION_TOKEN),
      []
    );
  });

  test("provides the generated entries for a valid state", () => {
    const provider = makeProvider({
      manifest: makeManifest(),
      buildContext: BUILD_CONTEXT,
      artifactsRoot: tmpDir,
    });

    const configs = provider.provideDebugConfigurations(SELECTED_FOLDER, CANCELLATION_TOKEN);
    assert.deepStrictEqual(configs, [proxyConfig()]);
  });

  test("provides no entries when the manifest has debug validation issues", () => {
    const provider = makeProvider({
      manifest: makeManifest([GDB_PROFILE], { hasDebugBlockingIssues: true }),
      buildContext: BUILD_CONTEXT,
      artifactsRoot: tmpDir,
    });
    assert.deepStrictEqual(
      provider.provideDebugConfigurations(SELECTED_FOLDER, CANCELLATION_TOKEN),
      []
    );
  });

  test("provides no entries when the configuration ids do not resolve", () => {
    const provider = makeProvider({
      manifest: makeManifest(),
      buildContext: { ...BUILD_CONTEXT, componentId: "MISSING" },
      artifactsRoot: tmpDir,
    });
    assert.deepStrictEqual(
      provider.provideDebugConfigurations(SELECTED_FOLDER, CANCELLATION_TOKEN),
      []
    );
  });

  test("provides no entries when no debug profile matches", () => {
    const provider = makeProvider({
      manifest: makeManifest([]),
      buildContext: BUILD_CONTEXT,
      artifactsRoot: tmpDir,
    });
    assert.deepStrictEqual(
      provider.provideDebugConfigurations(SELECTED_FOLDER, CANCELLATION_TOKEN),
      []
    );
  });

  test("provides no entries when the component declares no debug array", () => {
    const provider = makeProvider({
      manifest: makeIntelliSenseLoadedState(),
      buildContext: BUILD_CONTEXT,
      artifactsRoot: tmpDir,
    });
    assert.deepStrictEqual(
      provider.provideDebugConfigurations(SELECTED_FOLDER, CANCELLATION_TOKEN),
      []
    );
  });

  test("provides no entries when the executable artifact is absent", () => {
    fs.rmSync(path.join(tmpDir, "model-t", "firmware.elf"));
    const provider = makeProvider({
      manifest: makeManifest(),
      buildContext: BUILD_CONTEXT,
      artifactsRoot: tmpDir,
    });
    assert.deepStrictEqual(
      provider.provideDebugConfigurations(SELECTED_FOLDER, CANCELLATION_TOKEN),
      []
    );
  });

  // -------------------------------------------------------------------------
  // resolveDebugConfiguration — pass-through and failure paths
  // -------------------------------------------------------------------------

  test("passes non-tbench configurations through unchanged", () => {
    const provider = makeProvider({
      manifest: makeManifest(),
      buildContext: BUILD_CONTEXT,
      artifactsRoot: tmpDir,
    });
    const foreign = { type: "gdb", request: "launch", name: "external" };

    const resolved = provider.resolveDebugConfiguration(undefined, foreign, CANCELLATION_TOKEN);
    assert.strictEqual(resolved, foreign);
    assert.strictEqual(errorMessages.length, 0);
  });

  test("fails with an error when the manifest is unavailable", () => {
    const provider = makeProvider({ buildContext: BUILD_CONTEXT, artifactsRoot: tmpDir });

    const resolved = provider.resolveDebugConfiguration(undefined, proxyConfig(), CANCELLATION_TOKEN);
    assert.strictEqual(resolved, undefined);
    assert.strictEqual(errorMessages.length, 1);
    assert.ok(errorMessages[0].includes("manifest not loaded"), errorMessages[0]);
  });

  test("fails with an error when the entry was generated for a stale context", () => {
    const provider = makeProvider({
      manifest: makeManifest(),
      buildContext: { ...BUILD_CONTEXT, modelId: "T3W1" },
      artifactsRoot: tmpDir,
    });

    const resolved = provider.resolveDebugConfiguration(undefined, proxyConfig(), CANCELLATION_TOKEN);
    assert.strictEqual(resolved, undefined);
    assert.strictEqual(errorMessages.length, 1);
    assert.ok(errorMessages[0].includes("has changed"), errorMessages[0]);
  });

  test("fails with an error when the selected profile no longer exists", () => {
    const provider = makeProvider({
      manifest: makeManifest([OPENOCD_PROFILE]),
      buildContext: BUILD_CONTEXT,
      artifactsRoot: tmpDir,
    });

    const resolved = provider.resolveDebugConfiguration(
      undefined,
      proxyConfig("default", GDB_PROFILE),
      CANCELLATION_TOKEN
    );
    assert.strictEqual(resolved, undefined);
    assert.strictEqual(errorMessages.length, 1);
    assert.ok(errorMessages[0].includes("no longer available"), errorMessages[0]);
  });

  test("fails with an error when the proxy carries no profile id", () => {
    const provider = makeProvider({
      manifest: makeManifest(),
      buildContext: BUILD_CONTEXT,
      artifactsRoot: tmpDir,
    });
    const withoutProfileId: Record<string, unknown> = { ...proxyConfig() };
    delete withoutProfileId.tbenchProfileId;

    const resolved = provider.resolveDebugConfiguration(
      undefined,
      withoutProfileId as vscode.DebugConfiguration,
      CANCELLATION_TOKEN
    );
    assert.strictEqual(resolved, undefined);
    assert.strictEqual(errorMessages.length, 1);
    assert.ok(errorMessages[0].includes("no longer available"), errorMessages[0]);
  });

  test("fails with an error when materialization fails", () => {
    fs.rmSync(path.join(tmpDir, "model-t", "firmware.elf"));
    const provider = makeProvider({
      manifest: makeManifest(),
      buildContext: BUILD_CONTEXT,
      artifactsRoot: tmpDir,
    });

    const resolved = provider.resolveDebugConfiguration(undefined, proxyConfig(), CANCELLATION_TOKEN);
    assert.strictEqual(resolved, undefined);
    assert.strictEqual(errorMessages.length, 1);
  });

  // -------------------------------------------------------------------------
  // resolveDebugConfiguration — materialization
  // -------------------------------------------------------------------------

  test("materializes the real configuration with the canonical default name", () => {
    const provider = makeProvider({
      manifest: makeManifest(),
      buildContext: BUILD_CONTEXT,
      artifactsRoot: tmpDir,
    });

    const resolved = provider.resolveDebugConfiguration(
      undefined,
      proxyConfig("default"),
      CANCELLATION_TOKEN
    ) as vscode.DebugConfiguration;

    assert.ok(resolved, "expected a resolved configuration");
    assert.strictEqual(resolved.type, "gdb", "template type must replace the proxy type");
    assert.strictEqual(resolved.name, "Trezor Bench");
    assert.strictEqual(resolved.program, path.join(tmpDir, "model-t", "firmware.elf"));
    assert.strictEqual(resolved.cwd, "${workspaceFolder}", "non-tbench variables stay intact");
    assert.strictEqual(errorMessages.length, 0);
  });

  test("materializes profile-mode entries with the profile-specific name", () => {
    const provider = makeProvider({
      manifest: makeManifest(),
      buildContext: BUILD_CONTEXT,
      artifactsRoot: tmpDir,
    });

    const resolved = provider.resolveDebugConfiguration(
      undefined,
      proxyConfig("profile"),
      CANCELLATION_TOKEN
    ) as vscode.DebugConfiguration;

    assert.ok(resolved, "expected a resolved configuration");
    assert.strictEqual(resolved.name, "Trezor Bench: GDB");
  });
});

suite("RunDebugConfigProvider — selected folder scope", () => {
  let tmpDir: string;
  let errorMessages: string[];
  let logLines: string[];
  const windowMock = vscode.window as unknown as {
    showErrorMessage: (message: string) => Promise<unknown>;
    createOutputChannel: (name: string) => unknown;
  };
  let originalErrorMessage: typeof windowMock.showErrorMessage;
  let originalCreateChannel: typeof windowMock.createOutputChannel;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-rdp-folder-"));
    fs.mkdirSync(path.join(tmpDir, "model-t"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "model-t", "firmware.elf"), "");

    errorMessages = [];
    logLines = [];
    originalErrorMessage = windowMock.showErrorMessage;
    originalCreateChannel = windowMock.createOutputChannel;
    windowMock.showErrorMessage = (message: string) => {
      errorMessages.push(message);
      return Promise.resolve(undefined);
    };
    disposeLogChannel();
    windowMock.createOutputChannel = () => ({
      appendLine: (line: string) => logLines.push(line),
      show: () => {},
      dispose: () => {},
    });
  });

  teardown(() => {
    disposeLogChannel();
    windowMock.createOutputChannel = originalCreateChannel;
    windowMock.showErrorMessage = originalErrorMessage;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const proxy = () => buildTbenchProxyDebugConfiguration(BUILD_CONTEXT, GDB_PROFILE, "default");

  function provider(folder?: vscode.WorkspaceFolder | null): RunDebugConfigProvider {
    return makeProvider({
      manifest: makeManifest(),
      buildContext: BUILD_CONTEXT,
      artifactsRoot: tmpDir,
      folder,
    });
  }

  test("provides entries only for the selected folder", () => {
    const p = provider();
    assert.deepStrictEqual(p.provideDebugConfigurations(SELECTED_FOLDER, CANCELLATION_TOKEN), [proxy()]);
    assert.deepStrictEqual(p.provideDebugConfigurations(OTHER_FOLDER, CANCELLATION_TOKEN), []);
    assert.deepStrictEqual(p.provideDebugConfigurations(undefined, CANCELLATION_TOKEN), []);
  });

  test("provides no entries for any folder once released", () => {
    const p = provider(null);
    assert.deepStrictEqual(p.provideDebugConfigurations(SELECTED_FOLDER, CANCELLATION_TOKEN), []);
    assert.deepStrictEqual(p.provideDebugConfigurations(OTHER_FOLDER, CANCELLATION_TOKEN), []);
  });

  test("rejects a tbench configuration for another folder, logging and notifying", () => {
    const resolved = provider().resolveDebugConfiguration(OTHER_FOLDER, proxy(), CANCELLATION_TOKEN);

    assert.strictEqual(resolved, undefined);
    assert.ok(logLines.some((line) => line.includes("[PROVIDER] wrong-folder")), logLines.join("\n"));
    assert.strictEqual(errorMessages.length, 1);
    assert.ok(errorMessages[0].includes("trezor-firmware"));
  });

  test("resolves a tbench configuration for the selected folder", () => {
    const resolved = provider().resolveDebugConfiguration(SELECTED_FOLDER, proxy(), CANCELLATION_TOKEN);

    assert.ok(resolved);
    assert.strictEqual(errorMessages.length, 0);
  });

  test("rejects resolution while released, logging reload-required", () => {
    const resolved = provider(null).resolveDebugConfiguration(SELECTED_FOLDER, proxy(), CANCELLATION_TOKEN);

    assert.strictEqual(resolved, undefined);
    assert.ok(logLines.some((line) => line.includes("[PROVIDER] reload-required")), logLines.join("\n"));
    assert.strictEqual(errorMessages.length, 1);
    assert.ok(errorMessages[0].includes("Reload the window to continue."));
  });

  test("passes non-tbench configurations through untouched, even while released", () => {
    const foreign = { type: "gdb", request: "launch", name: "external" };

    assert.strictEqual(
      provider(null).resolveDebugConfiguration(OTHER_FOLDER, foreign, CANCELLATION_TOKEN),
      foreign
    );
    assert.strictEqual(errorMessages.length, 0);
  });
});
