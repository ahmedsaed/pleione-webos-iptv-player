import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  httpRetryReason,
  finalTimeout,
  loaderTransientFailure,
  parseRetryAfterMs,
  retryTransient,
  type TransientFailure,
} from './retry';

class Transient extends Error {
  constructor(readonly failure: TransientFailure) {
    super('transient');
  }
}

const classify = (error: unknown): TransientFailure | null =>
  error instanceof Transient ? error.failure : null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('retryTransient', () => {
  it('waits 1 s, 2 s, then 4 s and surfaces the last error after 4 attempts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const startedAt: number[] = [];
    const run = vi.fn(async () => {
      startedAt.push(Date.now());
      throw new Transient({ reason: 'http_5xx' });
    });
    const started = Date.now();
    const result = retryTransient(run, { kind: 'xtream', classify });
    const settled = expect(result).rejects.toBeInstanceOf(Transient);

    await vi.runAllTimersAsync();
    await settled;

    expect(run).toHaveBeenCalledTimes(4);
    expect(startedAt.map(at => at - started)).toEqual([0, 1000, 3000, 7000]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[Network]',
      'Provider request failed after retries',
      'event=network.retry.exhausted',
      'kind=xtream',
      'attempts=4',
      'reason=http_5xx',
    );
  });

  it('logs one recovery line when a retry succeeds', async () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const run = vi.fn()
      .mockRejectedValueOnce(new Transient({ reason: 'network' }))
      .mockRejectedValueOnce(new Transient({ reason: 'timeout' }))
      .mockResolvedValueOnce('ok');

    const result = retryTransient(run, { kind: 'playlist', classify });
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(3);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      '[Network]',
      'Provider request recovered after retry',
      'event=network.retry.recovered',
      'kind=playlist',
      'attempts=3',
    );
  });

  it('logs nothing when the first attempt succeeds', async () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(retryTransient(async () => 1, { kind: 'epg', classify })).resolves.toBe(1);
    expect(info).not.toHaveBeenCalled();
  });

  it('never retries a final failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = vi.fn(async () => { throw new Error('HTTP 404'); });

    await expect(retryTransient(run, { kind: 'xtream', classify })).rejects.toThrow('HTTP 404');
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('honors a numeric Retry-After and caps it at 10 s', async () => {
    const startedAt: number[] = [];
    const run = vi.fn(async () => {
      startedAt.push(Date.now());
      if (startedAt.length === 1) throw new Transient({ reason: 'http_429', retryAfterMs: 3000 });
      if (startedAt.length === 2) throw new Transient({ reason: 'http_429', retryAfterMs: 120000 });
      return 'ok';
    });
    const started = Date.now();
    const result = retryTransient(run, { kind: 'xtream', classify });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe('ok');
    expect(startedAt.map(at => at - started)).toEqual([0, 3000, 13000]);
  });

  it('cancels a pending delay at once on a caller abort', async () => {
    const controller = new AbortController();
    const run = vi.fn(async () => { throw new Transient({ reason: 'network' }); });
    const cancelled = new Error('cancelled');
    const result = retryTransient(run, {
      kind: 'xtream',
      classify,
      signal: controller.signal,
      abortError: () => cancelled,
    });
    const settled = expect(result).rejects.toBe(cancelled);
    await vi.advanceTimersByTimeAsync(500);

    controller.abort();
    await settled;

    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failure that follows a caller abort without retrying it', async () => {
    const controller = new AbortController();
    const aborted = new Transient({ reason: 'timeout' });
    const run = vi.fn(async () => {
      controller.abort();
      throw aborted;
    });

    await expect(retryTransient(run, { kind: 'xtream', classify, signal: controller.signal }))
      .rejects.toBe(aborted);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('retry classification', () => {
  it('retries only 408, 429, and 5xx statuses', () => {
    expect([400, 401, 403, 404, 408, 429, 499, 500, 503, 599, 600].map(httpRetryReason))
      .toEqual([null, null, null, null, 'http_408', 'http_429', null,
        'http_5xx', 'http_5xx', 'http_5xx', null]);
  });

  it('reads only the delay-seconds form of Retry-After', () => {
    expect(parseRetryAfterMs('5')).toBe(5000);
    expect(parseRetryAfterMs(' 0 ')).toBe(0);
    expect(parseRetryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull();
    expect(parseRetryAfterMs('-1')).toBeNull();
    expect(parseRetryAfterMs(null)).toBeNull();
  });

  it('classifies loader failures from their details', () => {
    // A whole download that timed out is not tried again.
    expect(loaderTransientFailure({ stage: 'fetch', reason: 'timeout' })).toBeNull();
    expect(loaderTransientFailure({ stage: 'fetch', reason: 'http', status: 503, retryAfterMs: 2000 }))
      .toEqual({ reason: 'http_5xx', retryAfterMs: 2000 });
    expect(loaderTransientFailure({ stage: 'fetch', reason: 'http', status: 404 })).toBeNull();
    expect(loaderTransientFailure({ stage: 'fetch', reason: 'exception' }))
      .toEqual({ reason: 'network' });
    expect(loaderTransientFailure({ stage: 'read', reason: 'exception' }))
      .toEqual({ reason: 'network' });
    expect(loaderTransientFailure({ stage: 'decode_parse', reason: 'exception' })).toBeNull();
  });

  it('makes only a timeout final for a whole download', () => {
    expect(finalTimeout({ reason: 'timeout' })).toBeNull();
    expect(finalTimeout({ reason: 'network' })).toEqual({ reason: 'network' });
    expect(finalTimeout({ reason: 'http_408' })).toEqual({ reason: 'http_408' });
    expect(finalTimeout({ reason: 'http_429', retryAfterMs: 5000 }))
      .toEqual({ reason: 'http_429', retryAfterMs: 5000 });
    expect(finalTimeout({ reason: 'http_5xx' })).toEqual({ reason: 'http_5xx' });
    expect(finalTimeout(null)).toBeNull();
  });
});
