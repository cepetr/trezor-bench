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

function makeProvider(options: {
  manifest?: ManifestStateLoaded;
  buildContext?: BuildContext;
  artifactsRoot: string;
}): RunDebugConfigProvider {
  return new RunDebugConfigProvider(
    () => options.manifest,
    () => options.buildContext,
    () => options.artifactsRoot,
    () => debugLaunchValidTemplatesRoot()
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
      provider.provideDebugConfigurations(undefined, CANCELLATION_TOKEN),
      []
    );
  });

  test("provides no entries when no configuration is active", () => {
    const provider = makeProvider({ manifest: makeManifest(), artifactsRoot: tmpDir });
    assert.deepStrictEqual(
      provider.provideDebugConfigurations(undefined, CANCELLATION_TOKEN),
      []
    );
  });

  test("provides the generated entries for a valid state", () => {
    const provider = makeProvider({
      manifest: makeManifest(),
      buildContext: BUILD_CONTEXT,
      artifactsRoot: tmpDir,
    });

    const configs = provider.provideDebugConfigurations(undefined, CANCELLATION_TOKEN);
    assert.deepStrictEqual(configs, [proxyConfig()]);
  });

  test("provides no entries when the manifest has debug validation issues", () => {
    const provider = makeProvider({
      manifest: makeManifest([GDB_PROFILE], { hasDebugBlockingIssues: true }),
      buildContext: BUILD_CONTEXT,
      artifactsRoot: tmpDir,
    });
    assert.deepStrictEqual(
      provider.provideDebugConfigurations(undefined, CANCELLATION_TOKEN),
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
      provider.provideDebugConfigurations(undefined, CANCELLATION_TOKEN),
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
      provider.provideDebugConfigurations(undefined, CANCELLATION_TOKEN),
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
      provider.provideDebugConfigurations(undefined, CANCELLATION_TOKEN),
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
      provider.provideDebugConfigurations(undefined, CANCELLATION_TOKEN),
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
