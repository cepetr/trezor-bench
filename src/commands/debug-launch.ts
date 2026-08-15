/**
 * Debug Launch helpers: profile resolution, executable path derivation,
 * template loading, variable-map construction, and tbench substitution.
 *
 * Covers debug launch behavior for the active build context.
 */

import * as fs from "fs";
import * as path from "path";
import * as jsonc from "jsonc-parser";
import * as vscode from "vscode";
import { ManifestComponentDebugProfile, ManifestStateLoaded } from "../manifest/manifest-types";
import { EvalContext, evaluateWhenExpression } from "../manifest/when-expressions";
import { ActiveConfig } from "../configuration/active-config";
import { logDebugLaunchFailure, notifyError, revealLogs } from "../observability/log-channel";

// ---------------------------------------------------------------------------
// Profile resolution
// ---------------------------------------------------------------------------

export type DebugProfileResolutionState = "selected" | "no-match";

/** Result of matching a component's debug profiles against the active build context. */
export interface DebugProfileResolution {
  readonly resolutionState: DebugProfileResolutionState;
  readonly selectedProfile?: ManifestComponentDebugProfile;
}

/**
 * Resolves component-scoped debug profiles against the active build context
 * using first-match declaration order.
 *
 * - Profiles without a `when` expression match all contexts (match-all).
 * - The first matching profile in declaration order is selected.
 * - No matches → `"no-match"`.
 */
export function resolveDebugProfile(
  profiles: ReadonlyArray<ManifestComponentDebugProfile>,
  evalCtx: EvalContext
): DebugProfileResolution {
  const selectedProfile = profiles.find((profile) =>
    profile.when === undefined ? true : evaluateWhenExpression(profile.when, evalCtx)
  );

  if (selectedProfile === undefined) {
    return { resolutionState: "no-match" };
  }

  return { resolutionState: "selected", selectedProfile };
}

/**
 * Ordered set of component-owned debug profiles whose `when` expressions
 * evaluate to true for the active build context.
 */
export interface MatchingDebugProfileSet {
  /** All matching profiles in manifest declaration order. */
  readonly profiles: ReadonlyArray<ManifestComponentDebugProfile>;
  /** First matching profile in declaration order; undefined when no profile matches. */
  readonly defaultProfile: ManifestComponentDebugProfile | undefined;
}

interface DebugProfileQuickPickItem extends vscode.QuickPickItem {
  readonly profile: ManifestComponentDebugProfile;
}

interface TbenchProxyDebugConfiguration extends vscode.DebugConfiguration {
  readonly tbenchMode: "default" | "profile";
  readonly tbenchProfileId: string;
  readonly tbenchContextKey: string;
}

/**
 * Collects all matching component debug profiles for the active build context
 * in manifest declaration order and identifies the default profile.
 *
 * - Profiles without a `when` expression match all contexts (match-all).
 * - All matching profiles are returned in declaration order.
 * - The first matching profile is the default.
 * - An empty set means debugging is unavailable for the active build context.
 */
export function resolveMatchingDebugProfiles(
  profiles: ReadonlyArray<ManifestComponentDebugProfile>,
  evalCtx: EvalContext
): MatchingDebugProfileSet {
  const matching = profiles.filter((profile) =>
    profile.when === undefined ? true : evaluateWhenExpression(profile.when, evalCtx)
  );
  return {
    profiles: matching,
    defaultProfile: matching[0],
  };
}

// ---------------------------------------------------------------------------
// Executable derivation
// ---------------------------------------------------------------------------

/**
 * Derives the executable file name from artifact fields.
 *
 * Result: `<artifactName><artifactSuffix><executableExtension>`
 * Empty string components are treated as an empty string.
 */
export function deriveExecutableFileName(
  artifactName: string,
  artifactSuffix: string,
  executableExtension: string
): string {
  return `${artifactName}${artifactSuffix}${executableExtension}`;
}

