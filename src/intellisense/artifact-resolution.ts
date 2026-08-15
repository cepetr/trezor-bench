/**
 * Pure resolution of the active build context's artifact paths and on-disk
 * status: compile commands, binary, map, and executable.
 */
import * as path from "path";
import * as fs from "fs";
import {
  ArtifactResolutionInputs,
  ActiveCompileCommandsArtifact,
} from "./intellisense-types";
import { ManifestStateLoaded, activeManifestEntries } from "../manifest/manifest-types";
import { ActiveConfig } from "../configuration/active-config";
import {
  DebugProfileResolutionState,
  resolveMatchingDebugProfiles,
  deriveExecutableFileName,
} from "../commands/debug-launch";

// ---------------------------------------------------------------------------
// Context key
// ---------------------------------------------------------------------------

/**
 * Produces a stable string key for the given active configuration.
 * Used to detect when stale IntelliSense state must be cleared.
 */
export function makeContextKey(config: ActiveConfig): string {
  return `${config.modelId}::${config.targetId}::${config.componentId}`;
}

// ---------------------------------------------------------------------------
// Artifact resolution inputs
// ---------------------------------------------------------------------------

/**
 * Derives `ArtifactResolutionInputs` from the loaded manifest state,
 * active configuration, and resolved artifacts root path.
 *
 * Returns `undefined` when the manifest does not contain the required
 * `artifactFolder` for the active model or `artifactName` for the active
 * component — in that case IntelliSense resolution is not possible.
 */
export function buildResolutionInputs(
  manifest: ManifestStateLoaded,
  config: ActiveConfig,
  artifactsRoot: string
): ArtifactResolutionInputs | undefined {
  const entries = activeManifestEntries(manifest, config);
  if (!entries) {
    return undefined;
  }
  const { model, target, component } = entries;

  return {
    artifactsRoot,
    modelId: config.modelId,
    artifactFolder: model.artifactFolder,
    componentId: config.componentId,
    artifactName: component.artifactName,
    targetId: config.targetId,
    artifactSuffix: target.artifactSuffix ?? "",
  };
}

// ---------------------------------------------------------------------------
// Path derivation
// ---------------------------------------------------------------------------

/**
 * Computes the expected artifact path for the given extension.
 *
 * Formula: `<artifactsRoot>/<artifactFolder>/<artifactName><artifactSuffix><extension>`
 *
 * Returns `undefined` when any of `artifactsRoot`, `artifactFolder`, or
 * `artifactName` is absent/empty — resolution requires all three.
 */
function deriveArtifactPathWithExtension(
  inputs: ArtifactResolutionInputs,
  extension: string
): string | undefined {
  if (!inputs.artifactsRoot || !inputs.artifactFolder || !inputs.artifactName) {
    return undefined;
  }
  return path.join(
    inputs.artifactsRoot,
    inputs.artifactFolder,
    `${inputs.artifactName}${inputs.artifactSuffix}${extension}`
  );
}

/** Expected compile-commands artifact path (`.cc.json`), or `undefined` when underivable. */
export function deriveArtifactPath(inputs: ArtifactResolutionInputs): string | undefined {
  return deriveArtifactPathWithExtension(inputs, ".cc.json");
}

/** Expected binary artifact path (`.bin`), or `undefined` when underivable. */
export function deriveBinaryArtifactPath(inputs: ArtifactResolutionInputs): string | undefined {
  return deriveArtifactPathWithExtension(inputs, ".bin");
}

/** Expected map artifact path (`.map`), or `undefined` when underivable. */
export function deriveMapArtifactPath(inputs: ArtifactResolutionInputs): string | undefined {
  return deriveArtifactPathWithExtension(inputs, ".map");
}

// ---------------------------------------------------------------------------
// Binary / Map artifact status resolution
// ---------------------------------------------------------------------------

export type BinaryArtifactStatus = "valid" | "missing";
export type MapArtifactStatus = "valid" | "missing";

export interface ActiveBinaryArtifact {
  readonly path: string;
  readonly exists: boolean;
  readonly modifiedAt?: Date;
  readonly status: BinaryArtifactStatus;
  readonly missingReason?: string;
  readonly contextKey: string;
}

export interface ActiveMapArtifact {
  readonly path: string;
  readonly exists: boolean;
  readonly modifiedAt?: Date;
  readonly status: MapArtifactStatus;
  readonly missingReason?: string;
  readonly contextKey: string;
}

function checkFileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readFileModifiedAt(filePath: string): Date | undefined {
  try {
    return fs.statSync(filePath).mtime;
  } catch {
    return undefined;
  }
}

/**
 * Resolves one on-disk artifact's status for the given inputs and extension.
 *
 * - Returns `status: "valid"` only when the exact expected file exists.
 * - Returns `status: "missing"` in all other cases: when the path cannot be
 *   derived (missing fields) or when the file does not exist on disk.
 * - Does not fall back to any other artifact path.
 *
 * `label` names the artifact kind in missing-reason messages
 * (e.g. "binary" -> "Binary artifact not found ...").
 */
function resolveFileArtifact(
  inputs: ArtifactResolutionInputs,
  config: ActiveConfig,
  extension: string,
  label: string
) {
  const contextKey = makeContextKey(config);
  const artifactPath = deriveArtifactPathWithExtension(inputs, extension);

  if (!artifactPath) {
    return {
      path: "",
      exists: false,
      status: "missing" as const,
      missingReason: buildMissingReason(inputs, label),
      contextKey,
    };
  }

  if (checkFileExists(artifactPath)) {
    return {
      path: artifactPath,
      exists: true,
      modifiedAt: readFileModifiedAt(artifactPath),
      status: "valid" as const,
      contextKey,
    };
  }
  return {
    path: artifactPath,
    exists: false,
    status: "missing" as const,
    missingReason:
      `${label.charAt(0).toUpperCase()}${label.slice(1)} artifact not found ` +
      `at the expected path: ${artifactPath}`,
    contextKey,
  };
}

/**
 * Resolves the active binary artifact status for the given inputs.
 * Returns `status: "valid"` only when the exact expected `.bin` file exists.
 */
export function resolveActiveBinaryArtifact(
  inputs: ArtifactResolutionInputs,
  config: ActiveConfig
): ActiveBinaryArtifact {
  return resolveFileArtifact(inputs, config, ".bin", "binary");
}

/**
 * Resolves the active map artifact status for the given inputs.
 * Returns `status: "valid"` only when the exact expected `.map` file exists.
 */
export function resolveActiveMapArtifact(
  inputs: ArtifactResolutionInputs,
  config: ActiveConfig
): ActiveMapArtifact {
  return resolveFileArtifact(inputs, config, ".map", "map");
}

// ---------------------------------------------------------------------------
// Artifact status resolution (no fallback) — compile commands
// ---------------------------------------------------------------------------

/**
 * Resolves the active compile-commands artifact status for the given inputs.
 *
 * - Returns `status: "valid"` only when the exact expected file exists.
 * - Returns `status: "missing"` in all other cases: when the path cannot be
 *   derived (missing fields) or when the file does not exist on disk.
 * - Does not fall back to any other artifact path.
 */
export function resolveActiveArtifact(
  inputs: ArtifactResolutionInputs,
  config: ActiveConfig
): ActiveCompileCommandsArtifact {
  return resolveFileArtifact(inputs, config, ".cc.json", "compile-commands");
}

// ---------------------------------------------------------------------------
// Missing-reason helpers
// ---------------------------------------------------------------------------

/** Explains why the `label` artifact path could not be derived from `inputs`. */
function buildMissingReason(inputs: ArtifactResolutionInputs, label: string): string {
  if (!inputs.artifactsRoot) {
    return `[paths].build-artifacts is empty in tbench.toml; cannot resolve the ${label} artifact.`;
  }
  if (!inputs.artifactFolder) {
    return `The active model does not define artifactFolder in the manifest; cannot resolve the ${label} artifact.`;
  }
  if (!inputs.artifactName) {
    return `The active component does not define artifactName in the manifest; cannot resolve the ${label} artifact.`;
  }
  return `Cannot resolve the ${label} artifact path.`;
}

// ---------------------------------------------------------------------------
// Executable artifact state resolution
// ---------------------------------------------------------------------------

export type ExecutableArtifactStatus = "valid" | "missing";

/** User-visible executable artifact state for the active build context. */
export interface ActiveExecutableArtifact {
  readonly contextKey: string;
  readonly profileResolutionState: DebugProfileResolutionState | "manifest-invalid";
  readonly expectedPath: string;
  readonly exists: boolean;
  readonly modifiedAt?: Date;
  readonly status: ExecutableArtifactStatus;
  readonly missingReason?: string;
  readonly tooltip: string;
  /** Number of profiles in the matching debug profile set for the active build context. */
  readonly matchingProfileCount: number;
}

