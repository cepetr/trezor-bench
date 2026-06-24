import { IntelliSenseProviderReadiness } from "./intellisense-types";
import {
  CLANGD_EXTENSION_ID,
  isClangdExtensionInstalled,
} from "./clangd-provider";
import {
  CPPTOOLS_EXTENSION_ID,
  evaluateCpptoolsReadiness,
} from "./cpptools-provider";

// ---------------------------------------------------------------------------
// IntelliSense backend selection
// ---------------------------------------------------------------------------

export type IntelliSenseBackend = "cpptools" | "clangd";

/**
 * Returns the IntelliSense backend tf-tools should use for the current workspace.
 *
 * Prefers cpptools when its custom-configuration API is available and tf-tools
 * is configured as the provider. Falls back to clangd when the Microsoft C/C++
 * extension is unavailable — for example in editors such as Cursor that ship a
 * different C/C++ extension and rely on clangd instead.
 */
export function resolveIntelliSenseBackend(): IntelliSenseBackend | undefined {
  const cpptools = evaluateCpptoolsReadiness();
  if (cpptools.status === "ready") {
    return "cpptools";
  }
  if (cpptools.status === "wrong-provider") {
    return undefined;
  }
  if (isClangdExtensionInstalled()) {
    return "clangd";
  }
  return undefined;
}

/**
 * Evaluates whether IntelliSense prerequisites are satisfied for either cpptools
 * or clangd.
 */
export function checkProviderReadiness(): IntelliSenseProviderReadiness {
  const cpptools = evaluateCpptoolsReadiness();

  if (cpptools.status === "ready") {
    return {
      providerInstalled: true,
      providerConfigured: true,
      warningState: "none",
    };
  }

  if (cpptools.status === "wrong-provider") {
    return {
      providerInstalled: true,
      providerConfigured: false,
      warningState: "wrong-provider",
      lastWarningMessage: cpptools.message,
    };
  }

  if (isClangdExtensionInstalled()) {
    return {
      providerInstalled: true,
      providerConfigured: true,
      warningState: "none",
    };
  }

  if (cpptools.status === "unsupported") {
    return {
      providerInstalled: false,
      providerConfigured: false,
      warningState: "missing-provider",
      lastWarningMessage:
        `IntelliSense integration is unavailable: installed C/C++ extension (${cpptools.extensionId}) ` +
        `does not expose the supported custom-configuration API, and the clangd extension (${CLANGD_EXTENSION_ID}) is not installed.`,
    };
  }

  return {
    providerInstalled: false,
    providerConfigured: false,
    warningState: "missing-provider",
    lastWarningMessage:
      `IntelliSense integration is unavailable: install Microsoft C/C++ (${CPPTOOLS_EXTENSION_ID}) ` +
      `with cepetr.tf-tools as the configuration provider, or install the clangd extension (${CLANGD_EXTENSION_ID}).`,
  };
}
