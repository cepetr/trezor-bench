/**
 * Pure preset TOML parser/validator: turns raw TOML text into fragments plus
 * validation issues. Never touches the filesystem — `PresetService` owns I/O.
 */
import * as vscode from "vscode";
import { parse as parseToml, TomlError } from "smol-toml";
import { ValidationIssue } from "../manifest/manifest-types";
import { PresetFilter, PresetFragment, PresetRawValue, PresetSource } from "./preset-types";
import { errorMessage } from "../util/errors";

export interface ParsedPresetFile {
  /** Group names in first-declaration order, excluding `defaults` and `default`. */
  readonly names: ReadonlyArray<string>;
  readonly fragments: ReadonlyArray<PresetFragment>;
  readonly issues: ReadonlyArray<ValidationIssue>;
}

const ALLOWED_WHEN_FIELDS = new Set(["model", "project", "emulator"]);

function issue(
  severity: ValidationIssue["severity"],
  code: ValidationIssue["code"],
  message: string,
  range?: vscode.Range
): ValidationIssue {
  return { severity, code, message, range };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Locates the 0-based line of each `[[groupName]]` header in file order, by
 * a single regex scan over the raw text.
 */
function findHeaderLines(source: string, groupName: string): number[] {
  const escaped = groupName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*\\[\\[\\s*${escaped}\\s*\\]\\]\\s*$`);
  const lines = source.split(/\r\n|\r|\n/);
  const result: number[] = [];
  lines.forEach((line, idx) => {
    if (re.test(line)) {
      result.push(idx);
    }
  });
  return result;
}

/** Turns a 0-based header line into a zero-width Range anchoring a diagnostic to it. */
function headerRange(headerLine: number | undefined): vscode.Range | undefined {
  if (headerLine === undefined) {
    return undefined;
  }
  const pos = new vscode.Position(headerLine, 0);
  return new vscode.Range(pos, pos);
}

function parseFilter(
  groupName: string,
  when: unknown,
  issues: ValidationIssue[],
  range: vscode.Range | undefined
): PresetFilter {
  if (when === undefined) {
    return {};
  }

  if (!isPlainObject(when)) {
    issues.push(issue("error", "invalid-filter", `"${groupName}": "when" must be a table`, range));
    return {};
  }

  const filter: { models?: string[]; projects?: string[]; emulator?: boolean } = {};

  for (const key of Object.keys(when)) {
    if (!ALLOWED_WHEN_FIELDS.has(key)) {
      issues.push(
        issue("error", "invalid-filter", `"${groupName}": "when" has unknown field "${key}"`, range)
      );
    }
  }

  if ("model" in when) {
    const v = when.model;
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      filter.models = v as string[];
    } else {
      issues.push(
        issue(
          "error",
          "invalid-filter",
          `"${groupName}": "when.model" must be an array of strings`,
          range
        )
      );
    }
  }

  if ("project" in when) {
    const v = when.project;
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      filter.projects = v as string[];
    } else {
      issues.push(
        issue(
          "error",
          "invalid-filter",
          `"${groupName}": "when.project" must be an array of strings`,
          range
        )
      );
    }
  }

  if ("emulator" in when) {
    const v = when.emulator;
    if (typeof v === "boolean") {
      filter.emulator = v;
    } else {
      issues.push(
        issue("error", "invalid-filter", `"${groupName}": "when.emulator" must be a boolean`, range)
      );
    }
  }

  return filter;
}

/**
 * Parses `source` as one preset TOML input (`presets.toml` or
 * `user-presets.toml`) and returns its fragments, choice names, and any
 * validation issues. Does not perform I/O.
 */
export function parsePresetFile(source: string, presetSource: PresetSource): ParsedPresetFile {
  const issues: ValidationIssue[] = [];

  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(source) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof TomlError) {
      const line = Math.max(0, err.line - 1);
      const column = Math.max(0, err.column - 1);
      issues.push(
        issue(
          "error",
          "toml-parse",
          err.message,
          new vscode.Range(new vscode.Position(line, column), new vscode.Position(line, column))
        )
      );
    } else {
      issues.push(issue("error", "toml-parse", errorMessage(err)));
    }
    return { names: [], fragments: [], issues };
  }

  const names: string[] = [];
  const fragments: PresetFragment[] = [];

  for (const [groupName, groupValue] of Object.entries(parsed)) {
    const headerLines = findHeaderLines(source, groupName);

    if (!Array.isArray(groupValue)) {
      issues.push(
        issue(
          "error",
          "invalid-filter",
          `"${groupName}" must be an array of tables (use [[${groupName}]])`,
          headerRange(headerLines[0])
        )
      );
      continue;
    }

    if (groupName === "default") {
      issues.push(
        issue(
          "warning",
          "reserved-preset-name",
          `"default" is a reserved preset name; this group is excluded from the Preset choice list.`,
          headerRange(headerLines[0])
        )
      );
    } else if (groupName !== "defaults") {
      names.push(groupName);
    }

    groupValue.forEach((item, order) => {
      const range = headerRange(headerLines[order]);

      if (!isPlainObject(item)) {
        issues.push(
          issue("error", "invalid-filter", `"${groupName}" entry ${order} must be a table`, range)
        );
        return;
      }

      const { when, ...rest } = item;
      const filter = parseFilter(groupName, when, issues, range);

      const values: Record<string, PresetRawValue> = {};
      for (const [key, value] of Object.entries(rest)) {
        values[key] = value as PresetRawValue;
      }

      fragments.push({
        name: groupName,
        source: presetSource,
        order,
        filter,
        values,
        headerLine: headerLines[order],
      });
    });
  }

  return { names, fragments, issues };
}
