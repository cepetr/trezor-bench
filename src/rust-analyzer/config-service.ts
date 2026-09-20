import {
  RustAnalyzerApi,
  RustAnalyzerConfig,
  RustAnalyzerConflict,
  RustAnalyzerExtension,
  RustAnalyzerMode,
  RustAnalyzerRun,
  RustAnalyzerRunner,
} from "./config-types";
import { parseRustAnalyzerConfig } from "./config-parser";
import { logRustAnalyzerConflicts } from "../observability/log-channel";

const MODE_STATE_KEY = "rustAnalyzer.mode";
const CONTRIBUTOR_ID = "cepetr.tbench";

export interface RustAnalyzerWorkspaceState {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

export interface RustAnalyzerConfigServiceDeps {
  readonly workspaceState: RustAnalyzerWorkspaceState;
  readonly runner: RustAnalyzerRunner;
  readonly getExtension: () => RustAnalyzerExtension | undefined;
  readonly inspectSetting?: (key: string) => {
    readonly globalValue?: unknown;
    readonly workspaceValue?: unknown;
    readonly workspaceFolderValue?: unknown;
  } | undefined;
  readonly onModeChange?: (mode: RustAnalyzerMode) => void;
  readonly onFailure?: (failure: RustAnalyzerRefreshFailure) => void;
}

export interface RustAnalyzerInputs {
  readonly modelId: string;
  readonly targetId: string;
  readonly emulator: boolean;
  readonly targetFlag?: string;
  readonly presetId: string;
  readonly effectiveFlags: readonly string[];
}

export interface RustAnalyzerRefreshFailure {
  readonly stage: "context" | "tool" | "generation" | "validation" | "registration";
  readonly message: string;
  readonly inputs?: RustAnalyzerInputs;
  readonly stderr?: string;
}

function isMode(value: unknown): value is RustAnalyzerMode {
  return value === "model-specific" || value === "all-features";
}

function isRustAnalyzerApi(value: unknown): value is RustAnalyzerApi {
  return !!value && typeof (value as RustAnalyzerApi).addConfiguration === "function";
}

export class RustAnalyzerConfigService {
  private selectedMode: RustAnalyzerMode = "all-features";
  private lastApplied: RustAnalyzerConfig | undefined;
  private inputs: RustAnalyzerInputs | undefined;
  private sequence = 0;
  private activeRun: RustAnalyzerRun | undefined;
  private currentConflicts: readonly RustAnalyzerConflict[] = [];
  private inputsKnown = false;
  private disposed = false;

  constructor(private readonly deps: RustAnalyzerConfigServiceDeps) {}

  get mode(): RustAnalyzerMode {
    return this.selectedMode;
  }

  get lastAppliedConfiguration(): RustAnalyzerConfig | undefined {
    return this.lastApplied;
  }

  get conflicts(): readonly RustAnalyzerConflict[] {
    return this.currentConflicts;
  }

  restoreMode(): RustAnalyzerMode {
    const stored = this.deps.workspaceState.get<unknown>(MODE_STATE_KEY);
    this.selectedMode = isMode(stored) ? stored : "all-features";
    this.deps.onModeChange?.(this.selectedMode);
    return this.selectedMode;
  }

  async selectMode(mode: RustAnalyzerMode): Promise<void> {
    this.selectedMode = mode;
    await this.deps.workspaceState.update(MODE_STATE_KEY, mode);
    this.deps.onModeChange?.(mode);
  }

  setInputs(inputs: RustAnalyzerInputs | undefined, startup = false): boolean {
    this.inputsKnown = !startup || inputs !== undefined;
    if (sameInputs(this.inputs, inputs)) {
      return false;
    }
    this.inputs = inputs && { ...inputs, effectiveFlags: [...inputs.effectiveFlags] };
    if (this.selectedMode === "all-features") {
      return false;
    }
    this.sequence += 1;
    this.activeRun?.cancel();
    this.activeRun = undefined;
    return true;
  }

