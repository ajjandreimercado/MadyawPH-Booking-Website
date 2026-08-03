/** Retry an async operation with linear backoff (shared Mongo dual-writes). */
export async function withRetries<T>(
  fn: () => Promise<T>,
  options: { attempts?: number; delayMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = Math.max(0, options.delayMs ?? 250);
  const label = options.label ?? 'operation';
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(`[Retry] ${label} failed (attempt ${attempt}/${attempts}):`, error);
      if (attempt < attempts && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
