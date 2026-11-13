import { API_BOOT_LIMIT_MS, waitForApiReady, type ApiReadiness } from "./api-readiness";

/** Preserve the failure kind so startup does not guess from display text. */
export class ApiResponseError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiResponseError";
  }
}

export class ApiConnectionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApiConnectionError";
  }
}

function canRetryRead(error: unknown): boolean {
  return error instanceof ApiConnectionError
    || error instanceof ApiResponseError && [500, 502, 503, 504].includes(error.status);
}

/** Safe reads may recover from a restart. The readiness response is the only
 * evidence that the service is starting; a failed connection says connecting.
 * An API that repeatedly reports ready but rejects the read becomes a real
 * error after two retries. Callers must never pass mutations here.
 * Every readiness wait of one read shares one deadline, so the retries cannot
 * add up to more than one boot budget; silence past the unanswered limit ends
 * the read with `ApiUnavailableError`. */
export async function recoverApiRead<T>(read: () => Promise<T>, options: {
  signal: AbortSignal;
  onStatus?: (status: ApiReadiness) => void;
  unansweredLimitMs?: number;
  deadline?: number;
}): Promise<T> {
  const waitOptions = { ...options, deadline: options.deadline ?? Date.now() + API_BOOT_LIMIT_MS };
  for (let attempt = 0; ; attempt++) {
    options.signal.throwIfAborted();
    try {
      const result = await read();
      options.signal.throwIfAborted();
      return result;
    } catch (error) {
      options.signal.throwIfAborted();
      if (!canRetryRead(error) || attempt >= 2) throw error;
      await waitForApiReady(waitOptions);
    }
  }
}