  async refresh(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const sequence = ++this.sequence;
    if (this.selectedMode === "all-features") {
      this.activeRun?.cancel();
      this.activeRun = undefined;
      const api = await this.resolveApi(sequence, undefined);
      if (api) {
        await this.applyConfiguration({ "cargo.features": "all" }, sequence, undefined, api);
      }
      return;
    }

    const inputs = this.inputs;
    if (!inputs) {
      if (this.inputsKnown) {
        this.reportFailure("context", "Active model and target are unavailable.");
      }
      return;
    }

    const api = await this.resolveApi(sequence, inputs);
    if (!api) {
      return;
    }

    const args = ["-m", inputs.modelId];
    if (inputs.emulator && inputs.targetFlag) {
      args.push(inputs.targetFlag);
    }
    if (inputs.presetId !== "default") {
      args.push("-p", inputs.presetId);
    }
    args.push(...inputs.effectiveFlags);

    this.activeRun?.cancel();
    let run: RustAnalyzerRun;
    try {
      run = this.deps.runner.run(args);
    } catch (error) {
      this.reportCurrentFailure(sequence, inputs, "generation", errorMessage(error));
      return;
    }
    this.activeRun = run;
    const result = await run.result;
    if (result.cancelled || !this.isCurrent(sequence, inputs)) {
      return;
    }
    if (result.exitCode !== 0) {
      this.reportFailure("generation", "Rust Analyzer configuration generation failed.", inputs, result.stderr);
      return;
    }

    let configuration: RustAnalyzerConfig;
    try {
      configuration = parseRustAnalyzerConfig(result.stdout, inputs.emulator);
    } catch (error) {
      this.reportFailure("validation", errorMessage(error), inputs, result.stderr);
      return;
    }

    await this.applyConfiguration(configuration, sequence, inputs, api);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.sequence += 1;
    this.activeRun?.cancel();
    this.activeRun = undefined;
    const extension = this.deps.getExtension();
    if (!extension) {
      return;
    }
    try {
      const exports = extension.isActive ? extension.exports : await extension.activate();
      if (isRustAnalyzerApi(exports)) {
        await exports.addConfiguration(CONTRIBUTOR_ID, {});
      }
    } catch {
      // Cleanup is best effort and must not mask extension shutdown.
    }
  }

  private isCurrent(sequence: number, inputs: RustAnalyzerInputs | undefined): boolean {
    if (sequence !== this.sequence) {
      return false;
    }
    if (!inputs) {
      return this.selectedMode === "all-features";
    }
    return this.selectedMode === "model-specific" && sameInputs(this.inputs, inputs);
  }

  private async applyConfiguration(
    configuration: RustAnalyzerConfig,
    sequence: number,
    inputs: RustAnalyzerInputs | undefined,
    api: RustAnalyzerApi
  ): Promise<void> {
    if (!this.isCurrent(sequence, inputs)) {
      return;
    }

    this.currentConflicts = this.collectConflicts(configuration);
    logRustAnalyzerConflicts(this.currentConflicts);
    if (!this.isCurrent(sequence, inputs)) {
      return;
    }

    try {
      await api.addConfiguration(CONTRIBUTOR_ID, configuration);
      if (this.isCurrent(sequence, inputs)) {
        this.lastApplied = configuration;
      }
    } catch (error) {
      this.reportCurrentFailure(sequence, inputs, "registration", errorMessage(error));
    }
  }

  private async resolveApi(
    sequence: number,
    inputs: RustAnalyzerInputs | undefined
  ): Promise<RustAnalyzerApi | undefined> {
    const extension = this.deps.getExtension();
    if (!extension) {
      this.reportCurrentFailure(sequence, inputs, "tool", "Rust Analyzer extension is not installed.");
      return undefined;
    }
    try {
      const exports = extension.isActive ? extension.exports : await extension.activate();
      if (isRustAnalyzerApi(exports)) {
        return this.isCurrent(sequence, inputs) ? exports : undefined;
      }
      this.reportCurrentFailure(sequence, inputs, "tool", "Rust Analyzer extension does not expose a supported API.");
    } catch (error) {
      this.reportCurrentFailure(sequence, inputs, "tool", errorMessage(error));
    }
    return undefined;
  }

  private reportCurrentFailure(
    sequence: number,
    inputs: RustAnalyzerInputs | undefined,
    stage: RustAnalyzerRefreshFailure["stage"],
    message: string,
    stderr?: string
  ): void {
    if (this.isCurrent(sequence, inputs)) {
      this.reportFailure(stage, message, inputs, stderr);
    }
  }

  private reportFailure(
    stage: RustAnalyzerRefreshFailure["stage"],
    message: string,
    inputs?: RustAnalyzerInputs,
    stderr?: string
  ): void {
    this.deps.onFailure?.({
      stage,
      message,
      ...(inputs ? { inputs } : {}),
      ...(stderr === undefined ? {} : { stderr }),
    });
  }

  private collectConflicts(configuration: RustAnalyzerConfig): readonly RustAnalyzerConflict[] {
    if (!this.deps.inspectSetting) {
      return [];
    }
    return Object.keys(configuration).flatMap((key) => {
      const setting = this.deps.inspectSetting?.(key);
      const values = [
        ["user", setting?.globalValue],
        ["workspace", setting?.workspaceValue],
        ["workspace-folder", setting?.workspaceFolderValue],
      ].flatMap(([scope, value]) => value === undefined ? [] : [{
        scope: scope as "user" | "workspace" | "workspace-folder",
        value,
      }]);
      return values.length === 0 ? [] : [{ key, values }];
    });
  }
}

function sameInputs(a: RustAnalyzerInputs | undefined, b: RustAnalyzerInputs | undefined): boolean {
  return a === b || (!!a && !!b &&
    a.modelId === b.modelId &&
    a.targetId === b.targetId &&
    a.emulator === b.emulator &&
    a.targetFlag === b.targetFlag &&
    a.presetId === b.presetId &&
    a.effectiveFlags.length === b.effectiveFlags.length &&
    a.effectiveFlags.every((flag, index) => flag === b.effectiveFlags[index]));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}