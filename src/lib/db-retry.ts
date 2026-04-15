import { AppHttpError, isUniqueConstraintError } from "./errors";

// Retry only transient read failures; business/validation errors must fail fast.
const RETRYABLE_PATTERNS = [
  /SQLITE_BUSY/i,
  /database is locked/i,
  /network connection/i,
  /timed out/i,
  /temporar/i,
  /internal error/i
];

type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isRetryableDbError = (error: unknown): boolean => {
  if (error instanceof AppHttpError) {
    return false;
  }

  if (isUniqueConstraintError(error)) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  return RETRYABLE_PATTERNS.some((pattern) => pattern.test(message));
};

export const withDbReadRetry = async <T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> => {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 50;
  const maxDelayMs = options.maxDelayMs ?? 300;
  const label = options.label ?? "db-read";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const canRetry = attempt < maxAttempts && isRetryableDbError(error);

      if (!canRetry) {
        throw error;
      }

      const backoffMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitterMs = Math.floor(Math.random() * 25);
      const waitMs = backoffMs + jitterMs;

      console.warn(
        JSON.stringify({
          message: "Retrying DB read query",
          label,
          attempt,
          maxAttempts,
          waitMs,
          error: error instanceof Error ? error.message : String(error)
        })
      );

      await wait(waitMs);
    }
  }

  throw new Error("Unreachable retry state.");
};
