/**
 * Renders an unknown thrown value as a human-readable message.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