// ---------------------------------------------------------------------------
// Template loading
// ---------------------------------------------------------------------------

export type TemplateParseState = "loaded" | "missing" | "traversal-blocked" | "invalid";

/** Result of loading a JSONC debug configuration template. */
export interface DebugTemplateResult {
  readonly parseState: TemplateParseState;
  readonly templatePath: string;
  readonly configuration?: Record<string, unknown>;
  readonly error?: string;
}

/**
 * Loads and parses a JSONC debug configuration template file.
 *
 * - Rejects paths that escape the `templatesRoot` directory (traversal guard).
 * - Missing files produce `parseState: "missing"`.
 * - JSONC parse errors or non-object root values produce `parseState: "invalid"`.
 * - Templates are read fresh from disk on each call (no caching).
 */
export function loadDebugTemplate(
  templateRelativePath: string,
  templatesRoot: string
): DebugTemplateResult {
  const normalizedRoot = path.resolve(templatesRoot);
  const candidatePath = path.resolve(templatesRoot, templateRelativePath);

  // Traversal guard: resolved candidate must be inside the templates root
  if (
    candidatePath !== normalizedRoot &&
    !candidatePath.startsWith(normalizedRoot + path.sep)
  ) {
    return {
      parseState: "traversal-blocked",
      templatePath: candidatePath,
      error: `Template path escapes the configured templates root: ${templateRelativePath}`,
    };
  }

  let content: string;
  try {
    content = fs.readFileSync(candidatePath, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        parseState: "missing",
        templatePath: candidatePath,
        error: `Template file not found: ${candidatePath}`,
      };
    }
    return {
      parseState: "invalid",
      templatePath: candidatePath,
      error: `Failed to read template file: ${(err as Error).message}`,
    };
  }

  const parseErrors: jsonc.ParseError[] = [];
  const parsed: unknown = jsonc.parse(content, parseErrors, { allowTrailingComma: true });

  if (parseErrors.length > 0) {
    const first = parseErrors[0];
    return {
      parseState: "invalid",
      templatePath: candidatePath,
      error: `Template parse error at offset ${first.offset}: ${jsonc.printParseErrorCode(first.error)}`,
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      parseState: "invalid",
      templatePath: candidatePath,
      error: "Template must be a single JSON object representing one debug configuration.",
    };
  }

  return {
    parseState: "loaded",
    templatePath: candidatePath,
    configuration: parsed as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Variable map
// ---------------------------------------------------------------------------

/** Built-in tbench substitution variable qualified names. */
export const TBENCH_VAR_ARTIFACT_PATH = "tbench.artifactPath";
export const TBENCH_VAR_MODEL_ID = "tbench.model.id";
export const TBENCH_VAR_MODEL_NAME = "tbench.model.name";
export const TBENCH_VAR_TARGET_ID = "tbench.target.id";
export const TBENCH_VAR_TARGET_NAME = "tbench.target.name";
export const TBENCH_VAR_COMPONENT_ID = "tbench.component.id";
export const TBENCH_VAR_COMPONENT_NAME = "tbench.component.name";
export const TBENCH_VAR_EXECUTABLE_PATH = "tbench.executablePath";
export const TBENCH_VAR_EXECUTABLE = "tbench.executable";
export const TBENCH_VAR_DEBUG_PROFILE_NAME = "tbench.debugProfileName";
const TBENCH_DEBUG_VAR_PREFIX = "tbench.debug.var:";

/** Matches canonical and legacy extension-variable tokens inside template strings. */
const TBENCH_TOKEN_RE = /\$\{((?:tbench|tfTools)\.[^}]+)\}/g;

/**
 * Normalizes legacy debug-template variables at the substitution boundary.
 *
 * Existing repositories can retain `${tfTools.*}` in their JSONC templates,
 * while the extension stores and resolves only canonical `tbench.*` names.
 */
