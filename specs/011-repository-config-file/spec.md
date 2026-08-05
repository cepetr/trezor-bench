# Feature Specification: Repository Configuration File

**Feature Branch**: `011-repository-config-file`

**Created**: 2026-08-05

**Status**: Draft

**Input**: User description: "New feature: repository-level configuration file"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Commit Repository Paths (Priority: P1)

As a workspace maintainer, I can commit a root-level `tf-tools.toml` that names the repository's cargo workspace, manifest, artifacts, debug templates, and preset inputs, so every contributor uses the repository-defined locations without local VS Code path configuration.

**Why this priority**: Repository-owned paths are the core value of the feature and enable all build, artifact, IntelliSense, debug, manifest, and preset workflows to follow the same checked-in configuration.

**Independent Test**: Open a single-root workspace with a valid `tf-tools.toml` whose five path entries point to distinguishable locations, then verify each dependent workflow uses its configured location.

**Acceptance Scenarios**:

1. **Given** a supported single-root workspace with a valid root-level `tf-tools.toml`, **When** the extension activates, **Then** it uses the configured repository paths for workflow tasks, manifest loading, build artifacts, debug templates, and both preset input files.
2. **Given** a configured path is relative, **When** the extension resolves it, **Then** it resolves from the workspace root.
3. **Given** a configured path is absolute, **When** the extension resolves it, **Then** it uses that absolute path unchanged.
4. **Given** a path value contains a VS Code variable reference, **When** the extension resolves it, **Then** it treats the reference as literal path text and does not expand it.

---

### User Story 2 - Work With Older Or Partial Repositories (Priority: P2)

As a user opening an older repository revision or a repository with only some paths configured, I can continue using the extension with established defaults for every absent configuration entry.

**Why this priority**: The extension must remain usable across supported repository revisions while maintainers adopt the new checked-in file incrementally.

**Independent Test**: Activate the extension with no `tf-tools.toml`, then with a file containing one path entry, and verify that the configured entry is used while every omitted entry uses its specified default.

**Acceptance Scenarios**:

1. **Given** `tf-tools.toml` is absent, **When** the extension activates, **Then** all five repository paths use their built-in defaults and workflows remain available under the same path assumptions as before.
2. **Given** a valid `tf-tools.toml` omits one or more `[paths]` entries, **When** the extension activates, **Then** each omitted entry independently uses its built-in default.
3. **Given** `cargo-workspace` is an empty string, **When** the extension resolves workflow-task location, **Then** it uses the workspace root.
4. **Given** `build-artifacts` is an empty string, **When** the extension refreshes artifacts and IntelliSense, **Then** artifact-based IntelliSense resolution is disabled.
5. **Given** `manifest`, `debug-templates`, or `xtask-presets` is an empty string, **When** the extension resolves that entry, **Then** it uses the entry's built-in default.

---

### User Story 3 - Correct Broken Configuration Without Reloading (Priority: P3)

As a user, I am clearly blocked when the repository configuration is invalid and can resume work as soon as its file is corrected, created, or deleted, without reloading the VS Code window.

**Why this priority**: An invalid checked-in configuration must not be silently confused with an older repository that simply has no configuration file.

**Independent Test**: Introduce malformed TOML and a wrong-typed path entry, observe the blocking error and unavailable workflows, then correct or remove the file and verify the extension re-resolves the configuration and recovers.

**Acceptance Scenarios**:

1. **Given** `tf-tools.toml` exists but cannot be parsed, **When** the extension reads it, **Then** it logs the error, shows a user-visible error, and blocks dependent extension workflows without falling back to defaults.
2. **Given** a `[paths]` entry has a non-string value, **When** the extension reads the file, **Then** it enters the same blocking error state and identifies the invalid configuration.
3. **Given** the extension is in a configuration error state, **When** `tf-tools.toml` is corrected, created, changed, or deleted, **Then** it re-reads the file, re-resolves all repository paths, and updates dependent state without a window reload.

### Edge Cases

