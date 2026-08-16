/**
 * Minimal vscode stub used by unit tests that run outside the VS Code
 * extension host. Provides only the subset of the API exercised by the
 * code under test.
 */

class Position {
  constructor(
    public readonly line: number,
    public readonly character: number
  ) {}
}

class Range {
  public readonly start: Position;
  public readonly end: Position;
  constructor(start: Position | number, startCharOrEnd: Position | number, endLine?: number, endChar?: number) {
    if (start instanceof Position && startCharOrEnd instanceof Position) {
      this.start = start;
      this.end = startCharOrEnd;
    } else {
      this.start = new Position(start as number, startCharOrEnd as number);
      this.end = new Position(endLine ?? 0, endChar ?? 0);
    }
  }
}

class Uri {
  constructor(
    public readonly scheme: string,
    public readonly fsPath: string
  ) {}
  static file(path: string): Uri {
    return new Uri("file", path);
  }
  static joinPath(base: Uri, ...segments: string[]): Uri {
    const joined = [base.fsPath, ...segments].join("/").replace(/\/+/g, "/");
    return new Uri(base.scheme, joined);
  }
  toString(): string {
    return `${this.scheme}://${this.fsPath}`;
  }
}

const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };

class Diagnostic {
  public source: string | undefined;
  public code: string | number | undefined;
  constructor(
    public range: Range,
    public message: string,
    public severity: number = DiagnosticSeverity.Error
  ) {}
}

const languages = {
  createDiagnosticCollection: (_name: string) => ({
    set: () => {},
    delete: () => {},
    dispose: () => {},
  }),
};

const window = {
  createOutputChannel: (_name: string) => ({
    appendLine: () => {},
    show: () => {},
    dispose: () => {},
  }),
  createStatusBarItem: (_alignment?: number, _priority?: number) => ({
    text: "" as string,
    command: undefined as string | undefined,
    tooltip: undefined as string | undefined,
    show: () => {},
    hide: () => {},
    dispose: () => {},
  }),
  showWarningMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  showQuickPick: () => Promise.resolve(undefined),
  registerTreeDataProvider: () => ({ dispose: () => {} }),
  createTreeView: () => ({
    onDidExpandElement: () => ({ dispose: () => {} }),
    onDidCollapseElement: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
  registerFileDecorationProvider: (_provider: unknown) => ({ dispose: () => {} }),
  createTextEditorDecorationType: (_options: unknown) => ({
    key: "stub-decoration-type",
    dispose: () => {},
  }),
  visibleTextEditors: [] as unknown[],
  onDidChangeVisibleTextEditors: () => ({ dispose: () => {} }),
};

const workspace = {
  workspaceFolders: undefined,
  getConfiguration: () => ({
    get: () => undefined,
    update: () => Promise.resolve(),
  }),
  createFileSystemWatcher: () => ({
    onDidCreate: () => ({ dispose: () => {} }),
    onDidChange: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
};

const commands = {
  registerCommand: (_id: string, _handler: () => void) => ({ dispose: () => {} }),
  executeCommand: () => Promise.resolve(undefined),
};

// ---------------------------------------------------------------------------
// Task doubles for Build Workflow unit tests
// ---------------------------------------------------------------------------

const TaskScope = { Workspace: 1, Global: 2 };
const TaskRevealKind = { Always: 1, Silent: 2, Never: 3 };
const TaskPanelKind = { Shared: 1, Dedicated: 2, New: 3 };

class ShellExecution {
  constructor(
    public readonly commandLine: string,
    public readonly options?: { cwd?: string }
  ) {}
}

class ProcessExecution {
  constructor(
    public readonly process: string,
    public readonly args: string[],
    public readonly options?: { cwd?: string; env?: Record<string, string> }
  ) {}
}

class Task {
  public group: unknown;
  public presentationOptions: unknown;
  constructor(
    public readonly definition: { type: string; [key: string]: unknown },
    public readonly scope: number | unknown,
    public readonly name: string,
    public readonly source: string,
    public readonly execution?: ShellExecution | ProcessExecution
  ) {}
}

class TaskGroup {
  static Build = { id: "build", isDefault: false };
  static Test = { id: "test", isDefault: false };
  static Rebuild = { id: "rebuild", isDefault: false };
  static Clean = { id: "clean", isDefault: false };
  constructor(public readonly id: string, public readonly isDefault: boolean) {}
}

const tasks = {
  registerTaskProvider: (_type: string, _provider: unknown) => ({ dispose: () => {} }),
  fetchTasks: () => Promise.resolve([]),
  executeTask: () => Promise.resolve({}),
  onDidStartTask: () => ({ dispose: () => {} }),
  onDidEndTask: () => ({ dispose: () => {} }),
  onDidStartTaskProcess: () => ({ dispose: () => {} }),
  onDidEndTaskProcess: () => ({ dispose: () => {} }),
};

class EventEmitter {
  private _listeners: Array<(e: unknown) => void> = [];
  event = (listener: (e: unknown) => void) => {
    this._listeners.push(listener);
    return { dispose: () => {} };
  };
  fire(e: unknown) {
    this._listeners.forEach((l) => l(e));
  }
  dispose() {
    this._listeners = [];
  }
}

class RelativePattern {
  constructor(public base: Uri, public pattern: string) {}
}

class TreeItem {
  public contextValue: string | undefined;
  public description: string | undefined;
  public iconPath: unknown;
  public tooltip: string | undefined;
  public collapsibleState: number;
  constructor(
    public label: string | { label: string; highlights?: [number, number][] },
    collapsibleState: number = 0
  ) {
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(public readonly id: string) {}
}

class MarkdownString {
  constructor(public readonly value: string = "") {}
}

const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
const TreeItemCheckboxState = { Unchecked: 0, Checked: 1 };
const StatusBarAlignment = { Left: 1, Right: 2 };
const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };

// ---------------------------------------------------------------------------
// File decoration stubs for excluded-file visibility unit tests
// ---------------------------------------------------------------------------

class ThemeColor {
  constructor(public readonly id: string) {}
}

class FileDecoration {
  constructor(
    public readonly badge?: string,
    public readonly tooltip?: string,
    public readonly color?: ThemeColor
  ) {}
}

// ---------------------------------------------------------------------------
// Extensions API stub for IntelliSense provider tests
// ---------------------------------------------------------------------------

const extensions = {
  getExtension: (_extensionId: string) => undefined as unknown | undefined,
  all: [] as unknown[],
  onDidChange: () => ({ dispose: () => {} }),
};

// ---------------------------------------------------------------------------
// Debug API stub for debug-launch unit tests
// ---------------------------------------------------------------------------

const debug = {
  startDebugging: (_folder: unknown, _config: unknown): Promise<boolean> => {
    return Promise.resolve(true);
  },
  onDidStartDebugSession: () => ({ dispose: () => {} }),
  onDidTerminateDebugSession: () => ({ dispose: () => {} }),
};

module.exports = {
  Position,
  Range,
  Uri,
  Diagnostic,
  DiagnosticSeverity,
  languages,
  window,
  workspace,
  commands,
  debug,
  tasks,
  extensions,
  EventEmitter,
  RelativePattern,
  TreeItem,
  ThemeIcon,
  MarkdownString,
  ThemeColor,
  FileDecoration,
  TreeItemCollapsibleState,
  TreeItemCheckboxState,
  StatusBarAlignment,
  ConfigurationTarget,
  TaskScope,
  TaskRevealKind,
  TaskPanelKind,
  ShellExecution,
  ProcessExecution,
  Task,
  TaskGroup,
};