function canonicalizeTemplateVariableName(tokenName: string): string {
  return tokenName.startsWith("tfTools.") ? `tbench.${tokenName.slice("tfTools.".length)}` : tokenName;
}

/** Resolved tbench variable values available for template substitution. */
export interface DebugVariableMap {
  readonly builtIns: Readonly<Record<string, string>>;
  readonly profileVars: Readonly<Record<string, string>>;
  readonly resolvedVars: Readonly<Record<string, string>>;
  readonly resolutionErrors: ReadonlyArray<string>;
}

/**
 * Builds the complete tbench variable map for the active debug context.
 *
 * Built-in variables derive from the active model, target, component,
 * derived executable file name and path, and the selected debug profile name.
 * Profile-defined `vars` may reference built-ins and other profile vars; cycles and
 * unknown tbench references in profile vars are reported as resolution errors
 * that block launch.
 */
export function buildDebugVariableMap(
  modelId: string,
  modelName: string,
  targetId: string,
  targetName: string,
  componentId: string,
  componentName: string,
  artifactPath: string,
  executableFileName: string,
  executablePath: string,
  debugProfileName: string,
  profileVars: Readonly<Record<string, string>> | undefined
): DebugVariableMap {
  const builtIns: Readonly<Record<string, string>> = {
    [TBENCH_VAR_ARTIFACT_PATH]: artifactPath,
    [TBENCH_VAR_MODEL_ID]: modelId,
    [TBENCH_VAR_MODEL_NAME]: modelName,
    [TBENCH_VAR_TARGET_ID]: targetId,
    [TBENCH_VAR_TARGET_NAME]: targetName,
    [TBENCH_VAR_COMPONENT_ID]: componentId,
    [TBENCH_VAR_COMPONENT_NAME]: componentName,
    [TBENCH_VAR_EXECUTABLE]: executableFileName,
    [TBENCH_VAR_EXECUTABLE_PATH]: executablePath,
    [TBENCH_VAR_DEBUG_PROFILE_NAME]: debugProfileName,
  };

  const rawVars = profileVars ?? {};
  const rawVarNames = Object.keys(rawVars);

  if (rawVarNames.length === 0) {
    return {
      builtIns,
      profileVars: rawVars,
      resolvedVars: { ...builtIns },
      resolutionErrors: [],
    };
  }

  // Work map starts with all built-ins; resolved profile vars are added as
  // we process them ("tbench.shortName" → resolved string).
  const resolvedVars: Record<string, string> = { ...builtIns };
  const cycleErrors = new Set<string>();
  const unknownErrors = new Set<string>();

  // DFS state per profile var short name
  const varState = new Map<string, "unvisited" | "visiting" | "visited">();
  for (const name of rawVarNames) {
    varState.set(name, "unvisited");
  }

  function resolveProfileVar(shortName: string): string | undefined {
    const qualifiedName = `${TBENCH_DEBUG_VAR_PREFIX}${shortName}`;

    // Already resolved (built-in or previously computed profile var)
    if (Object.prototype.hasOwnProperty.call(resolvedVars, qualifiedName)) {
      return resolvedVars[qualifiedName];
    }

    const st = varState.get(shortName);
    if (st === "visited") {
      // Was visited but not placed in resolvedVars → had resolution error
      return undefined;
    }
    if (st === "visiting") {
      // Cycle — detected while resolving a dependency chain
      cycleErrors.add(qualifiedName);
      return undefined;
    }
    if (st !== "unvisited") {
      return undefined;
    }

    varState.set(shortName, "visiting");
    const rawValue = rawVars[shortName];
    let hadError = false;

    const resolvedValue = rawValue.replace(TBENCH_TOKEN_RE, (original, tokenName: string) => {
      // Already resolved (built-in or previously computed profile var)
      if (Object.prototype.hasOwnProperty.call(resolvedVars, tokenName)) {
        return resolvedVars[tokenName];
      }

      // Unresolved tbench.* token — check if it is a profile var
      if (tokenName.startsWith(TBENCH_DEBUG_VAR_PREFIX)) {
        const depShort = tokenName.slice(TBENCH_DEBUG_VAR_PREFIX.length);
        if (varState.has(depShort)) {
          const dep = resolveProfileVar(depShort);
          if (dep !== undefined) {
            return dep;
          }
          hadError = true;
          return original;
        }
      }

      // Unknown tbench variable
      unknownErrors.add(tokenName);
      hadError = true;
      return original;
    });

    varState.set(shortName, "visited");

    if (!hadError) {
      resolvedVars[qualifiedName] = resolvedValue;
      return resolvedValue;
    }
    return undefined;
  }

  for (const name of rawVarNames) {
    resolveProfileVar(name);
  }

  const resolutionErrors: string[] = [];
  for (const v of cycleErrors) {
    resolutionErrors.push(`Cyclic dependency detected for debug variable: \${${v}}`);
  }
  for (const v of unknownErrors) {
    resolutionErrors.push(`Unknown tbench variable referenced in debug vars: \${${v}}`);
  }

  return {
    builtIns,
    profileVars: rawVars,
    resolvedVars,
    resolutionErrors,
  };
}

