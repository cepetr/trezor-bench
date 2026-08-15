/**
 * clangd IntelliSense backend adapter: maintains the managed `.tbench`
 * compile-commands link and `.clangd` configuration, and restarts clangd
 * when the database changes.
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { logIntelliSense } from "../observability/log-channel";
import { isFileNotFound } from "../util/errors";

// ---------------------------------------------------------------------------
// clangd extension constants
// ---------------------------------------------------------------------------

export const CLANGD_EXTENSION_ID = "llvm-vs-code-extensions.vscode-clangd";
export const CLANGD_COMPILE_COMMANDS_DIR_NAME = ".tbench";
export const CLANGD_COMPILE_COMMANDS_LINK_NAME = "compile_commands.json";
const TF_TOOLS_CLANGD_MARKER = "# Managed by Trezor Bench (tbench).";

export type ClangdRestartCommand = () => Promise<void>;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function getClangdCompileCommandsDirPath(
  workspaceFolder: vscode.WorkspaceFolder
): string {
  return path.join(workspaceFolder.uri.fsPath, CLANGD_COMPILE_COMMANDS_DIR_NAME);
}

export function getClangdCompileCommandsLinkPath(
  workspaceFolder: vscode.WorkspaceFolder
): string {
  return path.join(
    getClangdCompileCommandsDirPath(workspaceFolder),
    CLANGD_COMPILE_COMMANDS_LINK_NAME
  );
}

export function getWorkspaceClangdConfigPath(
  workspaceFolder: vscode.WorkspaceFolder
): string {
  return path.join(workspaceFolder.uri.fsPath, ".clangd");
}

export function buildTbenchClangdConfig(): string {
  return `${TF_TOOLS_CLANGD_MARKER}
CompileFlags:
  CompilationDatabase: ${CLANGD_COMPILE_COMMANDS_DIR_NAME}
`;
}

export function isClangdExtensionInstalled(): boolean {
  return vscode.extensions.getExtension(CLANGD_EXTENSION_ID) !== undefined;
}

// ---------------------------------------------------------------------------
// clangd provider adapter
// ---------------------------------------------------------------------------

/**
 * Points clangd at the active compile database by symlinking it to a stable
 * workspace path and restarting the language server.
 */
export class ClangdProviderAdapter {
  private _linkedArtifactPath: string | undefined;

  constructor(
    private readonly _restartClangd: ClangdRestartCommand = defaultRestartClangd
  ) {}

  getLinkedArtifactPath(): string | undefined {
    return this._linkedArtifactPath;
  }

  /**
   * Whether a tbench-managed compile database link exists on disk for the
   * workspace. Uses `lstat` so a dangling symlink (target artifact deleted)
   * still counts, and so a stale link left by a previous session is detected
   * even before `applyArtifact` records an in-memory path.
   */
  hasManagedCompileDatabase(workspaceFolder: vscode.WorkspaceFolder): boolean {
    try {
      const stat = fs.lstatSync(getClangdCompileCommandsLinkPath(workspaceFolder));
      return stat.isSymbolicLink();
    } catch {
      return false;
    }
  }

  async applyArtifact(
    workspaceFolder: vscode.WorkspaceFolder,
    artifactPath: string
  ): Promise<void> {
    ensureClangdCompilationDatabaseConfig(workspaceFolder);
    updateCompileCommandsSymlink(workspaceFolder, artifactPath);
    await this._restartClangd();
    this._linkedArtifactPath = artifactPath;
    logIntelliSense(`Applied clangd compile database: ${artifactPath}`);
  }

  async clear(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
    removeCompileCommandsSymlink(workspaceFolder);
    this._linkedArtifactPath = undefined;
    await this._restartClangd();
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function defaultRestartClangd(): Promise<void> {
  try {
    await vscode.commands.executeCommand("clangd.restart");
  } catch {
    // clangd extension may not be active yet — ignore.
  }
}

function ensureClangdCompilationDatabaseConfig(
  workspaceFolder: vscode.WorkspaceFolder
): void {
  const clangdPath = getWorkspaceClangdConfigPath(workspaceFolder);
  const desiredConfig = buildTbenchClangdConfig();

  if (!fs.existsSync(clangdPath)) {
    fs.writeFileSync(clangdPath, desiredConfig, "utf-8");
    return;
  }

  const existing = fs.readFileSync(clangdPath, "utf-8");
  if (existing.includes(TF_TOOLS_CLANGD_MARKER)) {
    if (existing !== desiredConfig) {
      fs.writeFileSync(clangdPath, desiredConfig, "utf-8");
    }
    return;
  }

  if (hasCompilationDatabaseReference(existing, CLANGD_COMPILE_COMMANDS_DIR_NAME)) {
    return;
  }

  logIntelliSense(
    "[WARN] Workspace .clangd exists without a tbench CompilationDatabase entry. " +
      `clangd may not discover ${CLANGD_COMPILE_COMMANDS_DIR_NAME}/compile_commands.json unless configured elsewhere.`
  );
}

function hasCompilationDatabaseReference(config: string, directory: string): boolean {
  const pattern = new RegExp(
    `CompilationDatabase:\\s*(?:\\./)?${directory.replace(".", "\\.")}(?:/|\\s|$)`,
    "m"
  );
  return pattern.test(config);
}

function updateCompileCommandsSymlink(
  workspaceFolder: vscode.WorkspaceFolder,
  artifactPath: string
): void {
  const linkDir = getClangdCompileCommandsDirPath(workspaceFolder);
  const linkPath = getClangdCompileCommandsLinkPath(workspaceFolder);

  fs.mkdirSync(linkDir, { recursive: true });
  removeCompileCommandsSymlink(workspaceFolder);

  // Prefer a relative symlink so it survives the workspace being moved. A
  // `..`-prefixed target is normal here (the artifact lives under the artifacts
  // root, not under .tbench). Only fall back to an absolute target when a
  // relative one cannot be expressed — an empty result (same path) or, on
  // Windows, an absolute path because the two paths are on different drives.
  const relativeTarget = path.relative(linkDir, artifactPath);
  const linkTarget =
    relativeTarget && !path.isAbsolute(relativeTarget)
      ? relativeTarget
      : artifactPath;

  fs.symlinkSync(linkTarget, linkPath, "file");
}

function removeCompileCommandsSymlink(workspaceFolder: vscode.WorkspaceFolder): void {
  const linkPath = getClangdCompileCommandsLinkPath(workspaceFolder);
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(linkPath);
    }
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw error;
    }
  }
}
