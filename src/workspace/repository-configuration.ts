/**
 * Root `tbench.toml` repository configuration: loading, validation, path
 * resolution, and watching for changes.
 */
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as fsNative from "fs";
import * as path from "path";
import { parse as parseToml, TomlError } from "smol-toml";
import { errorMessage, isFileNotFound } from "../util/errors";
import { Debouncer } from "../util/debouncer";

export const REPOSITORY_CONFIGURATION_FILE = "tbench.toml";

export const REPOSITORY_PATH_DEFAULTS = {
  cargoWorkspace: "core/embed",
  debugTemplates: "core/embed/xtask/tf-tools/debug",
  buildArtifacts: "core/build-xtask/artifacts",
  manifest: "core/embed/xtask/tf-tools/manifest.yaml",
  presets: "core/embed/xtask",
} as const;

export interface ResolvedRepositoryConfiguration {
  readonly configurationUri: vscode.Uri;
  readonly cargoWorkspacePath: string;
  readonly debugTemplatesPath: string;
  readonly artifactsPath: string;
  readonly manifestUri: vscode.Uri;
  readonly presetUris: {
    readonly shared: vscode.Uri;
    readonly user: vscode.Uri;
  };
}

export interface RepositoryConfigurationIssue {
  readonly code: "toml-parse" | "invalid-paths" | "invalid-path" | "read-error";
  readonly message: string;
  readonly range?: vscode.Range;
}

export type RepositoryConfigurationState =
  | {
      readonly status: "absent";
      readonly configuration: ResolvedRepositoryConfiguration;
    }
  | {
      readonly status: "loaded";
      readonly configuration: ResolvedRepositoryConfiguration;
      readonly loadedAt: Date;
    }
  | {
      readonly status: "invalid";
      readonly configurationUri: vscode.Uri;
      readonly validationIssues: ReadonlyArray<RepositoryConfigurationIssue>;
      readonly loadedAt: Date;
    };

const activeConfigurations = new Map<string, ResolvedRepositoryConfiguration>();

type RepositoryPathKey = keyof typeof REPOSITORY_PATH_DEFAULTS;

const TOML_PATH_KEYS: Readonly<Record<string, RepositoryPathKey>> = {
  "cargo-workspace": "cargoWorkspace",
  "debug-templates": "debugTemplates",
  "build-artifacts": "buildArtifacts",
  manifest: "manifest",
  "xtask-presets": "presets",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolvePath(workspaceFolder: vscode.WorkspaceFolder, value: string): string {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(workspaceFolder.uri.fsPath, value);
}

function resolveConfiguration(
  workspaceFolder: vscode.WorkspaceFolder,
  configuredPaths: Readonly<Partial<Record<RepositoryPathKey, string>>>
): ResolvedRepositoryConfiguration {
  const valueFor = (key: RepositoryPathKey): string => {
    const configuredValue = configuredPaths[key];
    if (configuredValue === undefined) {
      return resolvePath(workspaceFolder, REPOSITORY_PATH_DEFAULTS[key]);
    }
    const value = configuredValue.trim();
    if (!value) {
      if (key === "cargoWorkspace") {
        return workspaceFolder.uri.fsPath;
      }
      if (key === "buildArtifacts") {
        return "";
      }
      return resolvePath(workspaceFolder, REPOSITORY_PATH_DEFAULTS[key]);
    }
    return resolvePath(workspaceFolder, value);
  };

  const configurationUri = vscode.Uri.joinPath(workspaceFolder.uri, REPOSITORY_CONFIGURATION_FILE);
  const presetsPath = valueFor("presets");
  return {
    configurationUri,
    cargoWorkspacePath: valueFor("cargoWorkspace"),
    debugTemplatesPath: valueFor("debugTemplates"),
    artifactsPath: valueFor("buildArtifacts"),
    manifestUri: vscode.Uri.file(valueFor("manifest")),
    presetUris: {
      shared: vscode.Uri.file(path.join(presetsPath, "presets.toml")),
      user: vscode.Uri.file(path.join(presetsPath, "user-presets.toml")),
    },
  };
}

export function setRepositoryConfiguration(
  workspaceFolder: vscode.WorkspaceFolder,
  configuration: ResolvedRepositoryConfiguration | undefined
): void {
  if (configuration) {
    activeConfigurations.set(workspaceFolder.uri.fsPath, configuration);
  } else {
    activeConfigurations.delete(workspaceFolder.uri.fsPath);
  }
}

export function getRepositoryConfiguration(
  workspaceFolder: vscode.WorkspaceFolder
): ResolvedRepositoryConfiguration {
  return activeConfigurations.get(workspaceFolder.uri.fsPath) ??
    resolveConfiguration(workspaceFolder, {});
}

function issue(
  code: RepositoryConfigurationIssue["code"],
  message: string,
  range?: vscode.Range
): RepositoryConfigurationIssue {
  return { code, message, range };
}

function parseConfigurationPaths(source: string):
  | { readonly configuredPaths: Readonly<Partial<Record<RepositoryPathKey, string>>> }
  | { readonly validationIssues: ReadonlyArray<RepositoryConfigurationIssue> } {
  let parsed: unknown;
  try {
    parsed = parseToml(source);
  } catch (error) {
    if (error instanceof TomlError) {
      const position = new vscode.Position(
        Math.max(0, error.line - 1),
        Math.max(0, error.column - 1)
      );
      return {
        validationIssues: [issue("toml-parse", error.message, new vscode.Range(position, position))],
      };
    }
    return {
      validationIssues: [issue("toml-parse", errorMessage(error))],
    };
  }

  if (!isPlainObject(parsed)) {
    return { validationIssues: [issue("invalid-paths", "The TOML document must be a table.")] };
  }

  const paths = parsed.paths;
  if (paths === undefined) {
    return { configuredPaths: {} };
  }
  if (!isPlainObject(paths)) {
    return { validationIssues: [issue("invalid-paths", '"paths" must be a table.')] };
  }

  const configuredPaths: Partial<Record<RepositoryPathKey, string>> = {};
  const validationIssues: RepositoryConfigurationIssue[] = [];
  for (const [tomlKey, configurationKey] of Object.entries(TOML_PATH_KEYS)) {
    const value = paths[tomlKey];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string") {
      validationIssues.push(issue("invalid-path", `"paths.${tomlKey}" must be a string.`));
      continue;
    }
    configuredPaths[configurationKey] = value;
  }

  return validationIssues.length > 0 ? { validationIssues } : { configuredPaths };
}

