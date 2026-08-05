import * as vscode from "vscode";

// --- Manifest entry kinds ---

export type ManifestEntryKind = "model" | "target" | "component";

// --- Manifest entries ---

export interface ManifestModel {
  readonly kind: "model";
  readonly id: string;
  readonly name: string;
  /** Required artifact folder under `[paths].build-artifacts` for this model. */
  readonly artifactFolder?: string;
}

export interface ManifestTarget {
  readonly kind: "target";
  readonly id: string;
  readonly name: string;
  readonly shortName?: string;
  /** Command-line flag appended to build commands when set to a non-null string. */
  readonly flag?: string | null;
  /** Optional suffix appended to the artifact basename for this target. Defaults to "". */
  readonly artifactSuffix?: string;
  /**
   * Optional extension appended after `<artifactName><artifactSuffix>` for executable
   * derivation (e.g. ".elf"). Defaults to "" when omitted.
   */
  readonly executableExtension?: string;
}

/**
 * A single component-scoped debug profile parsed from `component.debug[]`.
 * Evaluated in declaration order; the first matching profile wins.
 */
export interface ManifestComponentDebugProfile {
  /**
   * Stable internal identifier: `"<componentId>:debug[<N>]"` where N is the
   * 0-based position inside the owning component's `debug` array.
   */
  readonly id: string;
  /** Owning component's identifier. */
  readonly componentId: string;
  /** User-facing profile name, exposed as `${tfTools.debugProfileName}`. */
  readonly name: string;
  /** Relative path under `[paths].debug-templates` for the JSONC template. */
  readonly template: string;
  /**
  * Parsed availability expression. When absent the profile matches all active
   * contexts for the owning component.
   */
  readonly when?: WhenExpression;
  /**
  * Optional profile-defined tf-tools substitution variables.
    * Keys are short names used as `${tfTools.debug.var:<key>}` in templates.
   * Values are raw string templates that may reference built-in tf-tools variables.
   */
  readonly vars?: Readonly<Record<string, string>>;
  /** Zero-based position inside the owning component's `debug` array. */
  readonly declarationIndex: number;
}

export interface ManifestComponent {
  readonly kind: "component";
  readonly id: string;
  readonly name: string;
  /** Required artifact basename stem for this component's compile-commands artifact. */
  readonly artifactName?: string;
  /** Parsed Flash availability rule. Absent means Flash is never available for this component. */
  readonly flashWhen?: WhenExpression;
  /** Parsed Upload availability rule. Absent means Upload is never available for this component. */
  readonly uploadWhen?: WhenExpression;
  /**
   * Ordered debug entries declared under this component.
   * Absent when no `debug` array was defined in the manifest.
   */
  readonly debug?: ReadonlyArray<ManifestComponentDebugProfile>;
}

// --- Validation issues ---

export type ValidationSeverity = "error" | "warning";

export type ValidationCode =
  | "yaml-parse"
  | "missing-field"
  | "duplicate-id"
  | "invalid-type"
  | "empty-collection"
  | "duplicate-flag"
  | "invalid-when"
  | "toml-parse"
  | "invalid-filter"
  | "reserved-preset-name"
  | "preset-value-mismatch";

export interface ValidationIssue {
  readonly severity: ValidationSeverity;
  readonly message: string;
  readonly code: ValidationCode;
  /** Source range in the manifest file, when available. */
  readonly range?: vscode.Range;
}

// ---------------------------------------------------------------------------
// When expression AST
// ---------------------------------------------------------------------------

export interface WhenPredicate {
  readonly type: "model" | "target" | "component";
  readonly id: string;
}

export interface WhenAll {
  readonly type: "all";
  readonly children: ReadonlyArray<WhenExpression>;
}

export interface WhenAny {
  readonly type: "any";
  readonly children: ReadonlyArray<WhenExpression>;
}

export interface WhenNot {
  readonly type: "not";
  readonly child: WhenExpression;
}

export type WhenExpression = WhenPredicate | WhenAll | WhenAny | WhenNot;

// ---------------------------------------------------------------------------
// Build Options
// ---------------------------------------------------------------------------

export type BuildOptionKind = "checkbox" | "multistate";

export interface BuildOptionState {
  readonly id: string;
  readonly label: string;
  readonly flag: string;
  readonly description?: string;
}

export interface BuildOption {
  /** Deterministic internal key used for workspace-state persistence. */
  readonly key: string;
  /**
   * Manifest `options[].id`, when declared. Used to match preset fragment
   * keys against this option (research Decision 4). When absent, the
   * fallback match key is `flag` with leading dashes stripped.
   */
  readonly id?: string;
  readonly label: string;
  /** Command-line flag emitted when this option is active. */
  readonly flag: string;
  readonly kind: BuildOptionKind;
  readonly group?: string;
  readonly description?: string;
  /** Parsed availability rule. Absent means always available. */
  readonly when?: WhenExpression;
  /** Ordered selectable states for `kind === "multistate"` options. */
  readonly states?: ReadonlyArray<BuildOptionState>;
  /** Default state id for `kind === "multistate"` when no selection is stored. */
  readonly defaultState?: string;
}

// --- Manifest state ---

export type ManifestStatus = "loaded" | "missing" | "invalid";

export interface ManifestStateLoaded {
  readonly status: "loaded";
  readonly manifestUri: vscode.Uri;
  readonly models: ReadonlyArray<ManifestModel>;
  readonly targets: ReadonlyArray<ManifestTarget>;
  readonly components: ReadonlyArray<ManifestComponent>;
  readonly buildOptions: ReadonlyArray<BuildOption>;
  /**
   * True when any build option has an invalid `when` expression.
   * When true, Build/Clippy/Check/Clean must be blocked.
   */
  readonly hasWorkflowBlockingIssues: boolean;
  /**
  * True when any component's `debug` profiles have a validation error that
  * would prevent reliable debug profile resolution for that component.
   * When true, the Start Debugging action should be considered blocked.
   */
  readonly hasDebugBlockingIssues: boolean;
  readonly validationIssues: ReadonlyArray<ValidationIssue>;
  readonly loadedAt: Date;
}

export interface ManifestStateMissing {
  readonly status: "missing";
  readonly manifestUri: vscode.Uri;
}

export interface ManifestStateInvalid {
  readonly status: "invalid";
  readonly manifestUri: vscode.Uri;
  readonly validationIssues: ReadonlyArray<ValidationIssue>;
  readonly loadedAt: Date;
}

export type ManifestState =
  | ManifestStateLoaded
  | ManifestStateMissing
  | ManifestStateInvalid;
