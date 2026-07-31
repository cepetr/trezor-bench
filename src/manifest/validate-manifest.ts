import * as vscode from "vscode";
import { parseDocument, LineCounter, YAMLMap, YAMLSeq, Scalar } from "yaml";
import {
  ManifestState,
  ManifestModel,
  ManifestTarget,
  ManifestComponent,
  ManifestComponentDebugProfile,
  BuildOption,
  BuildOptionState,
  ValidationIssue,
  ValidationCode,
} from "./manifest-types";
import {
  parseWhenExpression,
  findUnknownIds,
  WhenContext,
} from "./when-expressions";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toVsRange(
  lineCounter: LineCounter,
  range: readonly [number, number, number] | undefined
): vscode.Range | undefined {
  if (!range) {
    return undefined;
  }
  const start = lineCounter.linePos(range[0]);
  const end = lineCounter.linePos(range[1]);
  // linePos returns 1-indexed; vscode.Position is 0-indexed
  return new vscode.Range(
    new vscode.Position(start.line - 1, start.col - 1),
    new vscode.Position(end.line - 1, end.col - 1)
  );
}

function issue(
  severity: ValidationIssue["severity"],
  code: ValidationCode,
  message: string,
  range?: vscode.Range
): ValidationIssue {
  return { severity, code, message, range };
}

function getScalarStringField(map: YAMLMap, ...fieldNames: string[]): string | undefined {
  for (const field of fieldNames) {
    const node = map.get(field, true);
    if (node instanceof Scalar && typeof node.value === "string") {
      return node.value;
    }
  }
  return undefined;
}

function parseOptionalWhenExpression(
  item: YAMLMap,
  field: "flashWhen" | "uploadWhen",
  lineCounter: LineCounter,
  issues: ValidationIssue[],
  contextLabel: string,
  whenContext: WhenContext
) {
  const whenNode = item.get(field, true);
  if (whenNode === undefined || whenNode === null) {
    return undefined;
  }

  if (!(whenNode instanceof Scalar) || typeof whenNode.value !== "string") {
    const nodeRange = whenNode as unknown as { range?: [number, number, number] };
    issues.push(
      issue(
        "error",
        "invalid-when",
        `${contextLabel}: "${field}" must be a string expression`,
        toVsRange(lineCounter, nodeRange?.range)
      )
    );
    return undefined;
  }

  const parseResult = parseWhenExpression(whenNode.value);
  if (!parseResult.ok) {
    const nodeRange = whenNode as unknown as { range?: [number, number, number] };
    issues.push(
      issue(
        "error",
        "invalid-when",
        `${contextLabel}: invalid "${field}" expression — ${parseResult.error}`,
        toVsRange(lineCounter, nodeRange?.range)
      )
    );
    return undefined;
  }

  const unknownIds = findUnknownIds(parseResult.expr, whenContext);
  if (unknownIds.length > 0) {
    const nodeRange = whenNode as unknown as { range?: [number, number, number] };
    issues.push(
      issue(
        "error",
        "invalid-when",
        `${contextLabel}: "${field}" expression references unknown ids: ${unknownIds.join(", ")}`,
        toVsRange(lineCounter, nodeRange?.range)
      )
    );
    return undefined;
  }

  return parseResult.expr;
}

// ---------------------------------------------------------------------------
// Entry validators
// ---------------------------------------------------------------------------

function validateStringField(
  map: YAMLMap,
  field: string,
  lineCounter: LineCounter,
  issues: ValidationIssue[],
  contextLabel: string
): string | undefined {
  const node = map.get(field, true);
  if (node === undefined || node === null) {
    const mapNode = map as YAMLMap & { range?: [number, number, number] };
    issues.push(
      issue(
        "error",
        "missing-field",
        `${contextLabel}: required field "${field}" is missing`,
        toVsRange(lineCounter, mapNode.range)
      )
    );
    return undefined;
  }
  if (!(node instanceof Scalar) || typeof node.value !== "string" || node.value.trim() === "") {
    const scalarNode = node as unknown as { range?: [number, number, number] };
    issues.push(
      issue(
        "error",
        "invalid-type",
        `${contextLabel}: field "${field}" must be a non-empty string`,
        toVsRange(lineCounter, scalarNode.range)
      )
    );
    return undefined;
  }
  return node.value;
}

