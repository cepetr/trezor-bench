/**
 * Shared helpers for Build Workflow unit and integration tests.
 *
 * Provides factory functions for constructing ManifestState objects with
 * build options so individual test files stay concise.
 */

import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import {
  ManifestStateLoaded,
  ManifestStateMissing,
  ManifestStateInvalid,
  BuildOption,
  WhenExpression,
  ManifestComponentDebugProfile,
} from "../../manifest/manifest-types";

// ---------------------------------------------------------------------------
// Manifest URI helpers
// ---------------------------------------------------------------------------

export function fixtureUri(relPath: string): vscode.Uri {
  return vscode.Uri.file(
    path.resolve(__dirname, "../../../test-fixtures", relPath)
  );
}

export function manifestUri(fixtureName: string): vscode.Uri {
  return fixtureUri(`manifests/${fixtureName}/tbench.yaml`);
}

// ---------------------------------------------------------------------------
// Manifest state factories
// ---------------------------------------------------------------------------

export function makeLoadedState(
  overrides: Partial<ManifestStateLoaded> = {}
): ManifestStateLoaded {
  return {
    status: "loaded",
    manifestUri: manifestUri("valid-basic"),
    models: [
      { kind: "model", id: "T2T1", name: "Trezor Model T (v1)" },
      { kind: "model", id: "T3W1", name: "Trezor Model T3 (w1)" },
    ],
    targets: [
      { kind: "target", id: "hw", name: "Hardware", shortName: "HW" },
      { kind: "target", id: "emu", name: "Emulator" },
    ],
    components: [
      { kind: "component", id: "core", name: "Core" },
      { kind: "component", id: "prodtest", name: "Prodtest" },
    ],
    buildOptions: [],
    hasWorkflowBlockingIssues: false,
    hasDebugBlockingIssues: false,
    validationIssues: [],
    loadedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function makeMissingState(
  over: Partial<ManifestStateMissing> = {}
): ManifestStateMissing {
  return {
    status: "missing",
    manifestUri: manifestUri("missing"),
    ...over,
  };
}

export function makeInvalidState(
  over: Partial<ManifestStateInvalid> = {}
): ManifestStateInvalid {
  return {
    status: "invalid",
    manifestUri: manifestUri("invalid-structure"),
    validationIssues: [
      { severity: "error", code: "empty-collection", message: "manifest must define at least one model" },
    ],
    loadedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Build option factories
// ---------------------------------------------------------------------------

export function makeCheckboxOption(
  overrides: Partial<BuildOption> & { key: string; label: string; flag: string }
): BuildOption {
  return {
    kind: "checkbox",
    group: undefined,
    description: undefined,
    when: undefined,
    ...overrides,
  };
}

export function makeMultistateOption(
  overrides: Partial<BuildOption> & {
    key: string;
    label: string;
    flag: string;
    states: BuildOption["states"];
    defaultState: string;
  }
): BuildOption {
  return {
    kind: "multistate",
    group: undefined,
    description: undefined,
    when: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// When expression helpers (mirrors WhenExpression type)
// ---------------------------------------------------------------------------

export function whenModel(id: string): WhenExpression {
  return { type: "model", id };
}

export function whenTarget(id: string): WhenExpression {
  return { type: "target", id };
}

export function whenComponent(id: string): WhenExpression {
  return { type: "component", id };
}

export function whenAll(...children: WhenExpression[]): WhenExpression {
  return { type: "all", children };
}

export function whenAny(...children: WhenExpression[]): WhenExpression {
  return { type: "any", children };
}

export function whenNot(child: WhenExpression): WhenExpression {
  return { type: "not", child };
}

// ---------------------------------------------------------------------------
// IntelliSense manifest state factories
//
// These are used by IntelliSense unit tests to create manifest states that
// include the extended artifactFolder / artifactName / artifactSuffix
// fields required by the IntelliSense slice.
// ---------------------------------------------------------------------------

/** Returns a loaded manifest state fixture with IntelliSense artifact fields. */
export function makeIntelliSenseLoadedState(
  overrides: Partial<ManifestStateLoaded> = {}
): ManifestStateLoaded {
  return {
    status: "loaded",
    manifestUri: manifestUri("intellisense-valid"),
    models: [
      { kind: "model", id: "T2T1", name: "Trezor Model T (v1)", artifactFolder: "model-t" } as ManifestStateLoaded["models"][0],
      { kind: "model", id: "T3W1", name: "Trezor Model T3 (w1)", artifactFolder: "model-t3" } as ManifestStateLoaded["models"][0],
    ],
    targets: [
      { kind: "target", id: "hw", name: "Hardware", shortName: "HW" },
      { kind: "target", id: "emu", name: "Emulator", artifactSuffix: "_emu" } as ManifestStateLoaded["targets"][0],
    ],
    components: [
      { kind: "component", id: "core", name: "Core", artifactName: "compile_commands_core" } as ManifestStateLoaded["components"][0],
      { kind: "component", id: "prodtest", name: "Prodtest", artifactName: "compile_commands_prodtest" } as ManifestStateLoaded["components"][0],
    ],
    buildOptions: [],
    hasWorkflowBlockingIssues: false,
    hasDebugBlockingIssues: false,
    validationIssues: [],
    loadedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Compile-commands fixture paths
//
// Used by parser and provider unit tests to locate test fixtures on disk.
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the compile-commands fixture file for the
 * given model, component, and optional suffix.
 * Mirrors the artifact-path formula used by `deriveArtifactPath`.
 */
export function compileCommandsFixturePath(
  artifactFolder: string,
  artifactName: string,
  artifactSuffix: string = ""
): string {
  return path.resolve(
    __dirname,
    "../../../test-fixtures/workspaces/intellisense-valid/artifacts",
    artifactFolder,
    `${artifactName}${artifactSuffix}.cc.json`
  );
}

/** Shorthand for the primary T2T1/core/hw compile-commands fixture. */
export function primaryCoreFixturePath(): string {
  return compileCommandsFixturePath("model-t", "compile_commands_core");
}

/** Shorthand for the T2T1/core/emu (suffixed) fixture. */
export function emuCoreFixturePath(): string {
  return compileCommandsFixturePath("model-t", "compile_commands_core", "_emu");
}

/** Shorthand for the T2T1/prodtest/hw compile-commands fixture. */
export function prodtestFixturePath(): string {
  return compileCommandsFixturePath("model-t", "compile_commands_prodtest");
}

// ---------------------------------------------------------------------------
// Compile-commands JSON fixture loader
//
// Reads the raw JSON array from a compile-commands fixture file and returns
// it parsed. Tests can use this to verify parser output against the same data.
// ---------------------------------------------------------------------------

export type RawCompileEntry = {
  directory: string;
  command?: string;
  arguments?: string[];
  file: string;
};

/** Loads and parses a compile-commands JSON file at the given path. */
export function loadCompileCommandsFixture(fixturePath: string): RawCompileEntry[] {
  const raw = fs.readFileSync(fixturePath, "utf-8");
  return JSON.parse(raw) as RawCompileEntry[];
}

// ---------------------------------------------------------------------------
// Excluded-file fixture paths
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the root of the excluded-files-scope workspace
 * fixture used by excluded-file visibility unit tests.
 */
export function excludedFilesScopeWorkspaceRoot(): string {
  return path.resolve(__dirname, "../../../test-fixtures/workspaces/excluded-files-scope");
}

/**
 * Returns the absolute path to the compile-commands artifact inside the
 * excluded-files-scope workspace fixture.
 */
export function excludedFilesScopeArtifactPath(): string {
  return path.join(
    excludedFilesScopeWorkspaceRoot(),
    "artifacts/model-t/compile_commands_core.cc.json"
  );
}

// ---------------------------------------------------------------------------
// Excluded-file settings factories
// ---------------------------------------------------------------------------

export interface ExcludedFilesSettingsFixture {
  grayInTree: boolean;
  showEditorOverlay: boolean;
  fileNamePatterns: string[];
  folderGlobs: string[];
}

/**
 * Returns a default excluded-file settings fixture matching the contract defaults.
 * Individual fields can be overridden.
 */
export function makeExcludedFilesSettings(
  overrides: Partial<ExcludedFilesSettingsFixture> = {}
): ExcludedFilesSettingsFixture {
  return {
    grayInTree: true,
    showEditorOverlay: true,
    fileNamePatterns: ["*.c"],
    folderGlobs: ["core/embed/**", "core/vendor/**"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Excluded-file snapshot factories
// ---------------------------------------------------------------------------

export interface ExcludedFilesSnapshotFixture {
  contextKey: string;
  artifactPath: string | null;
  settings: ExcludedFilesSettingsFixture;
  includedFiles: Set<string>;
  excludedFiles: Set<string>;
}

/**
 * Returns a minimal excluded-files snapshot fixture with no excluded files.
 * Individual fields can be overridden for specific test scenarios.
 */
export function makeExcludedFilesSnapshot(
  overrides: Partial<ExcludedFilesSnapshotFixture> = {}
): ExcludedFilesSnapshotFixture {
  return {
    contextKey: "T2T1/hw/core",
    artifactPath: excludedFilesScopeArtifactPath(),
    settings: makeExcludedFilesSettings(),
    includedFiles: new Set<string>(),
    excludedFiles: new Set<string>(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Debug launch profile factories
// ---------------------------------------------------------------------------

/**
 * Returns a minimal ManifestComponentDebugProfile fixture.
 * Individual fields can be overridden for specific test scenarios.
 */
export function makeComponentDebugProfile(
  overrides: { name: string; template: string } & Partial<ManifestComponentDebugProfile>
): ManifestComponentDebugProfile {
  const componentId = overrides.componentId ?? "core";
  const declarationIndex = overrides.declarationIndex ?? 0;
  return {
    id: overrides.id ?? `${componentId}:debug[${declarationIndex}]`,
    componentId,
    name: overrides.name,
    template: overrides.template,
    when: overrides.when,
    vars: overrides.vars,
    declarationIndex,
  };
}

/**
 * Returns a target fixture that includes an executableExtension field.
 */
export function makeDebugTargetWithExtension(
  id: string,
  executableExtension: string,
  artifactSuffix?: string
): ManifestStateLoaded["targets"][0] {
  return {
    kind: "target",
    id,
    name: id,
    artifactSuffix,
    executableExtension,
  } as ManifestStateLoaded["targets"][0];
}

/**
 * Returns a loaded manifest state that includes component-scoped debug profiles.
 * All profiles are attached to their respective components by componentId.
 * If a profile's componentId does not match an existing component, it is ignored.
 */
export function makeDebugLoadedState(
  debugProfiles: ManifestComponentDebugProfile[] = [],
  overrides: Partial<ManifestStateLoaded> = {}
): ManifestStateLoaded {
  const base = makeIntelliSenseLoadedState(overrides);
  // Attach debug profiles to matching components
  const components = base.components.map((c) => {
    const profiles = debugProfiles.filter((profile) => profile.componentId === c.id);
    if (profiles.length === 0) {
      return c;
    }
    return { ...c, debug: profiles };
  });
  return { ...base, components, hasDebugBlockingIssues: overrides.hasDebugBlockingIssues ?? false };
}

/**
 * Returns the absolute path to the debug-launch-valid workspace fixture root.
 */
export function debugLaunchValidWorkspaceRoot(): string {
  return path.resolve(__dirname, "../../../test-fixtures/workspaces/debug-launch-valid");
}

/**
 * Returns the absolute path to the debug-launch-failures workspace fixture root.
 */
export function debugLaunchFailuresWorkspaceRoot(): string {
  return path.resolve(__dirname, "../../../test-fixtures/workspaces/debug-launch-failures");
}

/**
 * Returns the absolute path to the debug templates root inside the valid workspace fixture.
 */
export function debugLaunchValidTemplatesRoot(): string {
  return path.join(debugLaunchValidWorkspaceRoot(), "debug-templates");
}

// ---------------------------------------------------------------------------
// Run and Debug matching-set fixture helpers
// ---------------------------------------------------------------------------

/**
 * Returns a loaded manifest state with a single-profile component (core) and
 * a multi-profile component (prodtest).
 *
 * Matching-set for prodtest + T2T1 + hw: [entry[0], entry[1], entry[2]] (3 profiles)
 * Matching-set for prodtest + T2T1 + emu: [entry[0], entry[2]] (2 profiles)
 * Matching-set for prodtest + T3W1 + hw: [entry[1], entry[2]] (2 profiles)
 * Matching-set for prodtest + T3W1 + emu: [entry[2]] (1 profile)
 */
export function makeRunDebugMultiProfileState(
  overrides: Partial<ManifestStateLoaded> = {}
): ManifestStateLoaded {
  const base = makeIntelliSenseLoadedState();

  const coreProfile: ManifestComponentDebugProfile = makeComponentDebugProfile({
    id: "core:debug[0]",
    componentId: "core",
    name: "GDB Remote",
    template: "gdb-remote.json",
    declarationIndex: 0,
    when: { type: "model", id: "T2T1" },
  });

  const prodtestProfile0: ManifestComponentDebugProfile = makeComponentDebugProfile({
    id: "prodtest:debug[0]",
    componentId: "prodtest",
    name: "GDB Remote (T2T1)",
    template: "gdb-remote.json",
    declarationIndex: 0,
    when: { type: "model", id: "T2T1" },
  });

  const prodtestProfile1: ManifestComponentDebugProfile = makeComponentDebugProfile({
    id: "prodtest:debug[1]",
    componentId: "prodtest",
    name: "GDB Remote (HW)",
    template: "gdb-remote.json",
    declarationIndex: 1,
    when: { type: "target", id: "hw" },
  });

  const prodtestProfile2: ManifestComponentDebugProfile = makeComponentDebugProfile({
    id: "prodtest:debug[2]",
    componentId: "prodtest",
    name: "GDB Remote (any)",
    template: "gdb-remote.json",
    declarationIndex: 2,
  });

  const components = base.components.map((c) => {
    if (c.id === "core") {
      return { ...c, artifactName: "compile_commands_core", debug: [coreProfile] };
    }
    if (c.id === "prodtest") {
      return { ...c, artifactName: "compile_commands_prodtest", debug: [prodtestProfile0, prodtestProfile1, prodtestProfile2] };
    }
    return c;
  });

  return {
    ...base,
    components,
    hasDebugBlockingIssues: false,
    ...overrides,
  };
}

/**
 * Proxy config shape produced by RunDebugConfigProvider.
 */
export interface TbenchProxyConfig {
  type: "tbench";
  request: "launch";
  name: string;
  tbenchMode: "default" | "profile";
  tbenchProfileId: string;
  tbenchContextKey: string;
}

/**
 * Returns true when a debug configuration matches the tbench proxy shape.
 */
export function isTbenchProxyConfig(config: Record<string, unknown>): boolean {
  return (
    config["type"] === "tbench" &&
    config["request"] === "launch" &&
    typeof config["name"] === "string" &&
    (config["tbenchMode"] === "default" || config["tbenchMode"] === "profile") &&
    typeof config["tbenchProfileId"] === "string" &&
    typeof config["tbenchContextKey"] === "string"
  );
}