// ---------------------------------------------------------------------------
// Substitution
// ---------------------------------------------------------------------------

/** Result of applying tbench substitutions to a template value. */
export interface SubstitutionResult {
  readonly value: unknown;
  readonly unknownVars: ReadonlyArray<string>;
}

/**
 * Applies tbench substitutions to all string fields in `value` recursively.
 *
 * - `${tbench.X}` tokens are replaced with `resolvedVars["tbench.X"]`.
 * - Legacy `${tfTools.X}` template tokens are accepted as aliases for `${tbench.X}`.
 * - Unknown extension-variable tokens are recorded in `unknownVars` and block launch.
 * - Non-extension variable syntax (e.g. `${workspaceFolder}`) is left unchanged.
 * - Replacement results are NOT re-expanded (single pass).
 * - Non-string values pass through unchanged.
 */
export function applyTbenchSubstitution(
  value: unknown,
  resolvedVars: Readonly<Record<string, string>>
): SubstitutionResult {
  const unknownVars: string[] = [];

  function walk(v: unknown): unknown {
    if (typeof v === "string") {
      return v.replace(TBENCH_TOKEN_RE, (original, tokenName: string) => {
        const canonicalName = canonicalizeTemplateVariableName(tokenName);
        if (Object.prototype.hasOwnProperty.call(resolvedVars, canonicalName)) {
          return resolvedVars[canonicalName];
        }
        if (!unknownVars.includes(tokenName)) {
          unknownVars.push(tokenName);
        }
        return original;
      });
    }
    if (Array.isArray(v)) {
      return v.map(walk);
    }
    if (v !== null && typeof v === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        result[k] = walk(val);
      }
      return result;
    }
    return v;
  }

  return { value: walk(value), unknownVars };
}

// ---------------------------------------------------------------------------
// Launch materialization
// ---------------------------------------------------------------------------

/**
 * Result returned by materializeDebugConfiguration.
 */
export type DebugMaterializationResult =
  | { readonly ok: true; readonly configuration: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string; readonly message: string; readonly detail?: string };

/**
 * Materializes a debug launch configuration for a specific resolved profile.
 *
 * Performs steps shared by both direct `Start Debugging` and provider-launched
 * debug sessions:
 *  1. Derives and verifies the executable artifact path.
 *  2. Loads and parses the JSONC debug template from `templatesRoot`.
 *  3. Builds the tbench variable map (built-ins + profile vars).
 *  4. Applies single-pass tbench substitution to the template.
 *
 * Does NOT call `vscode.debug.startDebugging` — that is left to the caller.
 * Does NOT resolve the profile — the caller must provide the selected profile.
 */