function validateModels(
  doc: YAMLMap,
  lineCounter: LineCounter,
  issues: ValidationIssue[]
): ManifestModel[] {
  const models: ManifestModel[] = [];
  const seqNode = doc.get("models", true);

  if (!(seqNode instanceof YAMLSeq) || seqNode.items.length === 0) {
    const seqRange = seqNode instanceof YAMLSeq
      ? (seqNode as YAMLSeq & { range?: [number, number, number] }).range
      : undefined;
    issues.push(
      issue(
        "error",
        "empty-collection",
        "manifest must define at least one model",
        toVsRange(lineCounter, seqRange)
      )
    );
    return models;
  }

  const seen = new Set<string>();
  for (const item of seqNode.items) {
    if (!(item instanceof YAMLMap)) {
      continue;
    }
    const id = validateStringField(item, "id", lineCounter, issues, "models entry");
    const name = validateStringField(item, "name", lineCounter, issues, "models entry");
    if (!id || !name) {
      continue;
    }
    if (seen.has(id)) {
      const idNode = item.get("id", true) as unknown as { range?: [number, number, number] };
      issues.push(
        issue(
          "error",
          "duplicate-id",
          `models: duplicate id "${id}"`,
          toVsRange(lineCounter, idNode?.range)
        )
      );
      continue;
    }
    seen.add(id);
    const artifactFolderValue = getScalarStringField(item, "artifactFolder", "artifact-folder");
    const artifactFolder = artifactFolderValue?.trim() ? artifactFolderValue : undefined;
    models.push({ kind: "model", id, name, artifactFolder });
  }
  return models;
}

function validateTargets(
  doc: YAMLMap,
  lineCounter: LineCounter,
  issues: ValidationIssue[]
): ManifestTarget[] {
  const targets: ManifestTarget[] = [];
  const seqNode = doc.get("targets", true);

  if (!(seqNode instanceof YAMLSeq) || seqNode.items.length === 0) {
    const seqRange = seqNode instanceof YAMLSeq
      ? (seqNode as YAMLSeq & { range?: [number, number, number] }).range
      : undefined;
    issues.push(
      issue(
        "error",
        "empty-collection",
        "manifest must define at least one target",
        toVsRange(lineCounter, seqRange)
      )
    );
    return targets;
  }

  const seen = new Set<string>();
  for (const item of seqNode.items) {
    if (!(item instanceof YAMLMap)) {
      continue;
    }
    const id = validateStringField(item, "id", lineCounter, issues, "targets entry");
    const name = validateStringField(item, "name", lineCounter, issues, "targets entry");
    if (!id || !name) {
      continue;
    }
    if (seen.has(id)) {
      const idNode = item.get("id", true) as unknown as { range?: [number, number, number] };
      issues.push(
        issue(
          "error",
          "duplicate-id",
          `targets: duplicate id "${id}"`,
          toVsRange(lineCounter, idNode?.range)
        )
      );
      continue;
    }
    seen.add(id);
    const shortNameNode = item.get("shortName", true);
    const shortName =
      shortNameNode instanceof Scalar && typeof shortNameNode.value === "string"
        ? shortNameNode.value
        : undefined;
    const flagNode = item.get("flag", true);
    const flag: string | null | undefined =
      flagNode instanceof Scalar && typeof flagNode.value === "string" && flagNode.value.length > 0
        ? flagNode.value
        : flagNode instanceof Scalar && flagNode.value === null
          ? null
          : undefined;
    const artifactSuffix = getScalarStringField(item, "artifactSuffix", "artifact-suffix");
    const executableExtension = getScalarStringField(item, "executableExtension", "executable-extension");
    targets.push({ kind: "target", id, name, shortName, flag, artifactSuffix, executableExtension });
  }
  return targets;
}

