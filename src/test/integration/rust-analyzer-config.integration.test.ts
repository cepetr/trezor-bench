import * as assert from "assert";
import * as vscode from "vscode";

interface CommandContribution {
  readonly command: string;
  readonly title: string;
  readonly category?: string;
}

interface MenuContribution {
  readonly command: string;
  readonly when?: string;
  readonly group?: string;
  readonly toggled?: string;
}

function contribution(): Record<string, unknown> {
  const extension = vscode.extensions.getExtension("cepetr.tbench");
  assert.ok(extension, "cepetr.tbench extension must be present");
  return extension.packageJSON.contributes as Record<string, unknown>;
}

suite("Rust Analyzer mode contributions", () => {
  test("contributes both mode commands in the Configuration view overflow without C/C++ conditions", () => {
    const commands = contribution().commands as CommandContribution[];
    const menus = contribution().menus as Record<string, MenuContribution[]>;
    const modeCommands = commands.filter((entry) => entry.command.startsWith("tbench.rustAnalyzer."));
    const menuEntries = (menus["view/title"] ?? []).filter((entry) => entry.command.startsWith("tbench.rustAnalyzer."));

    assert.deepStrictEqual(modeCommands, [
      { command: "tbench.rustAnalyzer.modelSpecific", title: "Rust Analyzer: Model Specific", category: "Trezor Bench" },
      { command: "tbench.rustAnalyzer.allFeatures", title: "Rust Analyzer: All Features", category: "Trezor Bench" },
    ]);
    assert.strictEqual(menuEntries.length, 2);
    for (const entry of menuEntries) {
      assert.ok(entry.when?.includes("view == tbench.configuration"));
      assert.ok(!entry.when?.includes("intelliSense"));
      assert.ok(!entry.when?.includes("cpptools"));
      assert.strictEqual(entry.group, "rust-analyzer@1");
    }
  });

  test("uses independent exclusive context keys so workspace restore remains visible after refresh failure", () => {
    const menus = contribution().menus as Record<string, MenuContribution[]>;
    const menuEntries = (menus["view/title"] ?? []).filter((entry) => entry.command.startsWith("tbench.rustAnalyzer."));

    assert.deepStrictEqual(menuEntries.map((entry) => entry.toggled), [
      "tbench.rustAnalyzerModelSpecific",
      "tbench.rustAnalyzerAllFeatures",
    ]);
  });
});