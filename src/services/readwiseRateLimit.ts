const DEFAULT_RATE_LIMIT_WAIT_MS = 5000;

interface HttpErrorLike {
  status?: unknown;
  headers?: Record<string, unknown>;
  response?: {
    status?: unknown;
    headers?: Record<string, unknown>;
  };
}

export function getHttpErrorStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null) {
    const candidate = error as HttpErrorLike;
    const status = candidate.status ?? candidate.response?.status;
    if (typeof status === "number" && Number.isFinite(status)) {
      return status;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\bstatus\s+(\d{3})\b/i);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

export function getRateLimitWaitMs(source?: unknown): number {
  let headers: Record<string, unknown> | undefined;
  if (typeof source === "object" && source !== null) {
    const candidate = source as HttpErrorLike;
    headers = candidate.headers ?? candidate.response?.headers;
  }

  const retryAfter = headers?.["Retry-After"] ?? headers?.["retry-after"];
  if (typeof retryAfter === "string") {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds)) {
      return Math.max(1, seconds) * 1000;
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.max(1000, retryAt - Date.now());
    }
  }

  return DEFAULT_RATE_LIMIT_WAIT_MS;
}