function validateComponents(
  doc: YAMLMap,
  lineCounter: LineCounter,
  issues: ValidationIssue[],
  baseWhenContext: Omit<WhenContext, "componentIds">,
  hasDebugBlockingIssuesRef: { value: boolean }
): ManifestComponent[] {
  const components: ManifestComponent[] = [];
  const seqNode = doc.get("components", true);

  if (!(seqNode instanceof YAMLSeq) || seqNode.items.length === 0) {
    const seqRange = seqNode instanceof YAMLSeq
      ? (seqNode as YAMLSeq & { range?: [number, number, number] }).range
      : undefined;
    issues.push(
      issue(
        "error",
        "empty-collection",
        "manifest must define at least one component",
        toVsRange(lineCounter, seqRange)
      )
    );
    return components;
  }

  const seen = new Set<string>();
  const drafts: Array<{
    item: YAMLMap;
    id: string;
    name: string;
    artifactName: string | undefined;
  }> = [];
  for (const item of seqNode.items) {
    if (!(item instanceof YAMLMap)) {
      continue;
    }
    const id = validateStringField(item, "id", lineCounter, issues, "components entry");
    const name = validateStringField(item, "name", lineCounter, issues, "components entry");
    if (!id || !name) {
      continue;
    }
    if (seen.has(id)) {
      const idNode = item.get("id", true) as unknown as { range?: [number, number, number] };
      issues.push(
        issue(
          "error",
          "duplicate-id",
          `components: duplicate id "${id}"`,
          toVsRange(lineCounter, idNode?.range)
        )
      );
      continue;
    }
    seen.add(id);
    const artifactNameValue = getScalarStringField(item, "artifactName", "artifact-name");
    const artifactName = artifactNameValue?.trim() ? artifactNameValue : undefined;
    drafts.push({ item, id, name, artifactName });
  }

  const whenContext: WhenContext = {
    ...baseWhenContext,
    componentIds: new Set(drafts.map((draft) => draft.id)),
  };

  for (const draft of drafts) {
    const contextLabel = `components entry "${draft.id}"`;
    const flashWhen = parseOptionalWhenExpression(
      draft.item,
      "flashWhen",
      lineCounter,
      issues,
      contextLabel,
      whenContext
    );
    const uploadWhen = parseOptionalWhenExpression(
      draft.item,
      "uploadWhen",
      lineCounter,
      issues,
      contextLabel,
      whenContext
    );

    components.push({
      kind: "component",
      id: draft.id,
      name: draft.name,
      artifactName: draft.artifactName,
      flashWhen,
      uploadWhen,
      debug: validateComponentDebugEntries(draft.item, lineCounter, issues, draft.id, whenContext, hasDebugBlockingIssuesRef),
    });
  }
  return components;
}

// ---------------------------------------------------------------------------
// Component-scoped debug profile validator
// ---------------------------------------------------------------------------

