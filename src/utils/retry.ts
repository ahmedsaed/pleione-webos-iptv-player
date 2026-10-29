import { CONFIG } from '../config';
import { createLogger } from './logger';

const log = createLogger('Network');

export type RetryKind = 'xtream' | 'playlist' | 'epg';
export type RetryReason = 'network' | 'timeout' | 'http_408' | 'http_429' | 'http_5xx';

export interface TransientFailure {
  reason: RetryReason;
  retryAfterMs?: number | null;
}

export interface RetryOptions {
  kind: RetryKind;
  /** The failure to retry, or null for a final one (4xx, bad content, abort). */
  classify: (error: unknown) => TransientFailure | null;
  /** The caller's signal; aborting it cancels a pending delay at once. */
  signal?: AbortSignal;
  abortError?: () => unknown;
}

export function httpRetryReason(status: number | undefined): RetryReason | null {
  if (status === 408) return 'http_408';
  if (status === 429) return 'http_429';
  if (status !== undefined && status >= 500 && status <= 599) return 'http_5xx';
  return null;
}

// Only the delay-seconds form; an HTTP-date falls back to the backoff step.
export function parseRetryAfterMs(value: string | null | undefined): number | null {
  const text = (value ?? '').trim();
  return /^\d+$/.test(text) ? Number(text) * 1000 : null;
}

export function retryDelayMs(retry: number, retryAfterMs?: number | null): number {
  const network = CONFIG.NETWORK;
  if (retryAfterMs !== null && retryAfterMs !== undefined) {
    return Math.min(Math.max(0, retryAfterMs), network.RETRY_AFTER_MAX_MS);
  }
  return network.RETRY_BASE_DELAY_MS * Math.pow(network.RETRY_BACKOFF_FACTOR, retry);
}

/** Classifies a playlist or XMLTV worker failure from its diagnostic details. */
export function loaderTransientFailure(details: {
  stage: string;
  reason: string;
  status?: number;
  retryAfterMs?: number | null;
}): TransientFailure | null {
  if (details.reason === 'timeout') return { reason: 'timeout' };
  if (details.reason === 'http') {
    const reason = httpRetryReason(details.status);
    return reason ? { reason, retryAfterMs: details.retryAfterMs } : null;
  }
  // A thrown fetch or body read is a network failure; a parse error is not.
  return details.reason === 'exception' && (details.stage === 'fetch' || details.stage === 'read')
    ? { reason: 'network' }
    : null;
}

function defaultAbortError(): Error {
  const error = new Error('Request was cancelled');
  error.name = 'AbortError';
  return error;
}

function wait(ms: number, signal: AbortSignal | undefined, abortError: () => unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort);
  });
}

/** Runs a provider request, retrying transient failures with backoff. */
export async function retryTransient<T>(
  run: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const abortError = options.abortError ?? defaultAbortError;
  for (let attempt = 1; ; attempt++) {
    let result: T;
    try {
      result = await run(attempt);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const failure = options.classify(error);
      if (!failure) throw error;
      if (attempt > CONFIG.NETWORK.RETRIES) {
        if (attempt > 1) {
          log.warn(
            'Provider request failed after retries',
            'event=network.retry.exhausted',
            `kind=${options.kind}`,
            `attempts=${String(attempt)}`,
            `reason=${failure.reason}`,
          );
        }
        throw error;
      }
      await wait(retryDelayMs(attempt - 1, failure.retryAfterMs), options.signal, abortError);
      continue;
    }
    if (attempt > 1) {
      log.info(
        'Provider request recovered after retry',
        'event=network.retry.recovered',
        `kind=${options.kind}`,
        `attempts=${String(attempt)}`,
      );
    }
    return result;
  }
}
