/**
 * cpptools IntelliSense backend: readiness evaluation against the
 * custom-configuration API, the workspace provider-setting fix, and the
 * configuration provider that serves compile-commands payloads.
 */
import * as vscode from "vscode";
import { ProviderPayload, ProviderSettingFix } from "./intellisense-types";

// ---------------------------------------------------------------------------
// Microsoft C/C++ extension ID and provider constants
// ---------------------------------------------------------------------------

export const CPPTOOLS_EXTENSION_ID = "ms-vscode.cpptools";
const TF_TOOLS_PROVIDER_ID = "cepetr.tbench";
const CPPTOOLS_API_VERSION_LATEST = 7;

// ---------------------------------------------------------------------------
// Minimal cpptools custom configuration provider API types
//
// Defined inline to avoid a hard runtime dependency on the vscode-cpptools-api
// package. These mirror the subset of the published API that tbench consumes.
// ---------------------------------------------------------------------------

export interface CpptoolsSourceFileConfiguration {
  includePath: string[];
  defines: string[];
  intelliSenseMode?: string;
  standard?: string;
  forcedInclude?: string[];
  compilerPath?: string;
  compilerArgs?: string[];
}

export interface CpptoolsSourceFileConfigurationItem {
  uri: vscode.Uri;
  configuration: CpptoolsSourceFileConfiguration;
}

export interface CpptoolsWorkspaceBrowseConfiguration {
  browsePath: string[];
  compilerPath?: string;
  compilerArgs?: string[];
  windowsSdkVersion?: string;
}

/** Minimal interface matching the CppToolsApi extension export we consume. */
export interface CpptoolsApi {
  registerCustomConfigurationProvider(provider: CpptoolsCustomConfigurationProvider): void | Thenable<void>;
  notifyReady(provider: CpptoolsCustomConfigurationProvider): void;
  didChangeCustomConfiguration(provider: CpptoolsCustomConfigurationProvider): void;
  didChangeCustomBrowseConfiguration(provider: CpptoolsCustomConfigurationProvider): void;
  dispose(): void;
}

interface CpptoolsExtensionExports {
  getApi(version: number): CpptoolsApi;
}

/** Interface tbench implements to serve per-file IntelliSense configuration. */
export interface CpptoolsCustomConfigurationProvider {
  readonly name: string;
  readonly extensionId: string;
  canProvideConfiguration(uri: vscode.Uri): Thenable<boolean>;
  provideConfigurations(uris: vscode.Uri[]): Thenable<CpptoolsSourceFileConfigurationItem[]>;
  canProvideBrowseConfiguration(): Thenable<boolean>;
  provideBrowseConfiguration(): Thenable<CpptoolsWorkspaceBrowseConfiguration>;
  canProvideBrowseConfigurationsPerFolder(): Thenable<boolean>;
  provideFolderBrowseConfiguration(_uri: vscode.Uri): Thenable<CpptoolsWorkspaceBrowseConfiguration>;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Cpptools readiness evaluation
// ---------------------------------------------------------------------------

export type CpptoolsReadinessResult =
  | { readonly status: "ready" }
  | { readonly status: "absent" }
  | { readonly status: "unsupported"; readonly extensionId: string }
  | { readonly status: "wrong-provider"; readonly message: string };

/**
 * Evaluates whether cpptools can serve IntelliSense through tbench.
 *
 * Returns `unsupported` when a known C/C++ extension is installed but does not
 * expose the supported custom-configuration API.
 */
export function evaluateCpptoolsReadiness(): CpptoolsReadinessResult {
  const ext = vscode.extensions.getExtension(CPPTOOLS_EXTENSION_ID);

  if (!ext) {
    return { status: "absent" };
  }

  const apiState = getCpptoolsApiStateSafely(ext);
  if (apiState === "unsupported") {
    return { status: "unsupported", extensionId: ext.id };
  }

  const cfg = vscode.workspace.getConfiguration("C_Cpp");
  const configuredProvider: string | undefined = cfg.get<string>(
    "default.configurationProvider"
  );

  const isConfigured =
    typeof configuredProvider === "string" &&
    configuredProvider.toLowerCase() === TF_TOOLS_PROVIDER_ID.toLowerCase();

  if (!isConfigured) {
    const currentValue = configuredProvider ?? "(unset)";
    return {
      status: "wrong-provider",
      message:
        `IntelliSense integration unavailable: the workspace C_Cpp.default.configurationProvider is ` +
        `"${currentValue}" instead of Trezor Bench. ` +
        `Update the setting to "cepetr.tbench" or use the workspace fix to let tbench provide IntelliSense.`,
    };
  }

  return { status: "ready" };
}

// ---------------------------------------------------------------------------
// Provider workspace-setting fix
// ---------------------------------------------------------------------------

/** Descriptor for the one-step fix that writes the correct provider setting. */
export const PROVIDER_SETTING_FIX: ProviderSettingFix = {
  section: "C_Cpp",
  key: "default.configurationProvider",
  correctValue: TF_TOOLS_PROVIDER_ID,
};

/**
 * Writes `C_Cpp.default.configurationProvider = cepetr.tbench` to the
 * workspace folder settings (WorkspaceFolder scope), then calls `onFixed`.
 */
export async function applyProviderSettingFix(
  workspaceFolder: vscode.WorkspaceFolder,
  onFixed: () => void
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("C_Cpp", workspaceFolder.uri);
  await cfg.update(
    "default.configurationProvider",
    TF_TOOLS_PROVIDER_ID,
    vscode.ConfigurationTarget.WorkspaceFolder
  );
  onFixed();
}

// ---------------------------------------------------------------------------
// Cpptools backend
// ---------------------------------------------------------------------------

/**
 * Implements the cpptools `CustomConfigurationProvider` interface.
 *
 * The backend:
 *  - Registers with the cpptools API on first `activate()` call.
 *  - Serves per-file `SourceFileConfiguration` objects from the latest
 *    parsed `ProviderPayload`.
 *  - Returns the browse-configuration snapshot from the latest payload.
 *  - Accepts an injected `apiAccessor` factory for test injection.
 */
export class CpptoolsBackend implements CpptoolsCustomConfigurationProvider {
  readonly name = "Trezor Bench";
  readonly extensionId = TF_TOOLS_PROVIDER_ID;

