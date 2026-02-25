export class FetchTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly requestLabel: string;

  constructor(requestLabel: string, timeoutMs: number) {
    super(`${requestLabel} timed out after ${timeoutMs}ms`);
    this.name = "FetchTimeoutError";
    this.timeoutMs = timeoutMs;
    this.requestLabel = requestLabel;
  }
}

export type FetchWithTimeoutInit = RequestInit & {
  timeoutMs?: number;
  timeoutLabel?: string;
};

const DEFAULT_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: FetchWithTimeoutInit
) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    timeoutLabel = "External request",
    signal,
    ...rest
  } = init ?? {};

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetch(input, { ...rest, signal });
  }

  const controller = new AbortController();
  let timedOut = false;
  let upstreamAborted = false;

  const onUpstreamAbort = () => {
    upstreamAborted = true;
    controller.abort(signal?.reason);
  };

  if (signal?.aborted) {
    onUpstreamAbort();
  } else if (signal) {
    signal.addEventListener("abort", onUpstreamAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new FetchTimeoutError(timeoutLabel, timeoutMs));
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...rest,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut && !upstreamAborted) {
      throw new FetchTimeoutError(timeoutLabel, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener("abort", onUpstreamAbort);
    }
  }
}

export function isFetchTimeoutError(error: unknown): error is FetchTimeoutError {
  return error instanceof FetchTimeoutError;
}
