/**
 * Unit tests for checkProviderReadiness: provider-readiness evaluation and warning transitions.
 *
 * Covers:
 *  - missing-provider warning when cpptools is not installed
 *  - wrong-provider warning when a different provider is configured
 *  - ready (none) state when cpptools is present and provider is unconfigured or set to tf-tools
 *  - lastWarningMessage content for each warning state
 *  - providerInstalled and providerConfigured flags for each state
 */

import * as assert from "assert";
import * as vscode from "vscode";
import {
  applyProviderSettingFix,
  PROVIDER_SETTING_FIX,
  CPPTOOLS_EXTENSION_ID,
} from "../../../intellisense/cpptools-provider";
import { checkProviderReadiness } from "../../../intellisense/intellisense-backend";
import { CLANGD_EXTENSION_ID } from "../../../intellisense/clangd-provider";

// ---------------------------------------------------------------------------
// Access the vscode mock so we can control extension and configuration state
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-require-imports
const vscodeMock = require("vscode");

// ---------------------------------------------------------------------------
// Helpers for controlling mock state
// ---------------------------------------------------------------------------

type GetExtensionFn = (id: string) => unknown;
type GetConfigurationFn = (section?: string) => { get: (key: string) => unknown };

let originalGetExtension: GetExtensionFn;
let originalGetConfiguration: GetConfigurationFn;
let originalExtensionsAll: unknown[];

function restoreExtensionMocks(): void {
  vscodeMock.extensions.getExtension = originalGetExtension;
  vscodeMock.extensions.all = originalExtensionsAll;
  vscodeMock.workspace.getConfiguration = originalGetConfiguration;
}

function stubExtensionMissing(): void {
  vscodeMock.extensions.getExtension = () => undefined;
  vscodeMock.extensions.all = [];
}

function makeCpptoolsExtensionStub(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    isActive: true,
    exports: {
      getApi: (_version: number) => ({
        registerCustomConfigurationProvider() { },
        notifyReady() { },
        didChangeCustomConfiguration() { },
        didChangeCustomBrowseConfiguration() { },
        dispose() { },
      }),
    },
    ...overrides,
  };
}

function stubExtensionInstalled(id = "ms-vscode.cpptools"): void {
  const extension = makeCpptoolsExtensionStub(id);
  vscodeMock.extensions.getExtension = (requestedId: string) =>
    requestedId === id ? extension : undefined;
  vscodeMock.extensions.all = [extension];
}

function stubExtensionInstalledWithUnsupportedApi(id = "ms-vscode.cpptools"): void {
  const extension = {
    id,
    isActive: true,
    exports: {
      getApi: () => {
        throw new RangeError("Invalid version");
      },
    },
  };
  vscodeMock.extensions.getExtension = (requestedId: string) =>
    requestedId === id ? extension : undefined;
  vscodeMock.extensions.all = [extension];
}

function stubExtensionInstalledButInactive(id = "ms-vscode.cpptools"): void {
  const extension = {
    id,
    isActive: false,
  };

  Object.defineProperty(extension, "exports", {
    get() {
      throw new Error(`Extension '${id}' is not known or not activated`);
    },
  });

  vscodeMock.extensions.getExtension = (requestedId: string) =>
    requestedId === id ? extension : undefined;
  vscodeMock.extensions.all = [extension];
}

function stubClangdExtensionInstalled(): void {
  const clangdExtension = { id: CLANGD_EXTENSION_ID, isActive: true };
  const existingGetExtension = vscodeMock.extensions.getExtension as GetExtensionFn;
  vscodeMock.extensions.getExtension = (id: string) => {
    if (id === CLANGD_EXTENSION_ID) {
      return clangdExtension;
    }
    return existingGetExtension(id);
  };
  if (!vscodeMock.extensions.all.some((ext: { id: string }) => ext.id === CLANGD_EXTENSION_ID)) {
    vscodeMock.extensions.all = [...vscodeMock.extensions.all, clangdExtension];
  }
}

function stubConfigurationProvider(value: string | undefined): void {
  vscodeMock.workspace.getConfiguration = () => ({
    get: (key: string) => (key === "default.configurationProvider" ? value : undefined),
  });
}

// ---------------------------------------------------------------------------
// Suite: missing-provider warning state
// ---------------------------------------------------------------------------

