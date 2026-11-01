import { describe, it, expect, afterEach, vi } from 'vitest';
import { probeHttpStatus } from './http-status-probe';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('probeHttpStatus', () => {
  it('answers the status of a one-byte ranged request', async () => {
    const fetchMock = vi.fn(async () => ({ status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(probeHttpStatus('http://host/a', 1000)).resolves.toBe(403);
    expect(fetchMock).toHaveBeenCalledWith('http://host/a',
      expect.objectContaining({ headers: { Range: 'bytes=0-0' } }));
  });

  it('answers null when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await expect(probeHttpStatus('http://host/a', 1000)).resolves.toBeNull();
  });

  it('answers null when the request outlasts the timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const status = probeHttpStatus('http://host/a', 1000);
    vi.advanceTimersByTime(1000);
    await expect(status).resolves.toBeNull();
  });
});
