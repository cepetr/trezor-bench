import * as assert from "assert";
import { formatStatusBarText, StatusBarPresenter } from "../../../ui/status-bar";
import { ManifestStateLoaded, ManifestStateMissing } from "../../../manifest/manifest-types";
import { BuildSelection } from "../../../build/build-selection";
import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLoadedState(
  overrides: Partial<ManifestStateLoaded> = {}
): ManifestStateLoaded {
  return {
    status: "loaded",
    manifestUri: vscode.Uri.file("/workspace/tbench.yaml"),
    models: [
      { kind: "model", id: "T2T1", name: "Trezor Model T" },
      { kind: "model", id: "T3W1", name: "Trezor Model T3" },
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
    debugProfiles: [],
    hasDebugBlockingIssues: false,
    validationIssues: [],
    loadedAt: new Date(),
    ...overrides,
  } as ManifestStateLoaded;
}

function config(
  modelId: string,
  targetId: string,
  componentId: string
): BuildSelection {
  return { modelId, targetId, componentId, persistedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Suite: formatStatusBarText – text formatting
// ---------------------------------------------------------------------------

suite("formatStatusBarText – text formatting", () => {
  test("uses target shortName when present", () => {
    const text = formatStatusBarText(makeLoadedState(), config("T2T1", "hw", "core"));
    assert.ok(text?.includes("HW"), `expected 'HW' in ${String(text)}`);
    assert.ok(!text?.includes("Hardware"), `expected no 'Hardware' when shortName is present`);
  });

  test("falls back to target name when shortName is absent", () => {
    const text = formatStatusBarText(makeLoadedState(), config("T2T1", "emu", "core"));
    assert.ok(text?.includes("Emulator"), `expected 'Emulator' in ${String(text)}`);
  });

  test("formats text as {model-name} | {target-display} | {component-name}", () => {
    const text = formatStatusBarText(makeLoadedState(), config("T2T1", "hw", "core"));
    assert.strictEqual(text, "Trezor Model T | HW | Core");
  });

  test("uses component name (not id) in the formatted string", () => {
    const text = formatStatusBarText(makeLoadedState(), config("T2T1", "hw", "prodtest"));
    assert.ok(text?.endsWith("Prodtest"), `expected component name 'Prodtest' at end: ${String(text)}`);
  });

  test("uses model name (not id) in the formatted string", () => {
    const text = formatStatusBarText(makeLoadedState(), config("T3W1", "emu", "core"));
    assert.ok(text?.startsWith("Trezor Model T3"), `expected model name 'Trezor Model T3' at start: ${String(text)}`);
    assert.ok(!text?.includes("T3W1"), "expected model id not to appear");
  });

  test("second entry values produce a correctly formatted string", () => {
    const text = formatStatusBarText(makeLoadedState(), config("T3W1", "emu", "prodtest"));
    assert.strictEqual(text, "Trezor Model T3 | Emulator | Prodtest");
  });
});

// ---------------------------------------------------------------------------
// Suite: formatStatusBarText – unresolvable ids
// ---------------------------------------------------------------------------

suite("formatStatusBarText – unresolvable ids", () => {
  test("returns undefined when modelId does not resolve", () => {
    const text = formatStatusBarText(makeLoadedState(), config("MISSING", "hw", "core"));
    assert.strictEqual(text, undefined);
  });

  test("returns undefined when targetId does not resolve", () => {
    const text = formatStatusBarText(makeLoadedState(), config("T2T1", "MISSING", "core"));
    assert.strictEqual(text, undefined);
  });

  test("returns undefined when componentId does not resolve", () => {
    const text = formatStatusBarText(makeLoadedState(), config("T2T1", "hw", "MISSING"));
    assert.strictEqual(text, undefined);
  });
});

// ---------------------------------------------------------------------------
// Suite: StatusBarPresenter
// ---------------------------------------------------------------------------

/** Status-bar item stub that records show/hide/dispose calls. */
interface StatusBarItemStub {
  text: string;
  command: string | undefined;
  visible: boolean;
  disposed: boolean;
  show(): void;
  hide(): void;
  dispose(): void;
}

function makeItemStub(): StatusBarItemStub {
  return {
    text: "",
    command: undefined,
    visible: false,
    disposed: false,
    show() {
      this.visible = true;
    },
    hide() {
      this.visible = false;
    },
    dispose() {
      this.disposed = true;
    },
  };
}

// The vscode-mock exposes `window.createStatusBarItem` as a replaceable
// function; we swap it per suite to capture the item the presenter creates.
const windowMock = (vscode as unknown as {
  window: { createStatusBarItem: (alignment?: number, priority?: number) => unknown };
}).window;

suite("StatusBarPresenter", () => {
  let originalCreate: typeof windowMock.createStatusBarItem;
  let item: StatusBarItemStub;

  setup(() => {
    originalCreate = windowMock.createStatusBarItem;
    item = makeItemStub();
    windowMock.createStatusBarItem = () => item;
  });

  teardown(() => {
    windowMock.createStatusBarItem = originalCreate;
  });

  function makeMissingState(): ManifestStateMissing {
    return { status: "missing", manifestUri: vscode.Uri.file("/workspace/tbench.yaml") };
  }

  test("wires the configuration-focus command on construction", () => {
    const presenter = new StatusBarPresenter();
    assert.strictEqual(item.command, "tbench.configuration.focus");
    presenter.dispose();
  });

  test("shows the formatted text for a resolvable configuration", () => {
    const presenter = new StatusBarPresenter();
    presenter.update(makeLoadedState(), config("T2T1", "hw", "core"), true);

    assert.strictEqual(item.visible, true);
    assert.strictEqual(item.text, "$(symbol-field) Trezor Model T | HW | Core");
    presenter.dispose();
  });

  test("hides the item when the manifest is not loaded", () => {
    const presenter = new StatusBarPresenter();
    presenter.update(makeLoadedState(), config("T2T1", "hw", "core"), true);
    presenter.update(makeMissingState(), config("T2T1", "hw", "core"), true);

    assert.strictEqual(item.visible, false);
    presenter.dispose();
  });

  test("hides the item when there is no active configuration", () => {
    const presenter = new StatusBarPresenter();
    presenter.update(makeLoadedState(), config("T2T1", "hw", "core"), true);
    presenter.update(makeLoadedState(), undefined, true);

    assert.strictEqual(item.visible, false);
    presenter.dispose();
  });

  test("hides the item when the setting is disabled", () => {
    const presenter = new StatusBarPresenter();
    presenter.update(makeLoadedState(), config("T2T1", "hw", "core"), false);

    assert.strictEqual(item.visible, false);
    presenter.dispose();
  });

  test("hides the item when the configuration ids do not resolve", () => {
    const presenter = new StatusBarPresenter();
    presenter.update(makeLoadedState(), config("T2T1", "hw", "core"), true);
    presenter.update(makeLoadedState(), config("MISSING", "hw", "core"), true);

    assert.strictEqual(item.visible, false);
    presenter.dispose();
  });

  test("dispose() disposes the underlying status-bar item", () => {
    const presenter = new StatusBarPresenter();
    presenter.dispose();

    assert.strictEqual(item.disposed, true);
  });
});