suite("checkProviderReadiness – missing-provider", () => {
  suiteSetup(() => {
    originalGetExtension = vscodeMock.extensions.getExtension as GetExtensionFn;
    originalExtensionsAll = vscodeMock.extensions.all;
    originalGetConfiguration = vscodeMock.workspace.getConfiguration as GetConfigurationFn;
  });

  suiteTeardown(() => {
    restoreExtensionMocks();
  });

  setup(() => {
    stubExtensionMissing();
    stubConfigurationProvider(undefined);
  });

  test("warningState is 'missing-provider' when cpptools is not installed", () => {
    const result = checkProviderReadiness();
    assert.strictEqual(result.warningState, "missing-provider");
  });

  test("providerInstalled is false when cpptools is absent", () => {
    const result = checkProviderReadiness();
    assert.strictEqual(result.providerInstalled, false);
  });

  test("providerConfigured is false when cpptools is absent", () => {
    const result = checkProviderReadiness();
    assert.strictEqual(result.providerConfigured, false);
  });

  test("lastWarningMessage is set for missing-provider", () => {
    const result = checkProviderReadiness();
    assert.ok(
      result.lastWarningMessage && result.lastWarningMessage.length > 0,
      "expected lastWarningMessage to be non-empty"
    );
  });

  test("lastWarningMessage mentions known IntelliSense backends", () => {
    const result = checkProviderReadiness();
    assert.ok(
      result.lastWarningMessage?.includes(CPPTOOLS_EXTENSION_ID),
      `expected message to mention '${CPPTOOLS_EXTENSION_ID}', got: ${result.lastWarningMessage}`
    );

    assert.ok(
      result.lastWarningMessage?.includes(CLANGD_EXTENSION_ID),
      `expected message to mention '${CLANGD_EXTENSION_ID}', got: ${result.lastWarningMessage}`
    );
  });

  test("warningState is 'missing-provider' when cpptools API is unsupported and clangd is absent", () => {
    stubExtensionInstalledWithUnsupportedApi();
    stubConfigurationProvider("cepetr.tf-tools");
    const result = checkProviderReadiness();
    assert.strictEqual(result.warningState, "missing-provider");
  });

  test("unsupported cpptools API message names cpptools and clangd when clangd is absent", () => {
    stubExtensionInstalledWithUnsupportedApi();
    stubConfigurationProvider("cepetr.tf-tools");
    const result = checkProviderReadiness();
    assert.strictEqual(result.warningState, "missing-provider");
    assert.ok(
      result.lastWarningMessage?.includes(CPPTOOLS_EXTENSION_ID),
      `expected unsupported-api message to mention ${CPPTOOLS_EXTENSION_ID}, got: ${result.lastWarningMessage}`
    );
    assert.ok(
      result.lastWarningMessage?.includes(CLANGD_EXTENSION_ID),
      `expected unsupported-api message to mention clangd, got: ${result.lastWarningMessage}`
    );
  });

  test("warningState is 'none' when cpptools API is unsupported but clangd is installed", () => {
    stubExtensionInstalledWithUnsupportedApi();
    stubClangdExtensionInstalled();
    stubConfigurationProvider("cepetr.tf-tools");
    const result = checkProviderReadiness();
    assert.strictEqual(result.warningState, "none");
    assert.strictEqual(result.providerInstalled, true);
    assert.strictEqual(result.providerConfigured, true);
  });
});

// ---------------------------------------------------------------------------
// Suite: wrong-provider warning state
// ---------------------------------------------------------------------------

suite("checkProviderReadiness – wrong-provider", () => {
  suiteSetup(() => {
    originalGetExtension = vscodeMock.extensions.getExtension as GetExtensionFn;
    originalExtensionsAll = vscodeMock.extensions.all;
    originalGetConfiguration = vscodeMock.workspace.getConfiguration as GetConfigurationFn;
  });

  suiteTeardown(() => {
    restoreExtensionMocks();
  });

  setup(() => {
    stubExtensionInstalled();
    stubConfigurationProvider("ms-vscode.cmake-tools");
  });

  test("warningState is 'wrong-provider' when another provider is configured", () => {
    const result = checkProviderReadiness();
    assert.strictEqual(result.warningState, "wrong-provider");
  });

  test("providerInstalled is true when cpptools is present", () => {
    const result = checkProviderReadiness();
    assert.strictEqual(result.providerInstalled, true);
  });

  test("providerConfigured is false when a different provider is active", () => {
    const result = checkProviderReadiness();
    assert.strictEqual(result.providerConfigured, false);
  });

  test("lastWarningMessage references the misconfigured provider id", () => {
    const result = checkProviderReadiness();
    assert.ok(
      result.lastWarningMessage?.includes("ms-vscode.cmake-tools"),
      `expected message to include the wrong provider id, got: ${result.lastWarningMessage}`
    );
  });

  test("lastWarningMessage is set for wrong-provider", () => {
    const result = checkProviderReadiness();
    assert.ok(
      result.lastWarningMessage && result.lastWarningMessage.length > 0,
      "expected lastWarningMessage to be non-empty"
    );
  });

  test("warningState is 'wrong-provider' when provider setting is undefined", () => {
    stubExtensionInstalled();
    stubConfigurationProvider(undefined);
    const result = checkProviderReadiness();
    assert.strictEqual(result.warningState, "wrong-provider");
  });

  test("warningState is 'wrong-provider' when provider setting is empty string", () => {
    stubExtensionInstalled();
    stubConfigurationProvider("");
    const result = checkProviderReadiness();
    assert.strictEqual(result.warningState, "wrong-provider");
  });
});

// ---------------------------------------------------------------------------
// Suite: ready state (warningState: "none")
// ---------------------------------------------------------------------------

