/** The human-readable text of anything that was thrown. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** HTTP status attached to an error by the Readwise client, or 0 when there is none. */
export function errorStatus(error: unknown): number {
  return error && typeof error === "object" && "status" in error
    ? Number((error as { status: unknown }).status) || 0
    : 0;
}