function validateComponentDebugEntries(
  componentItem: YAMLMap,
  lineCounter: LineCounter,
  issues: ValidationIssue[],
  componentId: string,
  whenContext: WhenContext,
  hasDebugBlockingIssuesRef: { value: boolean }
): ManifestComponentDebugProfile[] | undefined {
  const seqNode = componentItem.get("debug", true);
  if (seqNode === undefined || seqNode === null) {
    return undefined;
  }

  if (!(seqNode instanceof YAMLSeq)) {
    const seqRange = seqNode as unknown as { range?: [number, number, number] };
    issues.push(
      issue(
        "error",
        "invalid-type",
        `components entry "${componentId}": "debug" must be a YAML sequence`,
        toVsRange(lineCounter, seqRange.range)
      )
    );
    hasDebugBlockingIssuesRef.value = true;
    return undefined;
  }

  const entries: ManifestComponentDebugProfile[] = [];

  for (let idx = 0; idx < seqNode.items.length; idx++) {
    const item = seqNode.items[idx];
    if (!(item instanceof YAMLMap)) {
      continue;
    }
    const contextLabel = `components entry "${componentId}" debug[${idx}]`;
    let entryHasError = false;

    // Required: name
    const name = validateStringField(item, "name", lineCounter, issues, contextLabel);
    if (!name) {
      hasDebugBlockingIssuesRef.value = true;
      entryHasError = true;
    }

    // Required: template
    const template = validateStringField(item, "template", lineCounter, issues, contextLabel);
    if (!template) {
      hasDebugBlockingIssuesRef.value = true;
      entryHasError = true;
    }

    if (entryHasError) {
      continue;
    }

    // Optional: when expression
    let whenExpr = undefined;
    const whenNode = item.get("when", true);
    if (whenNode !== undefined && whenNode !== null) {
      if (!(whenNode instanceof Scalar) || typeof whenNode.value !== "string") {
        const nodeRange = whenNode as unknown as { range?: [number, number, number] };
        issues.push(
          issue(
            "error",
            "invalid-when",
            `${contextLabel}: "when" must be a string expression`,
            toVsRange(lineCounter, nodeRange?.range)
          )
        );
        hasDebugBlockingIssuesRef.value = true;
        continue;
      }
      const parseResult = parseWhenExpression(whenNode.value);
      if (!parseResult.ok) {
        const nodeRange = whenNode as unknown as { range?: [number, number, number] };
        issues.push(
          issue(
            "error",
            "invalid-when",
            `${contextLabel}: invalid "when" expression — ${parseResult.error}`,
            toVsRange(lineCounter, nodeRange?.range)
          )
        );
        hasDebugBlockingIssuesRef.value = true;
        continue;
      }
      const unknownIds = findUnknownIds(parseResult.expr, whenContext);
      if (unknownIds.length > 0) {
        const nodeRange = whenNode as unknown as { range?: [number, number, number] };
        issues.push(
          issue(
            "error",
            "invalid-when",
            `${contextLabel}: "when" expression references unknown ids: ${unknownIds.join(", ")}`,
            toVsRange(lineCounter, nodeRange?.range)
          )
        );
        hasDebugBlockingIssuesRef.value = true;
        continue;
      }
      whenExpr = parseResult.expr;
    }

    // Optional: vars (map of string → string)
    let vars: Record<string, string> | undefined;
    const varsNode = item.get("vars", true);
    if (varsNode !== undefined && varsNode !== null) {
      if (!(varsNode instanceof YAMLMap)) {
        const nodeRange = varsNode as unknown as { range?: [number, number, number] };
        issues.push(
          issue(
            "error",
            "invalid-type",
            `${contextLabel}: "vars" must be a YAML mapping`,
            toVsRange(lineCounter, nodeRange?.range)
          )
        );
        hasDebugBlockingIssuesRef.value = true;
        continue;
      }
      vars = {};
      let varsHasError = false;
      for (const pair of varsNode.items) {
        const keyNode = pair.key as unknown;
        const valNode = pair.value as unknown;
        if (!(keyNode instanceof Scalar) || typeof keyNode.value !== "string" || !keyNode.value.trim()) {
          const keyRange = keyNode as unknown as { range?: [number, number, number] };
          issues.push(
            issue(
              "error",
              "invalid-type",
              `${contextLabel}: vars key must be a non-empty string`,
              toVsRange(lineCounter, (keyRange as { range?: [number, number, number] })?.range)
            )
          );
          hasDebugBlockingIssuesRef.value = true;
          varsHasError = true;
          break;
        }
        if (!(valNode instanceof Scalar) || typeof valNode.value !== "string") {
          const valRange = valNode as unknown as { range?: [number, number, number] };
          issues.push(
            issue(
              "error",
              "invalid-type",
              `${contextLabel}: vars value for key "${keyNode.value}" must be a string`,
              toVsRange(lineCounter, valRange?.range)
            )
          );
          hasDebugBlockingIssuesRef.value = true;
          varsHasError = true;
          break;
        }
        vars[keyNode.value] = valNode.value;
      }
      if (varsHasError) {
        continue;
      }
    }

    entries.push({
      id: `${componentId}:debug[${idx}]`,
      componentId,
      name: name!,
      template: template!,
      when: whenExpr,
      vars: vars ? Object.freeze(vars) : undefined,
      declarationIndex: idx,
    });
  }

  return entries.length > 0 ? entries : undefined;
}

/**
 * Deterministic persistence key for a build option.
 * Uses only the flag since flags are required to be unique.
 * (duplicate-flag validation) and serve as stable identifiers.
 */
function buildOptionKey(flag: string): string {
  // Strip leading dashes and replace non-alphanumeric chars with underscores
  return flag.replace(/^-+/, "").replace(/[^a-zA-Z0-9]/g, "_") || flag;
}