suite("checkProviderReadiness – ready (none)", () => {
  suiteSetup(() => {
    originalGetExtension = vscodeMock.extensions.getExtension as GetExtensionFn;
    originalExtensionsAll = vscodeMock.extensions.all;
    originalGetConfiguration = vscodeMock.workspace.getConfiguration as GetConfigurationFn;
  });

  suiteTeardown(() => {
    restoreExtensionMocks();
  });

  test("warningState is 'none' when provider is set to cepetr.tf-tools", () => {
    stubExtensionInstalled();
    stubConfigurationProvider("cepetr.tf-tools");
    const result = checkProviderReadiness();
    assert.strictEqual(result.warningState, "none");
  });

  test("warningState is 'none' when provider is set to CEPETR.TF-TOOLS (case-insensitive)", () => {
    stubExtensionInstalled();
    stubConfigurationProvider("CEPETR.TF-TOOLS");
    const result = checkProviderReadiness();
    assert.strictEqual(result.warningState, "none");
  });

  test("providerInstalled is true when cpptools is present", () => {
    stubExtensionInstalled();
    stubConfigurationProvider(undefined);
    const result = checkProviderReadiness();
    assert.strictEqual(result.providerInstalled, true);
  });

  test("providerConfigured is true when prerequisites are satisfied", () => {
    stubExtensionInstalled();
    stubConfigurationProvider("cepetr.tf-tools");
    const result = checkProviderReadiness();
    assert.strictEqual(result.providerConfigured, true);
  });

  test("lastWarningMessage is undefined when warningState is 'none'", () => {
    stubExtensionInstalled();
    stubConfigurationProvider("cepetr.tf-tools");
    const result = checkProviderReadiness();
    assert.strictEqual(result.lastWarningMessage, undefined);
  });

  test("warningState stays 'none' when cpptools is installed but not yet activated", () => {
    stubExtensionInstalledButInactive();
    stubConfigurationProvider("cepetr.tf-tools");
    const result = checkProviderReadiness();
    assert.strictEqual(result.warningState, "none");
    assert.strictEqual(result.providerInstalled, true);
    assert.strictEqual(result.providerConfigured, true);
  });
});

// ---------------------------------------------------------------------------
// Suite: applyProviderSettingFix – workspace-setting write behaviour
// ---------------------------------------------------------------------------

suite("applyProviderSettingFix", () => {
  // Capture calls made to cfg.update
  interface UpdateCall {
    section: string;
    key: string;
    value: unknown;
    target: number;
  }

  let updateCalls: UpdateCall[];
  let getConfigSectionArg: string | undefined;
  let originalGetConfiguration: GetConfigurationFn;

  const fakeFolder: vscode.WorkspaceFolder = {
    uri: vscodeMock.Uri.file("/workspace"),
    name: "test-ws",
    index: 0,
  };

  suiteSetup(() => {
    originalGetConfiguration = vscodeMock.workspace.getConfiguration as GetConfigurationFn;
  });

  suiteTeardown(() => {
    vscodeMock.workspace.getConfiguration = originalGetConfiguration;
  });

  setup(() => {
    updateCalls = [];
    getConfigSectionArg = undefined;
    vscodeMock.workspace.getConfiguration = (section?: string) => {
      getConfigSectionArg = section;
      return {
        get: () => undefined,
        update: async (key: string, value: unknown, target: unknown) => {
          updateCalls.push({ section: section ?? "", key, value, target: target as number });
          return Promise.resolve();
        },
      };
    };
  });

  test("calls getConfiguration with 'C_Cpp' section", async () => {
    await applyProviderSettingFix(fakeFolder, () => { });
    assert.strictEqual(getConfigSectionArg, "C_Cpp");
  });

  test("updates PROVIDER_SETTING_FIX.key to PROVIDER_SETTING_FIX.correctValue", async () => {
    await applyProviderSettingFix(fakeFolder, () => { });
    assert.ok(updateCalls.length > 0, "expected at least one update call");
    const call = updateCalls[0];
    assert.strictEqual(call.key, PROVIDER_SETTING_FIX.key);
    assert.strictEqual(call.value, PROVIDER_SETTING_FIX.correctValue);
  });

  test("uses WorkspaceFolder configuration scope (target = 3)", async () => {
    await applyProviderSettingFix(fakeFolder, () => { });
    assert.strictEqual(updateCalls[0].target, vscodeMock.ConfigurationTarget.WorkspaceFolder);
  });

  test("invokes onFixed callback after the update", async () => {
    let fixedCalled = false;
    await applyProviderSettingFix(fakeFolder, () => {
      fixedCalled = true;
    });
    assert.strictEqual(fixedCalled, true);
  });

  test("invokes onFixed only once per call", async () => {
    let callCount = 0;
    await applyProviderSettingFix(fakeFolder, () => {
      callCount++;
    });
    assert.strictEqual(callCount, 1);
  });

  test("produces exactly one update call per invocation", async () => {
    await applyProviderSettingFix(fakeFolder, () => { });
    assert.strictEqual(updateCalls.length, 1);
  });
});
