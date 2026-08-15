/**
 * Tree items and formatting helpers for the Build Artifacts pane —
 * one status row per artifact kind plus the shared freshness row.
 */
import * as vscode from "vscode";
import { ArtifactStatus, ExecutableArtifact, ResolvedArtifact } from "../build/artifact-resolution";

function formatArtifactTooltip(
  artifactPath: string,
  status: ArtifactStatus,
  missingReason?: string
): string {
  if (status === "present") {
    return artifactPath;
  }

  if (!artifactPath) {
    return missingReason ?? "Artifact missing.";
  }

  const lines = [`Missing: ${artifactPath}`];
  if (missingReason && !isRedundantMissingReason(missingReason, artifactPath)) {
    lines.push(missingReason);
  }
  return lines.join("\n");
}

function isRedundantMissingReason(reason: string, artifactPath: string): boolean {
  return reason.includes(artifactPath)
    || /(?:compile-commands|binary|map|executable) artifact not found/i.test(reason)
    ;
}

export function formatArtifactAge(modifiedAt: Date, now: Date = new Date()): string {
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - modifiedAt.getTime()) / 60_000));
  if (elapsedMinutes === 0) {
    return "just now";
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} min ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
}

export class ArtifactUpdatedItem extends vscode.TreeItem {
  constructor(modifiedAt: Date, now: Date = new Date()) {
    super("Updated", vscode.TreeItemCollapsibleState.None);
    this.id = "artifact:updated";
    this.contextValue = "artifact-updated";
    this.iconPath = new vscode.ThemeIcon("clock");
    this.description = formatArtifactAge(modifiedAt, now);
    this.tooltip = `Last modified: ${modifiedAt.toISOString().replace("T", " ").slice(0, 16)} UTC`;
  }
}

/**
 * Shared shape of a Build Artifacts row: `artifact:<kind>` id,
 * `artifact-<kind>` contextValue, pass/error icon, and a
 * `present`/`missing` description derived from the artifact status.
 */
class ArtifactStatusItem extends vscode.TreeItem {
  constructor(
    label: string,
    kind: string,
    status: ArtifactStatus,
    tooltip: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = `artifact:${kind}`;
    this.contextValue = `artifact-${kind}`;
    this.iconPath = new vscode.ThemeIcon(status === "present" ? "pass" : "error");
    this.description = status;
    this.tooltip = tooltip;
  }
}

/**
 * The Compile Commands row in the Build Artifacts section.
 * Shows `present` or `missing` as description and the expected path as tooltip.
 */
export class CompileCommandsArtifactItem extends ArtifactStatusItem {
  constructor(artifact: ResolvedArtifact) {
    super(
      "Compile Commands",
      "compile-commands",
      artifact.status,
      formatArtifactTooltip(artifact.path, artifact.status, artifact.missingReason)
    );
  }
}

/**
 * The Binary row in the Build Artifacts section.
 * contextValue "artifact-binary" enables Flash/Upload row actions via menus.view/item/context.
 */
export class BinaryArtifactItem extends ArtifactStatusItem {
  constructor(artifact: ResolvedArtifact) {
    super(
      "Binary",
      "binary",
      artifact.status,
      formatArtifactTooltip(artifact.path, artifact.status, artifact.missingReason)
    );
  }
}

/**
 * The Map File row in the Build Artifacts section.
 * contextValue "artifact-map" enables the openMapFile row action via menus.view/item/context.
 */
export class MapArtifactItem extends ArtifactStatusItem {
  constructor(artifact: ResolvedArtifact) {
    super(
      "Map File",
      "map",
      artifact.status,
      formatArtifactTooltip(artifact.path, artifact.status, artifact.missingReason)
    );
  }
}

/**
 * The Executable row in the Build Artifacts section (Debug Launch slice).
 * contextValue "artifact-executable" enables the Start Debugging row action via menus.view/item/context.
 * This row is always rendered when an ExecutableArtifact state has been computed — it remains
 * visible but disabled when the executable is missing or the profile cannot be resolved.
 * Start Debugging is invoked only through the inline row action, not by clicking the row.
 */
export class ExecutableArtifactItem extends ArtifactStatusItem {
  constructor(artifact: ExecutableArtifact) {
    super("Executable", "executable", artifact.status, artifact.tooltip);
  }
}