export function materializeDebugConfiguration(
  _workspaceFolder: vscode.WorkspaceFolder,
  manifest: ManifestStateLoaded,
  config: ActiveConfig,
  artifactsRoot: string,
  templatesRoot: string,
  profile: ManifestComponentDebugProfile
): DebugMaterializationResult {
  const component = manifest.components.find((c) => c.id === config.componentId);
  const target = manifest.targets.find((t) => t.id === config.targetId);
  const model = manifest.models.find((m) => m.id === config.modelId);

  if (!component || !target || !model) {
    return {
      ok: false,
      reason: "unknown-active-config",
      message: "Cannot start debugging: active configuration references an unknown component, target, or model.",
    };
  }

  // Derive executable file name and path
  const artifactFolder = model.artifactFolder ?? "";
  const executableFileName = deriveExecutableFileName(
    component.artifactName ?? "",
    target.artifactSuffix ?? "",
    target.executableExtension ?? ""
  );
  const artifactPath = path.join(artifactsRoot, artifactFolder);
  const executablePath = path.join(artifactsRoot, artifactFolder, executableFileName);

  if (!fs.existsSync(executablePath)) {
    return {
      ok: false,
      reason: "missing-executable",
      message: `Cannot start debugging: executable not found at ${executablePath}`,
      detail: executablePath,
    };
  }

  // Load debug template (per-invocation — no caching)
  const templateResult = loadDebugTemplate(profile.template, templatesRoot);

  if (templateResult.parseState === "traversal-blocked") {
    return {
      ok: false,
      reason: "traversal-blocked",
      message: `Cannot start debugging: ${templateResult.error}`,
      detail: templateResult.error,
    };
  }

  if (templateResult.parseState === "missing") {
    return {
      ok: false,
      reason: "missing-template",
      message: `Cannot start debugging: template file not found — ${templateResult.error}`,
      detail: templateResult.error,
    };
  }

  if (templateResult.parseState === "invalid") {
    return {
      ok: false,
      reason: "invalid-template",
      message: `Cannot start debugging: template is invalid — ${templateResult.error}`,
      detail: templateResult.error,
    };
  }

  const configuration = templateResult.configuration!;

  // Build tbench variable map
  const varMap = buildDebugVariableMap(
    config.modelId,
    model.name,
    config.targetId,
    target.name,
    config.componentId,
    component.name,
    artifactPath,
    executableFileName,
    executablePath,
    profile.name,
    profile.vars
  );

  if (varMap.resolutionErrors.length > 0) {
    return {
      ok: false,
      reason: "variable-resolution-error",
      message: `Cannot start debugging: variable resolution failed — ${varMap.resolutionErrors.join("; ")}`,
      detail: varMap.resolutionErrors.join("; "),
    };
  }

  // Apply single-pass tbench substitution
  const { value: resolvedConfig, unknownVars } = applyTbenchSubstitution(
    configuration,
    varMap.resolvedVars
  );

  if (unknownVars.length > 0) {
    const detail = unknownVars.map((v) => `\${${v}}`).join(", ");
    return {
      ok: false,
      reason: "unknown-template-variables",
      message: `Cannot start debugging: unknown tbench variable(s) in template: ${detail}`,
      detail,
    };
  }

  return { ok: true, configuration: resolvedConfig as Record<string, unknown> };
}