function formatExecutableArtifactTooltip(expectedPath: string, missingReason?: string): string {
  if (!missingReason) {
    return expectedPath;
  }

  if (!expectedPath) {
    return missingReason;
  }

  if (
    missingReason.includes(expectedPath)
    || /executable artifact not found/i.test(missingReason)
  ) {
    return `Missing: ${expectedPath}`;
  }

  return [`Missing: ${expectedPath}`, missingReason].join("\n");
}

/**
 * Resolves the active executable artifact state for the given manifest, config,
 * and artifacts root.
 *
 * - Returns `status: "valid"` only when the first matching component debug profile
 *   is found, its derived executable file exists on disk, and the manifest has no
 *   debug-blocking validation errors.
 * - Returns `status: "missing"` for all other cases with an explanatory reason.
 */
export function resolveActiveExecutableArtifact(
  manifest: ManifestStateLoaded,
  config: ActiveConfig,
  artifactsRoot: string
): ActiveExecutableArtifact {
  const contextKey = makeContextKey(config);

  if (manifest.hasDebugBlockingIssues) {
    return {
      contextKey,
      profileResolutionState: "manifest-invalid",
      expectedPath: "",
      exists: false,
      status: "missing",
      missingReason: "The manifest has debug blocking issues; cannot resolve an executable.",
      tooltip: formatExecutableArtifactTooltip(
        "",
        "The manifest has debug blocking issues; cannot resolve an executable."
      ),
      matchingProfileCount: 0,
    };
  }

  const component = manifest.components.find((c) => c.id === config.componentId);
  const target = manifest.targets.find((t) => t.id === config.targetId);
  const model = manifest.models.find((m) => m.id === config.modelId);

  if (!component || !target || !model) {
    const reason = "Active configuration references an unknown component, target, or model.";
    return {
      contextKey,
      profileResolutionState: "no-match",
      expectedPath: "",
      exists: false,
      status: "missing",
      missingReason: reason,
      tooltip: formatExecutableArtifactTooltip("", reason),
      matchingProfileCount: 0,
    };
  }

  const evalCtx = { modelId: config.modelId, targetId: config.targetId, componentId: config.componentId };
  const profiles = component.debug ?? [];
  const matchingSet = resolveMatchingDebugProfiles(profiles, evalCtx);

  if (!matchingSet.defaultProfile) {
    return {
      contextKey,
      profileResolutionState: "no-match",
      expectedPath: "",
      exists: false,
      status: "missing",
      missingReason: "No debug profile matches the active build context.",
      tooltip: formatExecutableArtifactTooltip(
        "",
        "No debug profile matches the active build context."
      ),
      matchingProfileCount: 0,
    };
  }

  // Profile resolved — derive executable path
  const artifactFolder = model.artifactFolder ?? "";
  const executableFileName = deriveExecutableFileName(
    component.artifactName ?? "",
    target.artifactSuffix ?? "",
    target.executableExtension ?? ""
  );

  if (!artifactsRoot || !artifactFolder || !executableFileName) {
    let reason: string;
    if (!artifactsRoot) {
      reason = "[paths].build-artifacts is empty in tbench.toml; cannot resolve the executable artifact.";
    } else if (!artifactFolder) {
      reason = "The active model does not define artifactFolder in the manifest; cannot resolve the executable artifact.";
    } else {
      reason = "The active component does not define artifactName in the manifest; cannot resolve the executable artifact.";
    }
    return {
      contextKey,
      profileResolutionState: "selected",
      expectedPath: "",
      exists: false,
      status: "missing",
      missingReason: reason,
      tooltip: formatExecutableArtifactTooltip("", reason),
      matchingProfileCount: matchingSet.profiles.length,
    };
  }

  const expectedPath = path.join(artifactsRoot, artifactFolder, executableFileName);

  const exists = checkFileExists(expectedPath);
  if (exists) {
    return {
      contextKey,
      profileResolutionState: "selected",
      expectedPath,
      exists: true,
      modifiedAt: readFileModifiedAt(expectedPath),
      status: "valid",
      tooltip: formatExecutableArtifactTooltip(expectedPath),
      matchingProfileCount: matchingSet.profiles.length,
    };
  }

  return {
    contextKey,
    profileResolutionState: "selected",
    expectedPath,
    exists: false,
    status: "missing",
    missingReason: `Executable artifact not found at the expected path: ${expectedPath}`,
    tooltip: formatExecutableArtifactTooltip(
      expectedPath,
      `Executable artifact not found at the expected path: ${expectedPath}`
    ),
    matchingProfileCount: matchingSet.profiles.length,
  };
}
