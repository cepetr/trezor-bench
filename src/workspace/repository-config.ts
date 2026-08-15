/**
 * Root `tbench.toml` repository configuration: loading, validation, path
 * resolution, and watching for changes.
 */
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { parse as parseToml, TomlError } from "smol-toml";
import { errorMessage, isFileNotFound } from "../util/errors";
import { Debouncer } from "../util/debouncer";
import { watchFile } from "../util/file-watch";
import { FilePoller } from "../util/file-poller";

export const REPOSITORY_CONFIG_FILE = "tbench.toml";

export const REPOSITORY_PATH_DEFAULTS = {
  cargoWorkspace: "core/embed",
  debugTemplates: "core/embed/xtask/tf-tools/debug",
  buildArtifacts: "core/build-xtask/artifacts",
  manifest: "core/embed/xtask/tf-tools/manifest.yaml",
  presets: "core/embed/xtask",
} as const;

/** Resolved locations of the two preset TOML inputs for a workspace folder. */
export interface PresetUris {
  readonly shared: vscode.Uri;
  readonly user: vscode.Uri;
}

export interface ResolvedRepositoryConfig {
  readonly configUri: vscode.Uri;
  readonly cargoWorkspacePath: string;
  readonly debugTemplatesPath: string;
  readonly artifactsPath: string;
  readonly manifestUri: vscode.Uri;
  readonly presetUris: PresetUris;
}

export interface RepositoryConfigIssue {
  readonly code: "toml-parse" | "invalid-paths" | "invalid-path" | "read-error";
  readonly message: string;
  readonly range?: vscode.Range;
}

export type RepositoryConfigState =
  | {
      readonly status: "absent";
      readonly config: ResolvedRepositoryConfig;
    }
  | {
      readonly status: "loaded";
      readonly config: ResolvedRepositoryConfig;
      readonly loadedAt: Date;
    }
  | {
      readonly status: "invalid";
      readonly configUri: vscode.Uri;
      readonly validationIssues: ReadonlyArray<RepositoryConfigIssue>;
      readonly loadedAt: Date;
    };

const activeConfigs = new Map<string, ResolvedRepositoryConfig>();

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

