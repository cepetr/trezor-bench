/**
 * Renders an unknown thrown value as a human-readable message.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * True when the thrown value is a Node.js file-system error for a missing
 * file or directory (ENOENT).
 */
export function isFileNotFound(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
}
