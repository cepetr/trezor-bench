/**
 * IntelliSense domain types for the Trezor Bench extension.
 *
 * Covers artifact-resolution inputs, the active compile-commands artifact state,
 * provider readiness, runtime IntelliSense state, and refresh request tracking.
 */

// ---------------------------------------------------------------------------
// Artifact resolution inputs
// ---------------------------------------------------------------------------

/** All manifest and repository-config inputs needed to compute the expected artifact path. */
export interface ArtifactResolutionInputs {
  /** Resolved absolute path from `[paths].build-artifacts`. Empty string when disabled. */
  readonly artifactsRoot: string;
  /** Active model id. */
  readonly modelId: string;
  /** Selected model's required artifactFolder manifest field, or undefined. */
  readonly artifactFolder: string | undefined;
  /** Active component id. */
  readonly componentId: string;
  /** Selected component's required artifactName manifest field, or undefined. */
  readonly artifactName: string | undefined;
  /** Active target id. */
  readonly targetId: string;
  /** Selected target's optional artifactSuffix manifest field. Defaults to "". */
  readonly artifactSuffix: string;
}

// ---------------------------------------------------------------------------
// Active compile-commands artifact
// ---------------------------------------------------------------------------

export type CompileCommandsStatus = "valid" | "missing";

/** The exact compile database that should back IntelliSense for the active config. */
export interface ActiveCompileCommandsArtifact {
  /** Resolved absolute compile-commands path. */
  readonly path: string;
  /** Whether the file exists on disk. */
  readonly exists: boolean;
  /** File modification time when the artifact exists and metadata can be read. */
  readonly modifiedAt?: Date;
  /** Artifact presence status. */
  readonly status: CompileCommandsStatus;
  /** User-facing explanation when the artifact is absent. */
  readonly missingReason?: string;
  /**
   * Stable key combining the active model, target, and component that produced
   * this artifact record. Used to detect stale state.
   */
  readonly contextKey: string;
}

// ---------------------------------------------------------------------------
// IntelliSense provider readiness
// ---------------------------------------------------------------------------

export type ProviderWarningState = "none" | "missing-provider" | "wrong-provider";

/** Whether the extension can currently provide IntelliSense through cpptools or clangd. */
export interface IntelliSenseProviderReadiness {
  /** Whether a compatible IntelliSense backend is installed and enabled. */
  readonly providerInstalled: boolean;
  /** Whether tbench has configured IntelliSense in the workspace (either as the active cpptools provider, or via managed clangd configuration). */
  readonly providerConfigured: boolean;
  /** Current warning condition, if any. */
  readonly warningState: ProviderWarningState;
  /** Warning message text when warningState is not "none". */
  readonly lastWarningMessage?: string;
}

// ---------------------------------------------------------------------------
// IntelliSense runtime state
// ---------------------------------------------------------------------------

export type IntelliSenseProviderStateKind = "inactive" | "applied" | "cleared";

/** What the extension has currently applied to the provider and what the UI reflects. */
export interface IntelliSenseRuntimeState {
  /** Last compile-commands path successfully applied to the provider, or null. */
  readonly appliedArtifactPath: string | null;
  /** Last active-build-contexturation key successfully applied, or null. */
  readonly appliedContextKey: string | null;
  /** Timestamp of the last explicit stale-state clearing action, or null. */
  readonly clearedAt: Date | null;
  /** Current provider state. */
  readonly providerState: IntelliSenseProviderStateKind;
}

// ---------------------------------------------------------------------------
// IntelliSense refresh trigger
// ---------------------------------------------------------------------------

export type RefreshTrigger =
  | "activation"
  | "active-build-context-change"
  | "artifact-file-change"
  | "manual-refresh"
  | "provider-change"
  | "manifest-change"
  | "artifacts-path-change"
  | "workflow-task-complete"
  | "workspace-change"
  | "excluded-files-setting-change";

// ---------------------------------------------------------------------------
// Parsed compile-commands entry
// ---------------------------------------------------------------------------

/**
 * One source-file record parsed eagerly from the active compile database.
 * Used as the indexed unit for per-file cpptools configuration delivery.
 */
export interface ParsedCompileEntry {
  /** Normalized absolute source-file path — deduplication key for provider lookup. */
  readonly filePath: string;
  /** Normalized absolute entry working directory. */
  readonly directory: string;
  /** Resolved compiler executable path or name (first token of the command). */
  readonly compilerPath: string;
  /** Ordered flagged compile arguments after the compiler token and source file. */
  readonly arguments: ReadonlyArray<string>;
  /** Resolved include-search paths in declaration order (from -I flags). */
  readonly includePaths: ReadonlyArray<string>;
  /** Preprocessor definitions collected from -D flags. */
  readonly defines: ReadonlyArray<string>;
  /** Resolved forced-include paths from -include flags. */
  readonly forcedIncludes: ReadonlyArray<string>;
  /** Inferred language family for this entry. */
  readonly languageFamily: "c" | "cpp";
  /**
   * Inferred language standard, e.g. "c11" or "c++17",
   * or undefined when no -std= flag is present.
   */
  readonly standard: string | undefined;
  /** Original zero-based position in the compile database for first-entry-wins tie-breaking. */
  readonly rawIndex: number;
}

// ---------------------------------------------------------------------------
// Browse configuration snapshot
// ---------------------------------------------------------------------------

/**
 * Workspace-level cpptools browse configuration derived from the eagerly
 * parsed compile-database index.
 */
export interface BrowseConfigurationSnapshot {
  /** De-duplicated union of resolved include paths across indexed entries, in first-seen order. */
  readonly browsePaths: ReadonlyArray<string>;
  /**
   * Compiler path from the first indexed entry that provides one.
   * Used as the representative compiler for browse mode.
   */
  readonly compilerPath: string | undefined;
  /** Normalized compiler arguments from the same representative entry. */
  readonly compilerArgs: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Provider payload
// ---------------------------------------------------------------------------

/**
 * Complete parsed state ready to be applied to the cpptools provider.
 * Carries the indexed entries and browse snapshot derived from one refresh cycle.
 */
export interface ProviderPayload {
  /** Normalized absolute path of the source compile-commands file. */
  readonly artifactPath: string;
  /** Active-configuration context key that produced this payload. */
  readonly contextKey: string;
  /** Indexed entries keyed by normalized absolute filePath. */
  readonly entriesByFile: ReadonlyMap<string, ParsedCompileEntry>;
  /** Workspace browse configuration derived from all indexed entries. */
  readonly browseSnapshot: BrowseConfigurationSnapshot;
}

// ---------------------------------------------------------------------------
// Provider workspace-setting fix payload
// ---------------------------------------------------------------------------

/**
 * Parameters for the one-step workspace-setting fix applied when cpptools
 * is installed but another provider is configured.
 */
export interface ProviderSettingFix {
  /** Configuration section to update (C_Cpp). */
  readonly section: string;
  /** Setting key within the section (default.configurationProvider). */
  readonly key: string;
  /** Correct value to write (cepetr.tbench). */
  readonly correctValue: string;
}

/** One event that requires IntelliSense recomputation. */
export interface IntelliSenseRefreshRequest {
  /** What caused the refresh. */
  readonly trigger: RefreshTrigger;
  /** When the request was created. */
  readonly requestedAt: Date;
  /**
   * Active configuration key at scheduling time.
   * Used to collapse concurrent requests to the latest.
   */
  readonly targetContextKey: string;
}
