# tf-tools Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-11

## Active Technologies
- TypeScript 5.x targeting VS Code 1.105+ desktop extension host + VS Code Extension API, existing `yaml` parser for range-aware manifest parsing, Node.js path/process APIs, Mocha test runner, `@vscode/test-electron` for integration tests (002-build-workflow)
- Manifest file for build-option definitions and availability rules, workspace state for active build context plus build-option selections, VS Code settings for workspace paths and visibility, output channel and diagnostics collection for failure reporting (002-build-workflow)
- TypeScript 5.x targeting VS Code 1.105+ desktop extension host + VS Code Extension API, existing `yaml` parser for range-aware manifest parsing, Node.js `fs`/`path` APIs, existing diagnostics and output-channel helpers, Mocha test runner, `@vscode/test-electron` for integration tests (003-intellisense-integration)
- Manifest file for artifact metadata and provider-facing context, workspace state for active model/target/component selection, VS Code resource-scoped settings for manifest and artifacts paths plus provider selection state, and output channel logging for runtime failure reporting (003-intellisense-integration)
- TypeScript 5.x targeting VS Code 1.105+ desktop extension host + VS Code Extension API, existing tree-view implementation in `src/ui/configuration-tree.ts`, Mocha test runner, `@vscode/test-electron` integration harness already present in the repository (001-configuration-experience)
- No storage changes; this fix affects only derived tree item state (001-configuration-experience)
- TypeScript 5.x targeting VS Code 1.105+ desktop extension host + VS Code Extension API, existing `yaml` parser-backed manifest model, Node.js `fs` and `path` APIs, cpptools custom configuration provider API exposed by `ms-vscode.cpptools`, Mocha test runner, `@vscode/test-electron` integration harness (003-intellisense-integration)
- Workspace state for active model, target, and component selection; resource-scoped VS Code settings for `tfTools.artifactsPath` and `C_Cpp.default.configurationProvider`; manifest file fields for `artifactFolder`, `artifactName`, and `artifactSuffix`; output-channel logs for persistent warning and duplicate-entry reporting (003-intellisense-integration)
- TypeScript 5.x targeting VS Code 1.105+ desktop extension host + VS Code Extension API, existing IntelliSense payload parser and service, existing manifest/settings helpers, Node.js `path` APIs, `minimatch` for constrained glob evaluation, Mocha test runner, `@vscode/test-electron` integration harness (004-excluded-file-visibility)
- Resource-scoped VS Code settings for `tfTools.excludedFiles.grayInTree`, `tfTools.excludedFiles.showEditorOverlay`, `tfTools.excludedFiles.fileNamePatterns`, and `tfTools.excludedFiles.folderGlobs`; existing active compile-database payload held in extension memory; no new persisted workspace state (004-excluded-file-visibility)
- TypeScript 5.x targeting VS Code 1.105+ desktop extension host + VS Code Extension API, existing manifest parser and when-expression evaluator, existing task-execution helpers, existing artifact-resolution helper module, Node.js `fs` and `path` APIs, Mocha test runner, `@vscode/test-electron` integration harness (005-flash-upload-actions)
- Existing manifest file and resource-scoped settings (`tfTools.artifactsPath`, `tfTools.manifestPath`, `tfTools.cargoWorkspacePath`, `tfTools.taskExtraEnv`), existing workspace-state active configuration, and extension-memory artifact/action state; no new persisted workspace state required (005-flash-upload-actions)
- TypeScript 5.x targeting VS Code 1.105+ desktop extension host + VS Code Extension API, existing `yaml`-backed manifest parser and `when` evaluator, existing artifact-resolution and log-channel helpers, Node.js `fs` and `path` APIs, `jsonc-parser` for debugger template files, Mocha test runner, `@vscode/test-electron` integration harness (006-debug-launch)
- Existing manifest file plus new `debug` entries, existing workspace-state active model/target/component selection, resource-scoped VS Code settings for `tfTools.manifestPath`, `tfTools.artifactsPath`, and `tfTools.debug.templatesPath`, and extension-memory debug availability and artifact state; no new persisted workspace state required (006-debug-launch)
- TypeScript 5.x targeting VS Code 1.105+ desktop extension host + VS Code Extension API, existing `yaml` parser, existing `when` parser and evaluator, Node.js `fs` and `path` APIs, `jsonc-parser`, Mocha test runner, `@vscode/test-electron` (006-debug-launch)
- Existing manifest file; resource-scoped VS Code settings for `tfTools.manifestPath`, `tfTools.artifactsPath`, and `tfTools.debug.templatesPath`; existing workspace-state active model/target/component selection; extension-memory executable-state and debug-availability snapshots; no new persisted workspace state (006-debug-launch)
- TypeScript 5.x targeting VS Code 1.105+ + VS Code Extension API, existing `yaml` parser-backed manifest model, existing `jsonc-parser` template loader, Node.js `fs`/`path` APIs, existing output-channel logging helpers (007-run-debug-integration)
- Existing workspace state for active build context, resource-scoped settings for manifest/artifacts/templates paths, manifest file debug entries, and extension-memory provider registration state; no new persisted user data required (007-run-debug-integration)

- TypeScript 5.x targeting VS Code 1.105+ desktop extension host + VS Code Extension API, `yaml` for range-aware manifest parsing, Node.js filesystem APIs, Mocha test runner, `@vscode/test-electron` for integration tests (001-configuration-experience)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.x targeting VS Code 1.105+ desktop extension host: Follow standard conventions

## Recent Changes
- task-extra-env: Added `tfTools.taskExtraEnv` for workflow task environment overrides and configuration variable resolution for string-based tf-tools settings (`src/workspace/configuration-variables.ts`, `specs/product-spec.md`)
- 007-run-debug-integration: Added TypeScript 5.x targeting VS Code 1.105+ + VS Code Extension API, existing `yaml` parser-backed manifest model, existing `jsonc-parser` template loader, Node.js `fs`/`path` APIs, existing output-channel logging helpers
- 006-debug-launch: Added TypeScript 5.x targeting VS Code 1.105+ desktop extension host + VS Code Extension API, existing `yaml` parser, existing `when` parser and evaluator, Node.js `fs` and `path` APIs, `jsonc-parser`, Mocha test runner, `@vscode/test-electron`
- 006-debug-launch: Added TypeScript 5.x targeting VS Code 1.105+ desktop extension host + VS Code Extension API, existing `yaml`-backed manifest parser and `when` evaluator, existing artifact-resolution and log-channel helpers, Node.js `fs` and `path` APIs, `jsonc-parser` for debugger template files, Mocha test runner, `@vscode/test-electron` integration harness


<!-- MANUAL ADDITIONS START -->
- String-based tf-tools settings support configuration variable references such as `${workspaceFolder}` and `${env:NAME}`; see `Extension Configuration` in `specs/product-spec.md`.
- Workflow tasks merge `tfTools.taskExtraEnv` on top of the VS Code session environment; see `workflow task environment` in `specs/glossary.md`.
- IntelliSense has two backends: Microsoft C/C++ (`cpptools`, preferred) and clangd (`llvm-vs-code-extensions.vscode-clangd`, fallback when cpptools cannot be used). The clangd backend maintains a managed compile database at `.tf-tools/compile_commands.json` plus a managed `.clangd` config and restarts clangd; see `IntelliSense` in `specs/product-spec.md` and `IntelliSense backend` / `managed compile database` in `specs/glossary.md`.
<!-- MANUAL ADDITIONS END -->
