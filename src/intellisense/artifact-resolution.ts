/**
 * Pure resolution of the active build context's artifact paths and on-disk
 * status: compile commands, binary, map, and executable.
 */
import * as path from "path";
import * as fs from "fs";
import {
  ArtifactResolutionInputs,
  ResolvedArtifact,
} from "./intellisense-types";
import { BuildContext, ManifestStateLoaded, findManifestEntries } from "../manifest/manifest-types";
import {
  DebugProfileResolutionState,
  resolveMatchingDebugProfiles,
} from "../commands/debug-launch";

// ---------------------------------------------------------------------------
// Context key
// ---------------------------------------------------------------------------

/**
 * Produces a stable string key for the given active configuration.
 * Used to detect when stale IntelliSense state must be cleared.
 */
export function makeContextKey(buildContext: BuildContext): string {
  return `${buildContext.modelId}::${buildContext.targetId}::${buildContext.componentId}`;
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
  buildContext: BuildContext,
  artifactsRoot: string
): ArtifactResolutionInputs | undefined {
  const entries = findManifestEntries(manifest, buildContext);
  if (!entries) {
    return undefined;
  }
  const { model, target, component } = entries;

  return {
    artifactsRoot,
    modelId: buildContext.modelId,
    artifactFolder: model.artifactFolder,
    componentId: buildContext.componentId,
    artifactName: component.artifactName,
    targetId: buildContext.targetId,
    artifactSuffix: target.artifactSuffix ?? "",
    executableExtension: target.executableExtension ?? "",
  };
}

// ---------------------------------------------------------------------------
// Artifact kinds
// ---------------------------------------------------------------------------

/**
 * The file artifacts resolved per build context. The executable shares the
 * on-disk file traits (path formula, existence, mtime); its debug layer —
 * profile gating and the extra `ExecutableArtifact` fields — sits on top in
 * `resolveExecutableArtifact`.
 */
export type ArtifactKind = "compile-commands" | "binary" | "map" | "executable";

/** Canonical on-disk extension per fixed-extension artifact kind. */
const ARTIFACT_EXTENSIONS: Record<Exclude<ArtifactKind, "executable">, string> = {
  "compile-commands": ".cc.json",
  binary: ".bin",
  map: ".map",
};

/** The executable's extension is target-defined; the others are fixed. */
function artifactExtension(kind: ArtifactKind, inputs: ArtifactResolutionInputs): string {
  return kind === "executable" ? inputs.executableExtension ?? "" : ARTIFACT_EXTENSIONS[kind];
}

/** The artifact record type each kind resolves to. */
export interface ArtifactsByKind {
  readonly "compile-commands": ResolvedArtifact;
  readonly binary: ResolvedArtifact;
  readonly map: ResolvedArtifact;
  readonly executable: ExecutableArtifact;
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

/** Expected on-disk path for the given artifact kind, or `undefined` when underivable. */
export function deriveArtifactPath(
  kind: ArtifactKind,
  inputs: ArtifactResolutionInputs
): string | undefined {
  return deriveArtifactPathWithExtension(inputs, artifactExtension(kind, inputs));
}

// ---------------------------------------------------------------------------
// Binary / Map artifact status resolution
// ---------------------------------------------------------------------------

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
 * Resolves one on-disk artifact's status for the given kind and inputs.
 *
 * - Returns `status: "present"` only when the exact expected file exists.
 * - Returns `status: "missing"` in all other cases: when the path cannot be
 *   derived (missing fields) or when the file does not exist on disk.
 * - Does not fall back to any other artifact path.
 *
 * The kind names the artifact in missing-reason messages
 * (e.g. "binary" -> "Binary artifact not found ...").
 */
export function resolveArtifact(
  kind: ArtifactKind,
  inputs: ArtifactResolutionInputs,
  buildContext: BuildContext
): ResolvedArtifact {
  const label = kind;
  const contextKey = makeContextKey(buildContext);
  const artifactPath = deriveArtifactPath(kind, inputs);

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
      status: "present" as const,
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

/** User-visible executable artifact state for the active build context. */
export interface ExecutableArtifact extends ResolvedArtifact {
  readonly profileResolutionState: DebugProfileResolutionState | "manifest-invalid";
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
 * Resolves the active executable artifact state for the given manifest, buildContext,
 * and artifacts root.
 *
 * - Returns `status: "present"` only when the first matching component debug profile
 *   is found, its derived executable file exists on disk, and the manifest has no
 *   debug-blocking validation errors.
 * - Returns `status: "missing"` for all other cases with an explanatory reason.
 */
export function resolveExecutableArtifact(
  manifest: ManifestStateLoaded,
  buildContext: BuildContext,
  artifactsRoot: string
): ExecutableArtifact {
  const contextKey = makeContextKey(buildContext);

  if (manifest.hasDebugBlockingIssues) {
    return {
      contextKey,
      profileResolutionState: "manifest-invalid",
      path: "",
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

  const component = manifest.components.find((c) => c.id === buildContext.componentId);
  const target = manifest.targets.find((t) => t.id === buildContext.targetId);
  const model = manifest.models.find((m) => m.id === buildContext.modelId);

  if (!component || !target || !model) {
    const reason = "Active configuration references an unknown component, target, or model.";
    return {
      contextKey,
      profileResolutionState: "no-match",
      path: "",
      exists: false,
      status: "missing",
      missingReason: reason,
      tooltip: formatExecutableArtifactTooltip("", reason),
      matchingProfileCount: 0,
    };
  }

  const profiles = component.debug ?? [];
  const matchingSet = resolveMatchingDebugProfiles(profiles, buildContext);

  if (!matchingSet.defaultProfile) {
    return {
      contextKey,
      profileResolutionState: "no-match",
      path: "",
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

  // Profile resolved — the executable-specific missing-field messages stay
  // here; the on-disk resolution is the shared file-artifact logic.
  if (!artifactsRoot || !model.artifactFolder || !component.artifactName) {
    let reason: string;
    if (!artifactsRoot) {
      reason = "[paths].build-artifacts is empty in tbench.toml; cannot resolve the executable artifact.";
    } else if (!model.artifactFolder) {
      reason = "The active model does not define artifactFolder in the manifest; cannot resolve the executable artifact.";
    } else {
      reason = "The active component does not define artifactName in the manifest; cannot resolve the executable artifact.";
    }
    return {
      contextKey,
      profileResolutionState: "selected",
      path: "",
      exists: false,
      status: "missing",
      missingReason: reason,
      tooltip: formatExecutableArtifactTooltip("", reason),
      matchingProfileCount: matchingSet.profiles.length,
    };
  }

  const base = resolveArtifact(
    "executable",
    {
      artifactsRoot,
      modelId: buildContext.modelId,
      artifactFolder: model.artifactFolder,
      componentId: buildContext.componentId,
      artifactName: component.artifactName,
      targetId: buildContext.targetId,
      artifactSuffix: target.artifactSuffix ?? "",
      executableExtension: target.executableExtension ?? "",
    },
    buildContext
  );

  return {
    ...base,
    profileResolutionState: "selected",
    tooltip: formatExecutableArtifactTooltip(base.path, base.missingReason),
    matchingProfileCount: matchingSet.profiles.length,
  };
}
