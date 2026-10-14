import { parse as parseToml } from "smol-toml";
import { RustAnalyzerConfig } from "./config-types";

const allowedCargoKeys = new Set(["features", "target", "allTargets"]);
const allowedCheckKeys = new Set(["extraArgs"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${key} must be an array of strings`);
  }
  return value;
}

function table(value: unknown, key: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${key} must be a table`);
  }
  return value;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, tableName: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${tableName}.${key} is not supported`);
    }
  }
}

export function parseRustAnalyzerConfig(source: string, emulator: boolean): RustAnalyzerConfig {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(source) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Invalid Rust Analyzer TOML: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (Object.keys(parsed).length === 0) {
    throw new Error("Rust Analyzer configuration is empty");
  }

  for (const key of Object.keys(parsed)) {
    if (key !== "cargo" && key !== "check") {
      throw new Error(`${key} is not supported`);
    }
  }

  const config: Record<string, string | boolean | readonly string[]> = {};
  const cargo = parsed.cargo === undefined ? undefined : table(parsed.cargo, "cargo");
  const check = parsed.check === undefined ? undefined : table(parsed.check, "check");

  if (cargo) {
    rejectUnknownKeys(cargo, allowedCargoKeys, "cargo");
    if ("features" in cargo) {
      config["cargo.features"] = stringList(cargo.features, "cargo.features");
    }
    if ("target" in cargo) {
      if (typeof cargo.target !== "string") {
        throw new Error("cargo.target must be a string");
      }
      config["cargo.target"] = cargo.target;
    }
    if ("allTargets" in cargo) {
      if (typeof cargo.allTargets !== "boolean") {
        throw new Error("cargo.allTargets must be a boolean");
      }
      config["cargo.allTargets"] = cargo.allTargets;
    }
  }

  if (check) {
    rejectUnknownKeys(check, allowedCheckKeys, "check");
    if ("extraArgs" in check) {
      config["check.extraArgs"] = stringList(check.extraArgs, "check.extraArgs");
    }
  }

  const hasTarget = "cargo.target" in config;
  const hasExtraArgs = "check.extraArgs" in config;
  if (emulator ? hasTarget || hasExtraArgs : !hasTarget || !hasExtraArgs) {
    throw new Error(
      emulator
        ? "cargo.target and check.extraArgs are not valid for emulator output"
        : "cargo.target and check.extraArgs are required for hardware output"
    );
  }

  return config;
}