function validateBuildOptions(
  doc: YAMLMap,
  lineCounter: LineCounter,
  issues: ValidationIssue[],
  whenContext: WhenContext
): { options: BuildOption[]; hasWorkflowBlockingIssues: boolean } {
  const options: BuildOption[] = [];
  let hasWorkflowBlockingIssues = false;

  const seqNode = doc.get("options", true);
  if (seqNode === undefined || seqNode === null) {
    // options is optional; absence is not an error
    return { options, hasWorkflowBlockingIssues };
  }

  if (!(seqNode instanceof YAMLSeq)) {
    const seqRange = seqNode as unknown as { range?: [number, number, number] };
    issues.push(
      issue(
        "error",
        "invalid-type",
        "options must be a YAML sequence",
        toVsRange(lineCounter, seqRange.range)
      )
    );
    return { options, hasWorkflowBlockingIssues };
  }

  const seenFlags = new Set<string>();

  for (const item of seqNode.items) {
    if (!(item instanceof YAMLMap)) {
      continue;
    }

    // Required: name
    const label = validateStringField(item, "name", lineCounter, issues, "options entry");
    if (!label) {
      continue;
    }

    // Optional: id — carried through to BuildOption.id for preset-fragment matching
    // (research Decision 4). Also used to derive "flag" as --{id} when "flag" is absent.
    const idNode = item.get("id", true);
    const id =
      idNode instanceof Scalar && typeof idNode.value === "string" && idNode.value.trim()
        ? idNode.value
        : undefined;

    // Required: flag — use explicit "flag" when present; otherwise derive from "id" as --{id}
    let flag: string | undefined;
    const explicitFlagNode = item.get("flag", true);
    if (
      explicitFlagNode instanceof Scalar &&
      typeof explicitFlagNode.value === "string" &&
      explicitFlagNode.value.trim()
    ) {
      flag = explicitFlagNode.value;
    } else if (id) {
      flag = `--${id}`;
    } else {
      // Neither flag nor id — report as missing
      validateStringField(item, "flag", lineCounter, issues, `options entry "${label}"`);
      continue;
    }

    // Duplicate flag check
    if (seenFlags.has(flag)) {
      const flagNode = item.get("flag", true) as unknown as { range?: [number, number, number] };
      issues.push(
        issue(
          "error",
          "duplicate-flag",
          `options: duplicate flag "${flag}" for option "${label}"`,
          toVsRange(lineCounter, flagNode?.range)
        )
      );
      continue;
    }
    seenFlags.add(flag);

    // Required: type
    let kind: "checkbox" | "multistate" | undefined;
    const typeNode = item.get("type", true);
    if (typeNode instanceof Scalar && (typeNode.value === "checkbox" || typeNode.value === "multistate")) {
      kind = typeNode.value;
    } else {
      const nodeRange = typeNode as unknown as { range?: [number, number, number] };
      issues.push(
        issue(
          "error",
          "invalid-type",
          `options entry "${label}": field "type" must be "checkbox" or "multistate"`,
          toVsRange(lineCounter, nodeRange?.range)
        )
      );
      continue;
    }

    // Optional: group
    const groupNode = item.get("group", true);
    const group =
      groupNode instanceof Scalar && typeof groupNode.value === "string" && groupNode.value.trim()
        ? groupNode.value
        : undefined;

    // Optional: description
    const descNode = item.get("description", true);
    const description =
      descNode instanceof Scalar && typeof descNode.value === "string" && descNode.value.trim()
        ? descNode.value
        : undefined;

    // Optional: when
    let whenExpr = undefined;
    const whenNode = item.get("when", true);
    if (whenNode !== undefined && whenNode !== null) {
      if (!(whenNode instanceof Scalar) || typeof whenNode.value !== "string") {
        const nodeRange = whenNode as unknown as { range?: [number, number, number] };
        issues.push(
          issue(
            "error",
            "invalid-when",
            `options entry "${label}": "when" must be a string expression`,
            toVsRange(lineCounter, nodeRange?.range)
          )
        );
        hasWorkflowBlockingIssues = true;
      } else {
        const parseResult = parseWhenExpression(whenNode.value);
        if (!parseResult.ok) {
          const nodeRange = whenNode as unknown as { range?: [number, number, number] };
          issues.push(
            issue(
              "error",
              "invalid-when",
              `options entry "${label}": invalid "when" expression — ${parseResult.error}`,
              toVsRange(lineCounter, nodeRange?.range)
            )
          );
          hasWorkflowBlockingIssues = true;
        } else {
          // Validate referenced ids
          const unknownIds = findUnknownIds(parseResult.expr, whenContext);
          if (unknownIds.length > 0) {
            const nodeRange = whenNode as unknown as { range?: [number, number, number] };
            issues.push(
              issue(
                "error",
                "invalid-when",
                `options entry "${label}": "when" expression references unknown ids: ${unknownIds.join(", ")}`,
                toVsRange(lineCounter, nodeRange?.range)
              )
            );
            hasWorkflowBlockingIssues = true;
          } else {
            whenExpr = parseResult.expr;
          }
        }
      }
    }

    // For multistate: parse states
    let states: BuildOptionState[] | undefined;
    let defaultState: string | undefined;
    if (kind === "multistate") {
      const statesResult = validateBuildOptionStates(item, lineCounter, issues, label, flag);
      states = statesResult.states;
      defaultState = statesResult.defaultState;
      if (states.length === 0) {
        continue; // skip invalid multistate option
      }
    }

    const key = buildOptionKey(flag);
    options.push({
      key,
      id,
      label,
      flag,
      kind: kind!,
      group,
      description,
      when: whenExpr,
      states,
      defaultState,
    });
  }

  return { options, hasWorkflowBlockingIssues };
}

