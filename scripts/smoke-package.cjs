const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function fail(message) {
  console.error(`Smoke check failed: ${message}`);
  process.exit(1);
}

function ensureBundleLoads(bundlePath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-smoke-"));
  const vscodeDir = path.join(tempDir, "node_modules", "vscode");

  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(
    path.join(vscodeDir, "index.js"),
    [
      "class Disposable { dispose() {} }",
      "class EventEmitter { constructor() { this.event = () => undefined; } fire() {} dispose() {} }",
      "class TreeItem { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } }",
      "class ThemeIcon { constructor(id) { this.id = id; } }",
      "module.exports = {",
      "  window: {},",
      "  workspace: {},",
      "  commands: {},",
      "  EventEmitter,",
      "  Disposable,",
      "  TreeItem,",
      "  ThemeIcon,",
      "  ThemeColor: class ThemeColor { constructor(id) { this.id = id; } },",
      "  Uri: {",
      "    file: (filePath) => ({ fsPath: filePath }),",
      "    joinPath: (...parts) => ({ fsPath: parts.map((part) => part && (part.fsPath || part.path || String(part))).join('/') })",
      "  },",
      "  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },",
      "  StatusBarAlignment: { Left: 1, Right: 2 },",
      "  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 }",
      "};",
      "",
    ].join("\n")
  );

  try {
    const nodePath = path.join(tempDir, "node_modules");
    const separator = process.platform === "win32" ? ";" : ":";
    const existingNodePath = process.env.NODE_PATH
      ? `${process.env.NODE_PATH}${separator}`
      : "";

    execFileSync(process.execPath, ["-e", `require(${JSON.stringify(bundlePath)})`], {
      cwd: path.dirname(bundlePath),
      env: {
        ...process.env,
        NODE_PATH: `${nodePath}${separator}${existingNodePath}`,
      },
      stdio: "pipe",
    });
  } catch (error) {
    fail(`bundled extension could not be loaded: ${error.stderr?.toString() || error.message}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function ensureVsixHasExpectedFiles(vsixPath) {
  let listing;

  try {
    listing = execFileSync("unzip", ["-Z1", vsixPath], {
      cwd: path.dirname(vsixPath),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    fail(`could not inspect VSIX contents with unzip: ${error.stderr?.toString() || error.message}`);
  }

  const entries = new Set(listing.split(/\r?\n/).filter(Boolean));
  const requiredEntries = [
    "extension/package.json",
    "extension/out/extension.js",
    "extension/images/blank-tree-icon.svg",
    "extension/images/tbench-logo.png",
    "extension/images/tbench.svg",
  ];

  for (const entry of requiredEntries) {
    if (!entries.has(entry)) {
      fail(`VSIX is missing required entry: ${entry}`);
    }
  }
}

function ensureVsixBundleLoads(vsixPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbench-vsix-smoke-"));

  try {
    execFileSync("unzip", ["-q", vsixPath, "-d", tempDir], {
      cwd: path.dirname(vsixPath),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const extractedBundle = path.join(tempDir, "extension", "out", "extension.js");
    if (!fs.existsSync(extractedBundle)) {
      fail(`extracted VSIX bundle not found at ${extractedBundle}`);
    }

    ensureBundleLoads(extractedBundle);
  } catch (error) {
    fail(`VSIX bundle could not be loaded after extraction: ${error.stderr?.toString() || error.message}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const repoRoot = path.resolve(__dirname, "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
);
const bundlePath = path.join(repoRoot, "out", "extension.js");
const vsixPath = path.join(repoRoot, `${pkg.name}-${pkg.version}.vsix`);

if (!fs.existsSync(bundlePath)) {
  fail(`bundle not found at ${bundlePath}; run npm run bundle first`);
}

if (!fs.existsSync(vsixPath)) {
  fail(`VSIX not found at ${vsixPath}; run npm run package first`);
}

ensureBundleLoads(bundlePath);
ensureVsixHasExpectedFiles(vsixPath);
ensureVsixBundleLoads(vsixPath);

console.log(`Smoke check passed for ${path.basename(vsixPath)}`);