- The extension continues to report the existing unsupported-workspace state when there is no workspace folder or more than one workspace folder; it does not search outside the single workspace root for configuration.
- An existing but unreadable `tf-tools.toml` is treated as a blocking configuration read error, not as an absent file.
- An empty `manifest`, `debug-templates`, or `xtask-presets` value uses that entry's built-in default.
- Unsupported keys under `[paths]` are ignored so a repository can retain unrelated or future metadata without blocking the extension.
- A configuration file is deleted while the extension is active: the extension immediately returns to the built-in defaults rather than retaining paths from the removed file.
- A configuration file is changed from valid to invalid, or invalid to valid: the extension respectively enters or leaves the blocking configuration state and does not retain stale resolved paths.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The extension MUST support repository configuration only for a single-root workspace and MUST read `tf-tools.toml` only from that workspace root.
- **FR-002**: The extension MUST read repository paths from the `[paths]` section using the entries `cargo-workspace`, `debug-templates`, `build-artifacts`, `manifest`, and `xtask-presets`.
- **FR-003**: The extension MUST use the following built-in defaults whenever `tf-tools.toml` or an individual `[paths]` entry is absent: `core/embed` for `cargo-workspace`, `core/embed/xtask/tf-tools/debug` for `debug-templates`, `core/build-xtask/artifacts` for `build-artifacts`, `core/embed/xtask/tf-tools/manifest.yaml` for `manifest`, and `core/embed/xtask` for `xtask-presets`.
- **FR-004**: The extension MUST resolve a relative repository path from the workspace root and MUST use an absolute repository path unchanged.
- **FR-005**: The extension MUST not expand VS Code variable references in `tf-tools.toml`; variable-reference-like text is interpreted as literal path content.
- **FR-006**: The extension MUST interpret an empty `cargo-workspace` value as the workspace root, an empty `build-artifacts` value as disabling artifact-based IntelliSense resolution, and an empty `manifest`, `debug-templates`, or `xtask-presets` value as that entry's built-in default.
- **FR-007**: The extension MUST use the resolved `xtask-presets` directory directly to locate `presets.toml` and `user-presets.toml`; it MUST NOT derive that directory from the cargo-workspace path.
- **FR-008**: The extension MUST replace the four VS Code path settings `tfTools.cargoWorkspacePath`, `tfTools.debug.templatesPath`, `tfTools.artifactsPath`, and `tfTools.manifestPath` with repository configuration and MUST remove those settings from the extension's settings surface.
- **FR-009**: The release notes MUST record removal of the four replaced VS Code path settings and MUST NOT provide a migration path for prior local customizations.
- **FR-010**: If `tf-tools.toml` exists but is unreadable, malformed, or has a `[paths]` entry that is not a string, the extension MUST log the error, show a user-visible error, block affected extension workflows, and MUST NOT use defaults or stale resolved paths.
- **FR-011**: The extension MUST watch the root-level `tf-tools.toml` for create, change, and delete events, and after each event it MUST re-read the configuration, re-resolve every repository path, and refresh all affected workflow, artifact, IntelliSense, manifest, debug, and preset state without requiring a window reload.
- **FR-012**: The extension MUST recover from a blocking repository-configuration error immediately after a valid replacement file is written or the invalid file is deleted, and MUST re-enter the blocking state if a valid file becomes invalid.
- **FR-013**: The extension MUST keep the existing VS Code settings for task environment, status-bar visibility, and excluded-file visibility and scope; this feature moves only repository-related paths out of VS Code settings.
- **FR-014**: The extension MUST ignore unsupported keys under `[paths]`, while continuing to reject a non-string value for every supported path entry.

### Key Entities *(include if feature involves data)*

- **Repository configuration file**: The optional root-level `tf-tools.toml` committed with the repository; its presence supplies repository paths and its absence selects built-in defaults.
- **Repository path entry**: One string-valued `[paths]` entry that identifies the cargo workspace, debug templates directory, artifacts root, manifest file, or presets directory.
- **Resolved repository configuration**: The complete effective set of five repository paths after applying a valid file's entries or the defaults for absent entries.
- **Repository configuration status**: The current state of the root-level configuration: absent and using defaults, valid and resolved, or invalid and blocking dependent extension workflows.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a valid single-root workspace, all five repository path consumers use the configured or default path on initial activation without a VS Code settings edit.
- **SC-002**: A partial `tf-tools.toml` correctly applies defaults independently for 100% of omitted `[paths]` entries.
- **SC-003**: In validation tests, 100% of malformed files and wrong-typed path entries produce an explicit blocking error and zero path consumers use a default or stale path while the invalid file remains present.
- **SC-004**: After creating, editing, correcting, or deleting `tf-tools.toml`, the extension reflects the resulting configuration state without a window reload in 100% of watcher-event test cases.
- **SC-005**: Contributors can configure all repository-dependent paths in one committed file, with no local VS Code path-setting prerequisite.

## Assumptions

- The root-level configuration file is optional so existing repository revisions remain supported through built-in defaults.
- The file may contain repository metadata outside `[paths]`; this feature validates the supported path entries and does not define behavior for unrelated content.
- The existing manifest, preset, artifact, debug, and workflow failure behavior remains unchanged after a valid repository configuration has supplied their paths.
- Documentation terminology is updated to describe repository configuration and no longer presents the four removed path settings as supported.
- A later implementation phase will add the automated unit and integration coverage required by the project constitution for path resolution, blocking errors, watcher-driven reloads, and recovery.