function validateBuildOptionStates(
  item: YAMLMap,
  lineCounter: LineCounter,
  issues: ValidationIssue[],
  optionLabel: string,
  optionFlag: string
): { states: BuildOptionState[]; defaultState: string | undefined } {
  const statesNode = item.get("states", true);
  let defaultState: string | undefined;

  if (!(statesNode instanceof YAMLSeq) || statesNode.items.length === 0) {
    const nodeRange = statesNode instanceof YAMLSeq
      ? (statesNode as YAMLSeq & { range?: [number, number, number] }).range
      : undefined;
    issues.push(
      issue(
        "error",
        "empty-collection",
        `options entry "${optionLabel}": multistate option must define at least one state`,
        toVsRange(lineCounter, nodeRange)
      )
    );
    return { states: [], defaultState };
  }

  const states: BuildOptionState[] = [];
  const seenStateIds = new Set<string>();

  for (const stateItem of statesNode.items) {
    if (!(stateItem instanceof YAMLMap)) {
      continue;
    }

    let id: string;
    let label: string;
    let flag: string;
    let description: string | undefined;

    const valueNode = stateItem.get("value", true);
    if (!(valueNode instanceof Scalar)) {
      const nodeRange = valueNode as unknown as { range?: [number, number, number] };
      issues.push(
        issue(
          "error",
          "invalid-type",
          `options "${optionLabel}" state: "value" must be a scalar`,
          toVsRange(lineCounter, nodeRange?.range)
        )
      );
      continue;
    }

    const rawValue = valueNode.value;
    if (rawValue === null || rawValue === undefined) {
      id = "null";
      flag = "";
    } else {
      id = String(rawValue);
      flag = `${optionFlag}=${rawValue}`;
    }

    const nameNode = stateItem.get("name", true);
    if (!(nameNode instanceof Scalar) || typeof nameNode.value !== "string" || !nameNode.value.trim()) {
      const nodeRange = nameNode as unknown as { range?: [number, number, number] };
      issues.push(
        issue(
          "error",
          "missing-field",
          `options "${optionLabel}" state: required field "name" is missing or empty`,
          toVsRange(lineCounter, nodeRange?.range)
        )
      );
      continue;
    }
    label = nameNode.value;

    const descriptionNode = stateItem.get("description", true);
    if (descriptionNode instanceof Scalar) {
      description = typeof descriptionNode.value === "string" ? descriptionNode.value : undefined;
    }

    if (seenStateIds.has(id)) {
      const idNode = stateItem.get("id", true) as unknown as { range?: [number, number, number] };
      issues.push(
        issue(
          "error",
          "duplicate-id",
          `options "${optionLabel}": duplicate state id "${id}"`,
          toVsRange(lineCounter, idNode?.range)
        )
      );
      continue;
    }
    seenStateIds.add(id);

    const isDefault = stateItem.get("default") === true;
    if (isDefault) {
      defaultState = id;
    }
    states.push({ id, label, flag, description });
  }

  // If no explicit default, use the first state
  if (!defaultState && states.length > 0) {
    defaultState = states[0].id;
  }

  return { states, defaultState };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses `source` as a tf-tools manifest YAML document and validates its
 * structure. Returns the parsed collections and any validation issues found.
 *
 * This function does not perform I/O; pass the file contents as a string.
 */
export function parseManifest(source: string): {
  models: ManifestModel[];
  targets: ManifestTarget[];
  components: ManifestComponent[];
  buildOptions: BuildOption[];
  hasWorkflowBlockingIssues: boolean;
  hasDebugBlockingIssues: boolean;
  issues: ValidationIssue[];
} {
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter });

  const issues: ValidationIssue[] = [];

  // Collect yaml parse errors
  for (const err of doc.errors) {
    const pos = (err as unknown as { pos?: [number, number] }).pos;
    let range: vscode.Range | undefined;
    if (pos) {
      const start = lineCounter.linePos(pos[0]);
      const end = lineCounter.linePos(pos[1]);
      range = new vscode.Range(
        new vscode.Position(start.line - 1, start.col - 1),
        new vscode.Position(end.line - 1, end.col - 1)
      );
    }
    issues.push(issue("error", "yaml-parse", err.message, range));
  }

  if (issues.length > 0) {
    return { models: [], targets: [], components: [], buildOptions: [], hasWorkflowBlockingIssues: false, hasDebugBlockingIssues: false, issues };
  }

  const root = doc.contents;
  if (!(root instanceof YAMLMap)) {
    issues.push(issue("error", "invalid-type", "manifest root must be a YAML mapping"));
    return { models: [], targets: [], components: [], buildOptions: [], hasWorkflowBlockingIssues: false, hasDebugBlockingIssues: false, issues };
  }

  // Reject legacy top-level "debug" section
  if (root.has("debug")) {
    const debugNode = root.get("debug", true);
    const nodeRange = debugNode as unknown as { range?: [number, number, number] };
    issues.push(
      issue(
        "error",
        "invalid-type",
        'Legacy top-level "debug" section is not supported. Use per-component "debug" entries instead.',
        toVsRange(lineCounter, nodeRange?.range)
      )
    );
    return { models: [], targets: [], components: [], buildOptions: [], hasWorkflowBlockingIssues: false, hasDebugBlockingIssues: true, issues };
  }

  const models = validateModels(root, lineCounter, issues);
  const targets = validateTargets(root, lineCounter, issues);
  const hasDebugBlockingIssuesRef = { value: false };
  const components = validateComponents(root, lineCounter, issues, {
    modelIds: new Set(models.map((m) => m.id)),
    targetIds: new Set(targets.map((t) => t.id)),
  }, hasDebugBlockingIssuesRef);

  // Build options validation requires known ids for `when` expression validation
  const whenContext: WhenContext = {
    modelIds: new Set(models.map((m) => m.id)),
    targetIds: new Set(targets.map((t) => t.id)),
    componentIds: new Set(components.map((c) => c.id)),
  };
  const { options: buildOptions, hasWorkflowBlockingIssues } = validateBuildOptions(
    root,
    lineCounter,
    issues,
    whenContext
  );

  return { models, targets, components, buildOptions, hasWorkflowBlockingIssues, hasDebugBlockingIssues: hasDebugBlockingIssuesRef.value, issues };
}

/**
 * Validates `source` against the manifest schema and constructs a
 * `ManifestState` from the results. Requires the manifest `uri` for
 * attaching state metadata.
 */
export function validateManifest(
  source: string,
  uri: vscode.Uri
): ManifestState {
  const { models, targets, components, buildOptions, hasWorkflowBlockingIssues, hasDebugBlockingIssues, issues } = parseManifest(source);

  const structuralErrors = issues.filter((i) => i.severity === "error");

  if (structuralErrors.length > 0 || models.length === 0 || targets.length === 0 || components.length === 0) {
    return {
      status: "invalid",
      manifestUri: uri,
      validationIssues: issues,
      loadedAt: new Date(),
    };
  }

  return {
    status: "loaded",
    manifestUri: uri,
    models,
    targets,
    components,
    buildOptions,
    hasWorkflowBlockingIssues,
    hasDebugBlockingIssues,
    validationIssues: issues, // may contain warnings
    loadedAt: new Date(),
  };
}
