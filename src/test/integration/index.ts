import * as path from "path";
import Mocha from "mocha";
import * as fs from "fs";

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    timeout: 15000,
    // Many tests wait on real file-system events and debounce windows;
    // mocha's default 75ms slow threshold flags them all. Anything under
    // half this value gets no duration annotation. Suites that legitimately
    // run for seconds raise their own threshold via this.slow().
    slow: 500,
    color: true,
  });

  const testsRoot = path.resolve(__dirname, ".");

  return new Promise((resolve, reject) => {
    const testFiles = findTestFiles(testsRoot);
    testFiles.forEach((f) => mocha.addFile(f));

    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} integration test(s) failed`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) {
    return results;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "runTest.js") {
      results.push(...findTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".integration.test.js")) {
      results.push(full);
    }
  }
  return results;
}