function resolveConfig(
  workspaceFolder: vscode.WorkspaceFolder,
  configuredPaths: Readonly<Partial<Record<RepositoryPathKey, string>>>
): ResolvedRepositoryConfig {
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

  const configUri = vscode.Uri.joinPath(workspaceFolder.uri, REPOSITORY_CONFIG_FILE);
  const presetsPath = valueFor("presets");
  return {
    configUri,
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

export function setRepositoryConfig(
  workspaceFolder: vscode.WorkspaceFolder,
  config: ResolvedRepositoryConfig | undefined
): void {
  if (config) {
    activeConfigs.set(workspaceFolder.uri.fsPath, config);
  } else {
    activeConfigs.delete(workspaceFolder.uri.fsPath);
  }
}

export function getRepositoryConfig(
  workspaceFolder: vscode.WorkspaceFolder
): ResolvedRepositoryConfig {
  return activeConfigs.get(workspaceFolder.uri.fsPath) ??
    resolveConfig(workspaceFolder, {});
}

// ---------------------------------------------------------------------------
// Derived path accessors
// ---------------------------------------------------------------------------

/**
 * Returns the manifest URI for the given workspace folder, resolved from the
 * `[paths].manifest` entry in the root-level `tbench.toml`. Falls back to
 * `core/embed/xtask/tf-tools/manifest.yaml` under the workspace root.
 */
export function resolveManifestUri(
  workspaceFolder: vscode.WorkspaceFolder
): vscode.Uri {
  return getRepositoryConfig(workspaceFolder).manifestUri;
}

/**
 * Returns the cargo workspace directory for the given workspace folder,
 * resolved from the `[paths].cargo-workspace` entry in the root-level
 * `tbench.toml`. Defaults to `core/embed` under the workspace root; an empty
 * value resolves to the workspace root itself.
 */
export function resolveCargoWorkspacePath(
  workspaceFolder: vscode.WorkspaceFolder
): string {
  return getRepositoryConfig(workspaceFolder).cargoWorkspacePath;
}

/**
 * Returns the resolved absolute artifacts root path for the given workspace
 * folder, from the `[paths].build-artifacts` entry in the root-level
 * `tbench.toml`. Defaults to `core/build-xtask/artifacts` under the workspace
 * root; an empty value returns an empty string, which disables artifact-based
 * resolution.
 */
export function resolveArtifactsPath(
  workspaceFolder: vscode.WorkspaceFolder
): string {
  return getRepositoryConfig(workspaceFolder).artifactsPath;
}

/**
 * Returns the resolved absolute path to the debug templates directory for the
 * given workspace folder, from the `[paths].debug-templates` entry in the
 * root-level `tbench.toml`. Defaults to `core/embed/xtask/tf-tools/debug`
 * under the workspace root.
 */
export function resolveDebugTemplatesPath(
  workspaceFolder: vscode.WorkspaceFolder
): string {
  return getRepositoryConfig(workspaceFolder).debugTemplatesPath;
}

/**
 * Resolves both preset input URIs from the configured `xtask-presets` directory
 * by appending `presets.toml` and `user-presets.toml`.
 */
export function resolvePresetUris(workspaceFolder: vscode.WorkspaceFolder): PresetUris {
  return getRepositoryConfig(workspaceFolder).presetUris;
}

function issue(
  code: RepositoryConfigIssue["code"],
  message: string,
  range?: vscode.Range
): RepositoryConfigIssue {
  return { code, message, range };
}

function parseConfigurationPaths(source: string):
  | { readonly configuredPaths: Readonly<Partial<Record<RepositoryPathKey, string>>> }
  | { readonly validationIssues: ReadonlyArray<RepositoryConfigIssue> } {
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
  const validationIssues: RepositoryConfigIssue[] = [];
  for (const [tomlKey, configKey] of Object.entries(TOML_PATH_KEYS)) {
    const value = paths[tomlKey];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string") {
      validationIssues.push(issue("invalid-path", `"paths.${tomlKey}" must be a string.`));
      continue;
    }
    configuredPaths[configKey] = value;
  }

  return validationIssues.length > 0 ? { validationIssues } : { configuredPaths };
}

/**
 * Reads the root-level optional `tbench.toml` for one workspace folder.
 * VS Code variables are deliberately not expanded: values are repository data.
 */
export async function loadRepositoryConfig(
  workspaceFolder: vscode.WorkspaceFolder
): Promise<RepositoryConfigState> {
  const configUri = vscode.Uri.joinPath(workspaceFolder.uri, REPOSITORY_CONFIG_FILE);
  let source: string;
  try {
    source = await fs.readFile(configUri.fsPath, "utf-8");
  } catch (error) {
    if (isFileNotFound(error)) {
      return {
        status: "absent",
        config: resolveConfig(workspaceFolder, {}),
      };
    }
    return {
      status: "invalid",
      configUri,
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
      configUri,
      validationIssues: parsed.validationIssues,
      loadedAt: new Date(),
    };
  }

  return {
    status: "loaded",
    config: resolveConfig(workspaceFolder, parsed.configuredPaths),
    loadedAt: new Date(),
  };
}

const DEBOUNCE_MS = 300;
const POLL_INTERVAL_MS = 1_000;

export class RepositoryConfigService implements vscode.Disposable {
  private readonly onDidChangeStateEmitter = new vscode.EventEmitter<RepositoryConfigState>();
  private readonly configPath: string;
  private readonly debouncer = new Debouncer(DEBOUNCE_MS, () => {
    void this.reload();
  });
  /**
   * Fallback for hosts where VS Code watcher events are not dependable —
   * the integration harness, for one, runs with no workspace folder open,
   * where watcher events never arrive at all.
   */
  private readonly filePoller = new FilePoller(POLL_INTERVAL_MS, () =>
    this.debouncer.schedule()
  );
  private readonly disposables: vscode.Disposable[] = [];
  private currentState: RepositoryConfigState | undefined;

  readonly onDidChangeState = this.onDidChangeStateEmitter.event;

  constructor(private readonly workspaceFolder: vscode.WorkspaceFolder) {
    this.configPath = path.join(workspaceFolder.uri.fsPath, REPOSITORY_CONFIG_FILE);
    // Watch the folder with a wildcard rather than the exact filename:
    // tbench.toml is commonly absent, and a literal (non-glob) pattern for a
    // path outside any open workspace folder never establishes when the
    // target does not yet exist. Filtering by exact path keeps behavior
    // scoped to this one file.
    const pattern = new vscode.RelativePattern(workspaceFolder.uri, "*");
    this.disposables.push(
      watchFile(pattern, (changedUri) => {
        if (changedUri.fsPath === this.configPath) {
          this.debouncer.schedule();
        }
      })
    );
  }

  get state(): RepositoryConfigState | undefined {
    return this.currentState;
  }

  async start(): Promise<RepositoryConfigState> {
    const state = await this.reload();
    this.filePoller.start([this.configPath]);
    return state;
  }

  dispose(): void {
    this.debouncer.dispose();
    this.filePoller.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.onDidChangeStateEmitter.dispose();
  }

  private async reload(): Promise<RepositoryConfigState> {
    const state = await loadRepositoryConfig(this.workspaceFolder);
    this.currentState = state;
    this.filePoller.resync();
    this.onDidChangeStateEmitter.fire(state);
    return state;
  }
}