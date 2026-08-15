/**
 * Single authority for the tbench command identifiers.
 *
 * `CONTRIBUTED_COMMAND_IDS` mirrors `contributes.commands` in package.json
 * (which stays hand-maintained — it is a user-visible contribution point);
 * the activation scope guard verifies the two agree.
 * `INTERNAL_COMMAND_IDS` are registered but deliberately not contributed:
 * they are invoked only through tree-item command bindings in the
 * Configuration panes.
 */

export const CONTRIBUTED_COMMAND_IDS = [
  "tbench.showLogs", // reveal the output channel
  "tbench.build", // launch Build task
  "tbench.clippy", // launch Clippy task
  "tbench.check", // launch Check task
  "tbench.clean", // launch Clean task
  "tbench.refreshIntelliSense", // manual IntelliSense refresh
  "tbench.flash", // launch Flash task (Flash/Upload slice)
  "tbench.upload", // launch Upload task (Flash/Upload slice)
  "tbench.openMapFile", // open resolved map file (Flash/Upload slice)
  "tbench.startDebugging", // launch debug session (Debug Launch slice)
] as const;

export const INTERNAL_COMMAND_IDS = [
  "tbench.selectModel",
  "tbench.selectTarget",
  "tbench.selectComponent",
  "tbench.selectPreset",
  "tbench.toggleBuildOption",
  "tbench.selectBuildOptionState",
] as const;