async function pickDebugProfile(
  matchingSet: MatchingDebugProfileSet
): Promise<ManifestComponentDebugProfile | undefined> {
  const items: DebugProfileQuickPickItem[] = matchingSet.profiles.map((profile) => ({
    label: profile.name,
    profile,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    title: "Select Debug Profile",
    placeHolder: "Choose a debug profile for the active build context",
    ignoreFocusOut: true,
  });

  return selected?.profile;
}

function buildTbenchProxyDebugConfiguration(
  config: ActiveConfig,
  profile: ManifestComponentDebugProfile,
  mode: "default" | "profile"
): TbenchProxyDebugConfiguration {
  return {
    type: "tbench",
    request: "launch",
    name: mode === "default" ? "Trezor" : `Trezor: ${profile.name}`,
    tbenchMode: mode,
    tbenchProfileId: profile.id,
    tbenchContextKey: `${config.modelId}::${config.targetId}::${config.componentId}`,
  };
}

function reportDebugLaunchFailure(
  reason: Parameters<typeof logDebugLaunchFailure>[0],
  config: ActiveConfig,
  message: string,
  detail?: string
): void {
  logDebugLaunchFailure(reason, {
    modelId: config.modelId,
    targetId: config.targetId,
    componentId: config.componentId,
    ...(detail === undefined ? {} : { detail }),
  });
  revealLogs();
  notifyError(message);
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * Executes the Start Debugging flow for the active build context.
 *
 * On each invocation:
 *  1. Validates manifest debug state and resolves the selected debug profile.
 *  2. Builds a tbench proxy debug configuration for the selected profile.
 *  3. Starts it via `vscode.debug.startDebugging`. The registered tbench debug
 *     provider materializes the real debugger configuration — resolving the
 *     executable artifact and debug template — so VS Code can keep the selected
 *     Run and Debug entry in sync.
 *
 * All blocked states (no-match, missing executable, template
 * errors, variable errors) surface an error message and return early.
 * Persistent output-channel logging records blocked and failed debug launches.
 */
export async function executeDebugLaunch(
  workspaceFolder: vscode.WorkspaceFolder,
  manifest: ManifestStateLoaded,
  config: ActiveConfig
): Promise<void> {
  // 1. Validate manifest debug state
  if (manifest.hasDebugBlockingIssues) {
    reportDebugLaunchFailure(
      "manifest-invalid",
      config,
      "Cannot start debugging: the manifest has debug profile validation errors.",
      "manifest has debug profile validation errors"
    );
    return;
  }

  // 2. Find selected component and target
  const component = manifest.components.find((c) => c.id === config.componentId);
  const target = manifest.targets.find((t) => t.id === config.targetId);
  const model = manifest.models.find((m) => m.id === config.modelId);

  if (!component || !target || !model) {
    reportDebugLaunchFailure(
      "unknown-active-config",
      config,
      "Cannot start debugging: active configuration references an unknown component, target, or model.",
      "active configuration references an unknown component, target, or model"
    );
    return;
  }

  // 3. Resolve component debug profile (first-match declaration order = default profile)
  const evalCtx: EvalContext = {
    modelId: config.modelId,
    targetId: config.targetId,
    componentId: config.componentId,
  };
  const profiles = component.debug ?? [];
  const matchingSet = resolveMatchingDebugProfiles(profiles, evalCtx);

  if (!matchingSet.defaultProfile) {
    reportDebugLaunchFailure(
      "no-match",
      config,
      "Cannot start debugging: no debug profile matches the active build context."
    );
    return;
  }

  let profile: ManifestComponentDebugProfile | undefined = matchingSet.defaultProfile;

  if (matchingSet.profiles.length > 1) {
    profile = await pickDebugProfile(matchingSet);
    if (!profile) {
      return;
    }
  }

  const selectedProfile = profile as ManifestComponentDebugProfile;

  const launchMode: "default" | "profile" =
    matchingSet.defaultProfile.id === selectedProfile.id ? "default" : "profile";
  const proxyConfiguration = buildTbenchProxyDebugConfiguration(
    config,
    selectedProfile,
    launchMode
  );

  // 4. Launch via VS Code debug API using the tbench proxy configuration.
  const launched = await vscode.debug.startDebugging(
    workspaceFolder,
    proxyConfiguration
  );

  if (!launched) {
    reportDebugLaunchFailure(
      "start-failed",
      config,
      "Debugging failed to start."
    );
    return;
  }

  await vscode.commands.executeCommand("workbench.view.debug");
}