/**
 * Reads the root-level optional `tbench.toml` for one workspace folder.
 * VS Code variables are deliberately not expanded: values are repository data.
 */
export async function loadRepositoryConfiguration(
  workspaceFolder: vscode.WorkspaceFolder
): Promise<RepositoryConfigurationState> {
  const configurationUri = vscode.Uri.joinPath(workspaceFolder.uri, REPOSITORY_CONFIGURATION_FILE);
  let source: string;
  try {
    source = await fs.readFile(configurationUri.fsPath, "utf-8");
  } catch (error) {
    if (isFileNotFound(error)) {
      return {
        status: "absent",
        configuration: resolveConfiguration(workspaceFolder, {}),
      };
    }
    return {
      status: "invalid",
      configurationUri,
      validationIssues: [
        issue("read-error", `Could not read repository configuration: ${errorMessage(error)}`),
      ],
      loadedAt: new Date(),
    };
  }

  const parsed = parseConfigurationPaths(source);
  if ("validationIssues" in parsed) {
    return {
      status: "invalid",
      configurationUri,
      validationIssues: parsed.validationIssues,
      loadedAt: new Date(),
    };
  }

  return {
    status: "loaded",
    configuration: resolveConfiguration(workspaceFolder, parsed.configuredPaths),
    loadedAt: new Date(),
  };
}

export class RepositoryConfigurationService implements vscode.Disposable {
  private readonly onDidChangeStateEmitter = new vscode.EventEmitter<RepositoryConfigurationState>();
  private readonly watcher: fsNative.FSWatcher;
  private readonly configurationPath: string;
  private readonly debouncer = new Debouncer(100, () => {
    void this.reload();
  });
  private currentState: RepositoryConfigurationState | undefined;

  readonly onDidChangeState = this.onDidChangeStateEmitter.event;

  constructor(private readonly workspaceFolder: vscode.WorkspaceFolder) {
    this.configurationPath = path.join(workspaceFolder.uri.fsPath, REPOSITORY_CONFIGURATION_FILE);
    this.watcher = fsNative.watch(workspaceFolder.uri.fsPath, (_event, fileName) => {
      if (fileName?.toString() === REPOSITORY_CONFIGURATION_FILE) {
        this.debouncer.schedule();
      }
    });
    fsNative.watchFile(this.configurationPath, { interval: 100, persistent: false }, () => {
      this.debouncer.schedule();
    });
  }

  get state(): RepositoryConfigurationState | undefined {
    return this.currentState;
  }

  async start(): Promise<RepositoryConfigurationState> {
    return this.reload();
  }

  dispose(): void {
    this.debouncer.dispose();
    this.watcher.close();
    fsNative.unwatchFile(this.configurationPath);
    this.onDidChangeStateEmitter.dispose();
  }

  private async reload(): Promise<RepositoryConfigurationState> {
    const state = await loadRepositoryConfiguration(this.workspaceFolder);
    this.currentState = state;
    this.onDidChangeStateEmitter.fire(state);
    return state;
  }
}