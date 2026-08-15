/**
 * Resolves the supported subset of VS Code `${variable}` references in
 * settings values.
 */
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

/** Matches `${name}` and `${name:argument}` tokens from the VS Code variables reference. */
const VARIABLE_RE = /\$\{([^}:]+)(?::([^}]*))?\}/g;

/**
 * Resolves VS Code variable references in a settings string.
 *
 * VS Code does not expand variables returned by `WorkspaceConfiguration.get()`.
 * This helper implements the subset used by tbench settings:
 * workspace folder, environment, config, user home, and cwd.
 *
 * Unrecognized or context-dependent variables are left unchanged. Replacement
 * is single-pass; substituted values are not re-expanded.
 */
export function resolveSettingsVariables(
  value: string,
  workspaceFolder: vscode.WorkspaceFolder
): string {
  return value.replace(VARIABLE_RE, (match, name: string, argument: string | undefined) => {
    const resolved = resolveVariable(name, argument ?? "", workspaceFolder);
    return resolved ?? match;
  });
}

/**
 * Recursively resolves variable references in string fields of arrays and objects.
 */
export function resolveSettingsVariablesDeep<T>(
  value: T,
  workspaceFolder: vscode.WorkspaceFolder
): T {
  if (typeof value === "string") {
    return resolveSettingsVariables(value, workspaceFolder) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveSettingsVariablesDeep(item, workspaceFolder)) as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const resolvedKey = resolveSettingsVariables(key, workspaceFolder);
      result[resolvedKey] = resolveSettingsVariablesDeep(nested, workspaceFolder);
    }
    return result as T;
  }
  return value;
}

function resolveVariable(
  name: string,
  argument: string,
  workspaceFolder: vscode.WorkspaceFolder
): string | undefined {
  switch (name) {
    case "workspaceFolder":
    case "workspaceRoot":
      return workspaceFolder.uri.fsPath;
    case "workspaceFolderBasename":
      return path.basename(workspaceFolder.uri.fsPath);
    case "userHome":
      return os.homedir();
    case "cwd":
      return workspaceFolder.uri.fsPath;
    case "env":
      return process.env[argument] ?? "";
    case "config":
      return resolveConfigVariable(argument, workspaceFolder);
    default:
      return undefined;
  }
}

function resolveConfigVariable(
  qualifiedKey: string,
  workspaceFolder: vscode.WorkspaceFolder
): string | undefined {
  const dot = qualifiedKey.indexOf(".");
  if (dot === -1) {
    return undefined;
  }
  const section = qualifiedKey.slice(0, dot);
  const key = qualifiedKey.slice(dot + 1);
  const cfg = vscode.workspace.getConfiguration(section, workspaceFolder.uri);
  const value = cfg.get<unknown>(key);
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
}
