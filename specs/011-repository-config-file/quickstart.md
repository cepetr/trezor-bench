# Quickstart: Validate Repository Configuration

## Prerequisites

- Node.js dependencies installed with `npm install`.
- A single-root VS Code workspace.
- The extension test host available through the existing test command.

## Automated Validation

Run the focused repository-configuration unit and integration tests after implementation:

```bash
npm run compile
npm run test:unit -- --grep "Repository configuration"
npm test
npm run lint
```

The tests must cover the paths and states in [data-model.md](data-model.md) and the file contract in [contracts/tf-tools-toml.md](contracts/tf-tools-toml.md): valid full and partial files, defaults, absolute and relative paths, literal variable references, every defined empty-value case, malformed TOML, wrong types, diagnostics/logging, create/change/delete reload, and invalid-to-valid or invalid-to-absent recovery.

## Manual Extension-Host Scenario

1. Open a supported single-root fixture workspace with a root-level `tf-tools.toml` whose paths differ from the defaults.
2. Activate Trezor Firmware Tools and verify manifest loading, the preset selector, artifact state, workflow task working directory, and debug-template lookup use the configured locations.
3. Change one path and verify the affected manifest, presets, artifacts/IntelliSense, or debug state refreshes without reloading the window.
4. Replace the file with malformed TOML and verify that Problems reports `tf-tools.toml`, the output channel records the error, an error notification appears, and workflows cannot use prior paths.
5. Correct the file, then delete it, verifying recovery first to configured paths and then to built-in defaults without a window reload.

## Expected Outcome

Repository layout is controlled by the checked-in root-level file. The four removed VS Code path settings do not appear in extension configuration, while task environment and visibility/excluded-file settings remain available.