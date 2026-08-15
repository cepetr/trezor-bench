/**
 * Preset domain types: sources, files, fragments, filters, and the
 * combined preset state.
 */
import * as vscode from "vscode";
import { ValidationIssue } from "../manifest/manifest-types";

/**
 * Which of the two preset inputs a value came from. Shared is always
 * layered before user.
 */
export type PresetSource = "shared" | "user";

/** A TOML value recorded verbatim inside one fragment's `values` map. */
export type PresetRawValue = boolean | string | number;

/**
 * Parsed `when` table of one fragment. Every field is optional; an omitted
 * field matches every active build context.
 */
export interface PresetFilter {
  readonly models?: ReadonlyArray<string>;
  readonly projects?: ReadonlyArray<string>;
  readonly emulator?: boolean;
}

/** One `[[name]]` table. */
export interface PresetFragment {
  readonly name: string;
  readonly source: PresetSource;
  /** 0-based position within its (source, name) group, preserving file order. */
  readonly order: number;
  readonly filter: PresetFilter;
  /** Every non-`when` key, verbatim. Keys are kebab-case option names. */
  readonly values: Readonly<Record<string, PresetRawValue>>;
  /** 0-based line of the `[[name]]` header, for diagnostic anchoring. */
  readonly headerLine?: number;
}

/** One preset input file (`presets.toml` or `user-presets.toml`), parsed. */
export interface PresetFile {
  readonly source: PresetSource;
  readonly uri: vscode.Uri;
  /**
   * False when the file does not exist. For `user-presets.toml` that is
   * equivalent to an empty file and never an error; for the shared
   * `presets.toml` it is terminal — the whole state becomes `unavailable`,
   * because the file ships with the `xtask` that supports presets.
   */
  readonly present: boolean;
  /** Group names in first-declaration order, excluding `defaults` and `default`. */
  readonly names: ReadonlyArray<string>;
  /** All fragments across all groups, in file order. */
  readonly fragments: ReadonlyArray<PresetFragment>;
  readonly issues: ReadonlyArray<ValidationIssue>;
}

/** Published by `PresetService`, mirroring the `ManifestState` pattern. */
export interface PresetStateLoaded {
  readonly status: "loaded";
  readonly shared: PresetFile;
  readonly user: PresetFile;
  readonly loadedAt: Date;
  readonly validationIssues: ReadonlyArray<ValidationIssue>;
}

/**
 * The shared `presets.toml` does not exist, so the open repository's `xtask`
 * predates preset support and no preset-aware argument it would receive is
 * supported. Takes precedence over `invalid`. No preset choice is offered at
 * all — not even `Default` — Build/Clippy/Check are blocked, and the saved
 * preset id is preserved unresolved.
 */
export interface PresetStateUnavailable {
  readonly status: "unavailable";
  readonly shared: PresetFile;
  readonly user: PresetFile;
  readonly loadedAt: Date;
  readonly validationIssues: ReadonlyArray<ValidationIssue>;
}

/**
 * Both files exist, but at least one is unreadable or has an error-severity
 * issue. Preset choices are replaced by an error row; Build/Clippy/Check are
 * blocked; the saved preset id is preserved unresolved.
 */
export interface PresetStateInvalid {
  readonly status: "invalid";
  readonly shared: PresetFile;
  readonly user: PresetFile;
  readonly loadedAt: Date;
  readonly validationIssues: ReadonlyArray<ValidationIssue>;
}

/** `undefined` before the first load; the `Preset` selector shows a loading placeholder in that window. */
export type PresetState = PresetStateLoaded | PresetStateUnavailable | PresetStateInvalid;

/**
 * Reserved id for the synthetic `Default` choice. The only preset id that
 * suppresses `-p`. Re-exported from `configuration/active-config.ts`.
 */
export const DEFAULT_PRESET_ID = "default";
