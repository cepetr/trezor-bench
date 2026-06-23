import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

/** Matches `${name}` and `${name:argument}` tokens from the VS Code variables reference. */
const VARIABLE_RE = /\$\{([^}:]+)(?::([^}]*))?\}/g;

/**
 * Resolves VS Code variable references in a configuration string.
 *
 * VS Code does not expand variables returned by `WorkspaceConfiguration.get()`.
 * This helper implements the subset used by tf-tools settings:
 * workspace folder, environment, config, path separator, user home, exec path,
 * cwd, and active-editor file variables when an editor is open.
 *
 * Unrecognized or context-dependent variables that cannot be resolved are left
 * unchanged. Replacement is single-pass; substituted values are not re-expanded.
 */
export function resolveConfigurationVariables(
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
export function resolveConfigurationVariablesDeep<T>(
  value: T,
  workspaceFolder: vscode.WorkspaceFolder
): T {
  if (typeof value === "string") {
    return resolveConfigurationVariables(value, workspaceFolder) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveConfigurationVariablesDeep(item, workspaceFolder)) as T;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const resolvedKey = resolveConfigurationVariables(key, workspaceFolder);
      result[resolvedKey] = resolveConfigurationVariablesDeep(nested, workspaceFolder);
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
    case "pathSeparator":
      return path.sep;
    case "userHome":
      return os.homedir();
    case "execPath":
      return process.execPath;
    case "cwd":
      return workspaceFolder.uri.fsPath;
    case "env":
      return process.env[argument] ?? "";
    case "config":
      return resolveConfigVariable(argument, workspaceFolder);
    default:
      return resolveEditorVariable(name, workspaceFolder);
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

function resolveEditorVariable(
  name: string,
  _workspaceFolder: vscode.WorkspaceFolder
): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const filePath = editor.document.uri.fsPath;
  const parsed = path.parse(filePath);

  switch (name) {
    case "file":
      return filePath;
    case "fileDirname":
      return parsed.dir;
    case "fileBasename":
      return parsed.base;
    case "fileBasenameNoExtension":
      return parsed.name;
    case "fileExtname":
      return parsed.ext;
    case "relativeFile":
      return vscode.workspace.asRelativePath(editor.document.uri, false);
    case "relativeFileDirname": {
      const relative = vscode.workspace.asRelativePath(editor.document.uri, false);
      return path.dirname(relative);
    }
    case "fileWorkspaceFolder": {
      const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
      return folder?.uri.fsPath;
    }
    case "lineNumber":
      return String(editor.selection.active.line + 1);
    case "selectedText":
      return editor.document.getText(editor.selection);
    default:
      return undefined;
  }
}
