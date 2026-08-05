# Implementation Plan: Repository Configuration File

**Branch**: `011-repository-config-file` | **Date**: 2026-08-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from [spec.md](spec.md)

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

Replace the four repository-path VS Code settings with an optional root-level `tf-tools.toml`. Add one TOML-backed repository-configuration service that resolves a complete immutable snapshot, reports absent/loaded/invalid state, watches the file, and atomically drives manifest, preset, artifact/IntelliSense, debug-template, and workflow-task path consumers. A present invalid configuration is an explicit diagnostic, log, notification, and workflow-blocking state; no default or stale paths remain active until it is corrected or removed.

## Technical Context

**Language/Version**: TypeScript 5.8 targeting VS Code 1.105+ extension host

**Primary Dependencies**: VS Code Extension API, existing `smol-toml`, Node.js `fs`/`path`

**Storage**: Optional committed root-level `tf-tools.toml`; existing workspace state remains limited to active configuration and selections

**Testing**: Mocha unit tests, `@vscode/test-electron` integration tests, `npm run lint`

**Target Platform**: VS Code desktop extension host on supported single-root workspaces

**Project Type**: Single-package desktop extension

**Performance Goals**: Resolve configuration during activation and apply debounced file changes without requiring a window reload; no continuous poller is needed for the root-level workspace file

**Constraints**: Repository configuration must not expand VS Code variables; an existing invalid file blocks all path-dependent workflows and must not retain stale paths; only the four specified path settings are removed

**Scale/Scope**: One optional file, five repository path entries, six dependent runtime areas, and focused unit plus extension-host integration coverage

## Constitution Check

*GATE: Passed before Phase 0 research; re-checked after Phase 1 design and passed.*

| Principle | Plan compliance |
| --- | --- |
| TypeScript Extension First | Implementation remains TypeScript and uses stable VS Code 1.105+ file-system, diagnostic, and extension APIs. |
| Manifest-Driven Behavior | Repository configuration becomes the authoritative source for the manifest and other repository paths. Invalid configuration clears state rather than silently retaining an alternate source. |
| Tests Are Mandatory | Unit tests cover TOML parsing, defaults, resolution, literals, and invalid entry types. Integration tests cover watcher lifecycle, diagnostics, blocking, and recovery. |
| Failures Must Be Visible | Invalid present files publish diagnostics on `tf-tools.toml`, log contextual errors to `Trezor Firmware Tools`, show an error notification, and block commands. |
| Keep It Small And Clear | One configuration service and snapshot replace scattered path reads. This is necessary to apply all five paths consistently across reloads; no compatibility layer or new package is added. |

**Affected product areas**: `Extension Configuration`, `Startup And Refresh Behavior`, `Compile Commands And Provider Integration`, `Workflow Actions`, preset handling, and debug launch.

**Required glossary terms**: repository configuration file, repository configuration status, workspace root, manifest path, artifacts root, debug templates path, preset, diagnostic, log output, and user-visible error.

## Project Structure

### Documentation (this feature)

```text
specs/011-repository-config-file/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── extension.ts                               # Owns snapshot application and command gating
├── workspace/
│   ├── repository-configuration.ts            # New TOML parser, resolver, state, watcher
│   └── settings.ts                             # Retains non-repository VS Code settings only
├── manifest/manifest-service.ts                # Restarted with resolved manifest URI
├── presets/preset-service.ts                   # Restarted with resolved preset input URIs
├── intellisense/                               # Receives resolved artifacts root and cleared state
├── debug/run-debug-provider.ts                 # Receives resolved debug templates path
└── observability/
  ├── diagnostics.ts                          # Publishes and clears configuration diagnostics
  └── log-channel.ts                          # Records configuration state transitions

src/test/
├── unit/workspace/repository-configuration.test.ts
├── unit/presets/preset-paths.test.ts
├── unit/workspace/configuration-variables.test.ts
└── integration/repository-configuration.integration.test.ts

test-fixtures/workspaces/
└── repository-configuration-*/                # Valid, partial, invalid, and default-path fixtures

package.json                                    # Removes four contributed path settings
CHANGELOG.md                                    # Records removed settings without migration
specs/product-spec.md                           # Maintains repository-config behavior contract
specs/glossary.md                               # Maintains preferred configuration terminology
```

**Structure Decision**: Keep the existing single extension package. Add the repository-configuration service under `src/workspace` because it owns workspace-root file resolution and is the sole replacement for repository-path setting helpers. `extension.ts` remains the only orchestration point for restarting dependent services and clearing blocked state.

## Complexity Tracking

No constitution violations or complexity exceptions.
