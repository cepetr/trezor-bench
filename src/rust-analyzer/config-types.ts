export type RustAnalyzerMode = "model-specific" | "all-features";

export type RustAnalyzerConfig = Readonly<Record<string, string | boolean | readonly string[]>>;

export interface RustAnalyzerApi {
  addConfiguration(
    extensionId: string,
    configuration: Readonly<Record<string, unknown>>
  ): Promise<void>;
}

export interface RustAnalyzerExtension {
  readonly isActive: boolean;
  readonly exports: unknown;
  activate(): Promise<unknown>;
}

export interface RustAnalyzerConflictValue {
  readonly scope: "user" | "workspace" | "workspace-folder";
  readonly value: unknown;
}

export interface RustAnalyzerConflict {
  readonly key: string;
  readonly values: readonly RustAnalyzerConflictValue[];
}

export interface RustAnalyzerSnapshot {
  readonly mode: RustAnalyzerMode;
  readonly modelId?: string;
  readonly targetId?: string;
  readonly emulator?: boolean;
  readonly targetFlag?: string;
  readonly presetId?: string;
  readonly effectiveFlags: readonly string[];
}

export interface RustAnalyzerRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly cancelled: boolean;
}

export interface RustAnalyzerRun {
  readonly result: Promise<RustAnalyzerRunResult>;
  cancel(): void;
}

export interface RustAnalyzerRunner {
  run(args: readonly string[]): RustAnalyzerRun;
}
