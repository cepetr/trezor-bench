import {
  RustAnalyzerApi,
  RustAnalyzerConfig,
  RustAnalyzerExtension,
  RustAnalyzerMode,
  RustAnalyzerRun,
  RustAnalyzerRunner,
} from "./config-types";
import { parseRustAnalyzerConfig } from "./config-parser";

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
  readonly onModeChange?: (mode: RustAnalyzerMode) => void;
}

export interface RustAnalyzerInputs {
  readonly modelId: string;
  readonly targetId: string;
  readonly emulator: boolean;
  readonly targetFlag?: string;
  readonly presetId: string;
  readonly effectiveFlags: readonly string[];
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

  constructor(private readonly deps: RustAnalyzerConfigServiceDeps) {}

  get mode(): RustAnalyzerMode {
    return this.selectedMode;
  }

  get lastAppliedConfiguration(): RustAnalyzerConfig | undefined {
    return this.lastApplied;
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

  setInputs(inputs: RustAnalyzerInputs | undefined): boolean {
    if (sameInputs(this.inputs, inputs)) {
      return false;
    }
    this.inputs = inputs && { ...inputs, effectiveFlags: [...inputs.effectiveFlags] };
    this.sequence += 1;
    this.activeRun?.cancel();
    this.activeRun = undefined;
    return true;
  }

  async refresh(): Promise<void> {
    const sequence = ++this.sequence;
    if (this.selectedMode === "all-features") {
      this.activeRun?.cancel();
      this.activeRun = undefined;
      await this.applyConfiguration({ "cargo.features": "all" }, sequence, undefined);
      return;
    }

    const inputs = this.inputs;
    if (!inputs) {
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
    const run = this.deps.runner.run(args);
    this.activeRun = run;
    const result = await run.result;
    if (result.cancelled || result.exitCode !== 0 || !this.isCurrent(sequence, inputs)) {
      return;
    }

    let configuration: RustAnalyzerConfig;
    try {
      configuration = parseRustAnalyzerConfig(result.stdout, inputs.emulator);
    } catch {
      return;
    }

    await this.applyConfiguration(configuration, sequence, inputs);
  }

  private isCurrent(sequence: number, inputs: RustAnalyzerInputs | undefined): boolean {
    return sequence === this.sequence && sameInputs(this.inputs, inputs);
  }

  private async applyConfiguration(
    configuration: RustAnalyzerConfig,
    sequence: number,
    inputs: RustAnalyzerInputs | undefined
  ): Promise<void> {
    if (!this.isCurrent(sequence, inputs)) {
      return;
    }

    const extension = this.deps.getExtension();
    if (!extension) {
      return;
    }

    const exports = extension.isActive ? extension.exports : await extension.activate();
    if (!isRustAnalyzerApi(exports) || !this.isCurrent(sequence, inputs)) {
      return;
    }

    try {
      await exports.addConfiguration(CONTRIBUTOR_ID, configuration);
      if (this.isCurrent(sequence, inputs)) {
        this.lastApplied = configuration;
      }
    } catch {
      // Refresh failures deliberately preserve the selected mode and last successful object.
    }
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