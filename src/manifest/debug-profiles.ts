/**
 * Debug-profile resolution: matches a component's manifest-declared debug
 * profiles against the active build context.
 */
import { BuildContext, ManifestComponentDebugProfile } from "./manifest-types";
import { evaluateWhenExpression } from "./when-expressions";

export type DebugProfileResolutionState = "selected" | "no-match";

/**
 * Ordered set of component-owned debug profiles whose `when` expressions
 * evaluate to true for the active build context.
 */
export interface MatchingDebugProfileSet {
  /** All matching profiles in manifest declaration order. */
  readonly profiles: ReadonlyArray<ManifestComponentDebugProfile>;
  /** First matching profile in declaration order; undefined when no profile matches. */
  readonly defaultProfile: ManifestComponentDebugProfile | undefined;
}

/**
 * Collects all matching component debug profiles for the active build context
 * in manifest declaration order and identifies the default profile.
 *
 * - Profiles without a `when` expression match all contexts (match-all).
 * - All matching profiles are returned in declaration order.
 * - The first matching profile is the default.
 * - An empty set means debugging is unavailable for the active build context.
 */
export function resolveMatchingDebugProfiles(
  profiles: ReadonlyArray<ManifestComponentDebugProfile>,
  buildContext: BuildContext
): MatchingDebugProfileSet {
  const matching = profiles.filter((profile) =>
    profile.when === undefined ? true : evaluateWhenExpression(profile.when, buildContext)
  );
  return {
    profiles: matching,
    defaultProfile: matching[0],
  };
}
