/** Human-readable message from Supabase / fetch / unknown errors. */
export function formatMutationError(err: unknown, fallback = "Try again."): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}