  private _cpptoolsApi: CpptoolsApi | undefined;
  private _payload: ProviderPayload | undefined;
  private _activationPromise: Promise<void> | undefined;
  private readonly _apiAccessor: () => CpptoolsApi | Promise<CpptoolsApi | undefined> | undefined;

  /**
   * @param apiAccessor  Optional factory used to get the cpptools API.
   *   Defaults to reading the export from the installed cpptools extension.
   *   Tests can inject a null or stub factory.
   */
  constructor(apiAccessor?: () => CpptoolsApi | Promise<CpptoolsApi | undefined> | undefined) {
    this._apiAccessor = apiAccessor ?? defaultApiAccessor;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Attempts to register with cpptools. Safe to call multiple times;
   * registers only once per backend instance.
   */
  async activate(): Promise<void> {
    if (this._cpptoolsApi) {
      return;
    }
    if (this._activationPromise) {
      return this._activationPromise;
    }

    this._activationPromise = (async () => {
      let api: CpptoolsApi | undefined;
      try {
        api = await this._apiAccessor();
      } catch {
        return;
      }
      if (!api) {
        return;
      }
      try {
        await api.registerCustomConfigurationProvider(this);
        this._cpptoolsApi = api;

        // If payload was prepared before registration completed, replay it so
        // cpptools immediately re-queries the current configuration.
        if (this._payload) {
          this._cpptoolsApi.notifyReady(this);
          this._cpptoolsApi.didChangeCustomConfiguration(this);
          this._cpptoolsApi.didChangeCustomBrowseConfiguration(this);
        }
      } catch {
        // cpptools API may not be available in some VS Code versions — ignore.
      } finally {
        this._activationPromise = undefined;
      }
    })();

    return this._activationPromise;
  }

  // ---------------------------------------------------------------------------
  // Provider state updates
  // ---------------------------------------------------------------------------

  /**
   * Applies a new parsed payload and notifies cpptools to re-query configurations.
   */
  applyPayload(payload: ProviderPayload): void {
    this._payload = payload;
    if (this._cpptoolsApi) {
      this._cpptoolsApi.notifyReady(this);
      this._cpptoolsApi.didChangeCustomConfiguration(this);
      this._cpptoolsApi.didChangeCustomBrowseConfiguration(this);
    }
  }

  /**
   * Clears the active payload and notifies cpptools that no configurations are available.
   */
  clearPayload(): void {
    this._payload = undefined;
    if (this._cpptoolsApi) {
      this._cpptoolsApi.didChangeCustomConfiguration(this);
      this._cpptoolsApi.didChangeCustomBrowseConfiguration(this);
    }
  }

  getLastPayload(): ProviderPayload | undefined {
    return this._payload;
  }

  // ---------------------------------------------------------------------------
  // CpptoolsCustomConfigurationProvider implementation
  // ---------------------------------------------------------------------------

  async canProvideConfiguration(uri: vscode.Uri): Promise<boolean> {
    const payload = this._payload;
    if (!payload) {
      return false;
    }

    // Only claim files that have an indexed compile entry. Headers must fall
    // back to the browse configuration, otherwise cpptools gets no config at all.
    return payload.entriesByFile.has(uri.fsPath);
  }

  async provideConfigurations(
    uris: vscode.Uri[]
  ): Promise<CpptoolsSourceFileConfigurationItem[]> {
    const payload = this._payload;
    if (!payload) {
      return [];
    }

    return uris.flatMap((uri) => {
      const entry = payload.entriesByFile.get(uri.fsPath);
      if (!entry) {
        return [];
      }
      const config: CpptoolsSourceFileConfiguration = {
        includePath: entry.includePaths.slice(),
        defines: entry.defines.slice(),
        intelliSenseMode: resolveIntelliSenseMode(entry.compilerPath, entry.languageFamily),
        standard: entry.standard,
        forcedInclude: entry.forcedIncludes.slice(),
        compilerPath: entry.compilerPath || undefined,
        compilerArgs: entry.arguments.slice(),
      };
      return [{ uri, configuration: config }];
    });
  }

  async canProvideBrowseConfiguration(): Promise<boolean> {
    return this._payload !== undefined;
  }

  async provideBrowseConfiguration(): Promise<CpptoolsWorkspaceBrowseConfiguration> {
    const snap = this._payload?.browseSnapshot;
    return {
      browsePath: snap?.browsePaths.slice() ?? [],
      compilerPath: snap?.compilerPath,
      compilerArgs: snap?.compilerArgs.slice() ?? [],
    };
  }

  async canProvideBrowseConfigurationsPerFolder(): Promise<boolean> {
    return false;
  }

  async provideFolderBrowseConfiguration(
    _uri: vscode.Uri
  ): Promise<CpptoolsWorkspaceBrowseConfiguration> {
    return { browsePath: [] };
  }

  dispose(): void {
    this._cpptoolsApi?.dispose();
    this._cpptoolsApi = undefined;
    this._payload = undefined;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function defaultApiAccessor(): Promise<CpptoolsApi | undefined> {
  const ext = vscode.extensions.getExtension<unknown>(CPPTOOLS_EXTENSION_ID);
  if (!ext) {
    return undefined;
  }

  let exportsObject: unknown;
  if (!ext.isActive) {
    try {
      exportsObject = await ext.activate();
    } catch {
      return undefined;
    }
  } else {
    exportsObject = ext.exports;
  }

  if (isCpptoolsExtensionExports(exportsObject)) {
    try {
      return exportsObject.getApi(CPPTOOLS_API_VERSION_LATEST);
    } catch {
      return undefined;
    }
  }

  if (isCpptoolsApi(exportsObject)) {
    return exportsObject;
  }

  return undefined;
}

function isCpptoolsExtensionExports(value: unknown): value is CpptoolsExtensionExports {
  return !!value && typeof (value as CpptoolsExtensionExports).getApi === "function";
}

function isCpptoolsApi(value: unknown): value is CpptoolsApi {
  return (
    !!value &&
    typeof (value as CpptoolsApi).registerCustomConfigurationProvider === "function" &&
    typeof (value as CpptoolsApi).didChangeCustomConfiguration === "function" &&
    typeof (value as CpptoolsApi).didChangeCustomBrowseConfiguration === "function"
  );
}

function getCpptoolsApiState(exportsObject: unknown): "supported" | "unsupported" | "legacy" {
  if (isCpptoolsExtensionExports(exportsObject)) {
    try {
      const api = exportsObject.getApi(CPPTOOLS_API_VERSION_LATEST);
      return isCpptoolsApi(api) ? "supported" : "unsupported";
    } catch {
      return "unsupported";
    }
  }

  if (isCpptoolsApi(exportsObject)) {
    return "legacy";
  }

  return "unsupported";
}

function getCpptoolsApiStateSafely(
  extension: vscode.Extension<unknown>
): "supported" | "unsupported" | "legacy" | "inactive" {
  if (!extension.isActive) {
    return "inactive";
  }

  let exportsObject: unknown;
  try {
    exportsObject = extension.exports;
  } catch {
    return "inactive";
  }

  return getCpptoolsApiState(exportsObject);
}

/**
 * Maps a compiler executable name and language family to the closest
 * VS Code IntelliSense mode string.
 */
function resolveIntelliSenseMode(
  compilerPath: string,
  languageFamily: "c" | "cpp"
): string {
  const name = compilerPath.toLowerCase();

  if (name.includes("clang")) {
    return languageFamily === "cpp" ? "clang-cpp" : "clang-c";
  }
  if (name.includes("cl.exe") || name.includes("msvc")) {
    return languageFamily === "cpp" ? "msvc-cpp" : "msvc-c";
  }
  // Default: GCC / arm-none-eabi-gcc etc.
  return languageFamily === "cpp" ? "gcc-cpp" : "gcc-c";
}

