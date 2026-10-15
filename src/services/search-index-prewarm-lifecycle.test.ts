// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config';
import { isAppWorkerRunning, runAppWorkerTask, terminateAppWorker } from '../workers/app-worker-client';

const { cacheMock } = vi.hoisted(() => ({
  cacheMock: { reserveDelayMs: 0, settled: [] as boolean[] },
}));
vi.mock('./idb-cache', () => ({
  reserveSearchIndex: vi.fn(() => new Promise(resolve => {
    setTimeout(() => resolve({ generation: 0, fields: { cacheCategory: 'search' } }), cacheMock.reserveDelayMs);
  })),
  settleSearchIndex: vi.fn(async (_key: string, _reservation: unknown, stored: boolean) => {
    cacheMock.settled.push(stored);
  }),
  onPlaylistCacheWritten: () => () => undefined,
}));
vi.mock('./xtream-catalog', () => ({ onCatalogListRefreshed: () => () => undefined }));

import { SearchIndexPrewarmer, persistSearchIndexes } from './search-index-store';

const INDEX_KEY = 'catalog-cache|x1|vod_all|1|v1';
const candidate = { key: INDEX_KEY, prefix: 'catalog-cache|x1|vod_all|', bytes: 10 };

interface Request {
  kind: 'request';
  id: number;
  task: string;
}

// Like the app worker, it can only write an index it built itself.
class FakeWorker {
  static tasks: string[] = [];
  static terminations = 0;
  static created = 0;
  private listeners: Array<(event: { data: unknown }) => void> = [];
  private built = false;

  constructor() {
    FakeWorker.created++;
  }

  postMessage(message: Request): void {
    FakeWorker.tasks.push(message.task);
    const builds = message.task !== 'search.persist';
    if (builds) this.built = true;
    const result = builds
      ? { accepted: true, persist: [candidate] }
      : { written: this.built ? [INDEX_KEY] : [] };
    setTimeout(() => {
      for (const listener of this.listeners) {
        listener({ data: { kind: 'success', id: message.id, result } });
      }
    }, 0);
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    if (type === 'message') this.listeners.push(listener);
  }

  terminate(): void {
    FakeWorker.terminations++;
  }
}

describe('SearchIndexPrewarmer worker lifetime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    FakeWorker.tasks = [];
    FakeWorker.terminations = 0;
    FakeWorker.created = 0;
    cacheMock.reserveDelayMs = 0;
    cacheMock.settled = [];
  });

  afterEach(() => {
    terminateAppWorker();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('lets the worker terminate on idle once the prewarm is stored', async () => {
    const prewarm = new SearchIndexPrewarmer(() => [{ store: 'catalog-cache', key: 'x1|vod_all' }]);
    prewarm.schedule('startup');
    await vi.advanceTimersByTimeAsync(10);
    expect(FakeWorker.tasks).toEqual(['search.prewarm', 'search.persist']);
    expect(isAppWorkerRunning()).toBe(true);

    await vi.advanceTimersByTimeAsync(CONFIG.WORKER_IDLE_TERMINATION_MS);
    expect(isAppWorkerRunning()).toBe(false);
    expect(FakeWorker.terminations).toBe(1);
  });

  it('keeps the building worker until a slow reservation lets it write', async () => {
    cacheMock.reserveDelayMs = CONFIG.WORKER_IDLE_TERMINATION_MS + 500;
    const prewarm = new SearchIndexPrewarmer(() => [{ store: 'catalog-cache', key: 'x1|vod_all' }]);
    prewarm.schedule('startup');
    await vi.advanceTimersByTimeAsync(cacheMock.reserveDelayMs + 10);

    expect(FakeWorker.tasks).toEqual(['search.prewarm', 'search.persist']);
    expect(FakeWorker.created).toBe(1);
    expect(cacheMock.settled).toEqual([true]);
    await vi.advanceTimersByTimeAsync(CONFIG.WORKER_IDLE_TERMINATION_MS);
    expect(isAppWorkerRunning()).toBe(false);
  });

  it('keeps the worker an open Search built in until its index is stored', async () => {
    cacheMock.reserveDelayMs = CONFIG.WORKER_IDLE_TERMINATION_MS + 500;
    const response = runAppWorkerTask('search.index', { sessionId: 1 });
    await vi.advanceTimersByTimeAsync(1);
    const persisted = persistSearchIndexes((await response).persist);
    await vi.advanceTimersByTimeAsync(cacheMock.reserveDelayMs + 10);
    await persisted;

    expect(FakeWorker.created).toBe(1);
    expect(cacheMock.settled).toEqual([true]);
    await vi.advanceTimersByTimeAsync(CONFIG.WORKER_IDLE_TERMINATION_MS);
    expect(isAppWorkerRunning()).toBe(false);
  });
});
