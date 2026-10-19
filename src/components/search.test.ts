// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PlaylistEntry, Programme } from '../types';
import type { SearchIndexRequest, SearchQueryRequest } from '../workers/tasks';

const {
  catalogMock,
  playlistMock,
  epgMock,
  reminderMock,
  storageMock,
  archiveMock,
  toastMock,
  workerMock,
  cacheMock,
  persistMock,
} = vi.hoisted(() => ({
  persistMock: vi.fn(async () => undefined),
  catalogMock: {
    getSearchCatalogExpiresAt: vi.fn(),
    loadAllVodStreams: vi.fn(),
    loadAllSeries: vi.fn(),
    onCatalogListRefreshed: vi.fn(),
  },
  playlistMock: {
    channels: [] as unknown[],
    search: vi.fn(() => [] as unknown[]),
    searchRanked: vi.fn(),
    indexOf: vi.fn(() => 0),
    getChannelCacheSource: vi.fn((): unknown => null),
  },
  epgMock: {
    programmes: {} as Record<string, Programme[]>,
    findChannelId: vi.fn((channel: { id: string }) => channel.id),
    getSourceUrl: vi.fn(() => 'http://host/epg.xml'),
    programmeCacheOrigin: vi.fn((): unknown => null),
  },
  reminderMock: { has: vi.fn(() => false), add: vi.fn(), remove: vi.fn() },
  storageMock: {
    getCatchupProgressList: vi.fn(() => [] as unknown[]),
    clearCatchupProgress: vi.fn(),
    addSearchHistory: vi.fn(),
  },
  archiveMock: {
    load: vi.fn(async () => null as Set<number> | null),
    isAvailable: vi.fn((channel: { catchupSource?: string }) => !!channel.catchupSource),
  },
  toastMock: vi.fn(),
  workerMock: {
    run: vi.fn(),
    retain: vi.fn(() => vi.fn()),
    running: false,
  },
  cacheMock: {
    records: new Map<string, Record<string, unknown>>(),
    refs: new WeakMap<object, unknown>(),
  },
}));
vi.mock('../services/xtream-catalog', () => catalogMock);
vi.mock('../services/playlist-service', () => ({ PlaylistService: playlistMock }));
vi.mock('../services/epg-service', () => ({ EpgService: epgMock }));
vi.mock('../services/reminder-service', () => ({ ReminderService: reminderMock }));
vi.mock('../services/storage-service', () => ({ StorageService: storageMock }));
vi.mock('../services/xtream-archive', () => ({ XtreamArchiveService: archiveMock }));
vi.mock('./toast', () => ({ showToast: toastMock }));
vi.mock('../services/search-index-store', () => ({ persistSearchIndexes: persistMock }));
vi.mock('../services/idb-cache', async importOriginal => ({
  ...await importOriginal<typeof import('../services/idb-cache')>(),
  cacheRecordRef: (value: object) => cacheMock.refs.get(value) ?? null,
}));
vi.mock('../workers/app-worker-client', async () => {
  const { SearchWorkerIndex } = await import('../workers/search-index');
  const index = new SearchWorkerIndex({
    read: async ref => cacheMock.records.get(`${ref.store}|${ref.key}`) ?? null,
    count: async ref => cacheMock.records.has(`${ref.store}|${ref.key}`) ? 1 : 0,
    write: async (store, value) => {
      cacheMock.records.set(`${store}|${String(value.key)}`, value);
    },
  });
  workerMock.run.mockImplementation(async (task: string, payload: unknown) => {
    workerMock.running = true;
    if (task === 'search.index') return index.index(payload as SearchIndexRequest);
    if (task === 'search.query') return index.query(payload as SearchQueryRequest);
    throw new Error(`Unexpected worker task: ${task}`);
  });
  return {
    runAppWorkerTask: workerMock.run,
    retainAppWorker: workerMock.retain,
    isAppWorkerRunning: () => workerMock.running,
  };
});

import { Search } from './search';
import { CONFIG } from '../config';
import { Focus } from '../navigation/focus-scope';

const account: PlaylistEntry = {
  id: 'x1', name: 'X', url: 'http://host:8080', source: 'xtream', xtream: { username: 'u', password: 'p' },
};
const vod = (id: string, name: string) => ({ accountId: 'x1', streamId: id, name, poster: '', rating: '', categoryId: '1', containerExtension: 'mp4' });
const ser = (id: string, name: string) => ({ accountId: 'x1', seriesId: id, name, poster: '', rating: '', categoryId: '1' });
const chan = (name: string) => ({ id: name, name, logo: '', group: '', url: `http://host/${name}`, extras: null, playlistIds: ['x1'], catchup: '', catchupSource: '', catchupDays: 0 });
const prog = (title: string, start: number, stop: number): Programme => ({
  title,
  start: new Date(start),
  stop: new Date(stop),
  description: '',
  category: 'Drama',
  icon: '',
});

let container: HTMLElement;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  workerMock.running = false;
  playlistMock.channels = [];
  playlistMock.search.mockReturnValue([]);
  playlistMock.searchRanked.mockImplementation((query: string, limit: number) => {
    const items = playlistMock.search(query);
    return { items: items.slice(0, limit), hasMore: items.length > limit };
  });
  playlistMock.indexOf.mockReturnValue(0);
  playlistMock.getChannelCacheSource.mockReturnValue(null);
  epgMock.programmeCacheOrigin.mockReturnValue(null);
  cacheMock.records.clear();
  epgMock.programmes = {};
  epgMock.findChannelId.mockImplementation((channel: { id: string }) => channel.id);
  reminderMock.has.mockReturnValue(false);
  storageMock.getCatchupProgressList.mockReturnValue([]);
  archiveMock.load.mockResolvedValue(null);
  archiveMock.isAvailable.mockImplementation((channel: { catchupSource?: string }) => !!channel.catchupSource);
  catalogMock.getSearchCatalogExpiresAt.mockResolvedValue(
    Date.now() + CONFIG.XTREAM.DEFAULT_CATALOG_REFRESH_INTERVAL_MS,
  );
  container = document.createElement('div');
  document.body.appendChild(container);
});

function mkHandlers() {
  return {
    onRevealTabBar: vi.fn(),
    onReleaseTabBar: vi.fn(),
    onBack: vi.fn(),
    onPlayChannel: vi.fn(),
    onOpenMovie: vi.fn(),
    onOpenSeries: vi.fn(),
  };
}

// Every source has reached the worker, so a query runs at once.
async function indexReady(view: Search): Promise<void> {
  await vi.waitFor(() => {
    expect((view as unknown as { pendingIndex: unknown }).pendingIndex).toBeNull();
  }, { timeout: 3000 });
}

function diagEvents(spy: { mock: { calls: unknown[][] } }, event: string): string[] {
  return spy.mock.calls
    .map(call => call.filter(part => typeof part === 'string').join(' '))
    .filter(line => line.includes(`event=${event} `));
}

async function openWith(opts: { vod?: unknown[]; series?: unknown[] } = {}) {
  catalogMock.loadAllVodStreams.mockResolvedValue(opts.vod ?? []);
  catalogMock.loadAllSeries.mockResolvedValue(opts.series ?? []);
  const handlers = mkHandlers();
  const view = new Search(container, handlers);
  await view.open(account);
  await indexReady(view);
  return { view, handlers };
}

afterEach(() => {
  Focus.setBase(() => null);
  Focus.uninstall();
});

describe('Search', () => {
  it('renders results-only and empty on open (no in-view query box, no hint)', async () => {
    await openWith();
    expect(container.querySelector('.search-results')).not.toBeNull();
    expect(container.querySelector('.search-input')).toBeNull(); // the box lives in the tab bar
    // The results view is only shown once a query is typed, so it renders empty.
    expect(container.querySelector('.search-results')?.textContent?.trim()).toBe('');
  });

  it('reuses a complete worker index when Search reopens before idle termination', async () => {
    playlistMock.channels = [chan('Alpha')];
    const { view } = await openWith({ vod: [vod('10', 'Alpha Movie')] });
    const initialResets = workerMock.run.mock.calls.filter(
      ([task, payload]) => task === 'search.index' && (payload as SearchIndexRequest).reset,
    ).length;

    const info = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    view.deactivate();
    await view.open(account);
    await view.setQuery('alpha');

    expect(workerMock.run.mock.calls.filter(
      ([task, payload]) => task === 'search.index' && (payload as SearchIndexRequest).reset,
    )).toHaveLength(initialResets);
    expect(diagEvents(info, 'search.index.ready'))
      .toEqual([expect.stringContaining('mode=reused channels=1 programmes=0 items=1')]);
    info.mockRestore();
    expect(catalogMock.loadAllVodStreams).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Alpha Movie');
  });

  it('reloads the account catalog after it is invalidated', async () => {
    const { view } = await openWith({ vod: [vod('10', 'Old Movie')] });
    view.deactivate();
    view.invalidateCatalog();
    catalogMock.loadAllVodStreams.mockResolvedValue([vod('11', 'New Movie')]);
    catalogMock.loadAllSeries.mockResolvedValue([]);

    await view.open(account);
    await indexReady(view);
    await view.setQuery('movie');

    expect(catalogMock.loadAllVodStreams).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('New Movie');
    expect(container.textContent).not.toContain('Old Movie');
  });

  it('keeps the ready worker index while an expired catalog is retried without content changes', async () => {
    const movies = [vod('10', 'Alpha Movie')];
    const series = [ser('20', 'Alpha Series')];
    const movieRef = { store: 'catalog-cache', key: 'x1|vod_all', timestamp: 1303 };
    const seriesRef = { store: 'catalog-cache', key: 'x1|series_all', timestamp: 1304 };
    cacheMock.refs.set(movies, movieRef);
    cacheMock.refs.set(series, seriesRef);
    cacheMock.records.set('catalog-cache|x1|vod_all', { timestamp: 1303, data: movies });
    cacheMock.records.set('catalog-cache|x1|series_all', { timestamp: 1304, data: series });
    catalogMock.getSearchCatalogExpiresAt.mockResolvedValue(Date.now() - 1);
    const { view } = await openWith({ vod: movies, series });
    const indexed = workerMock.run.mock.calls.filter(([task]) => task === 'search.index').length;
    const copiedMovies = movies.map(item => ({ ...item }));
    const copiedSeries = series.map(item => ({ ...item }));
    cacheMock.refs.set(copiedMovies, movieRef);
    cacheMock.refs.set(copiedSeries, seriesRef);
    catalogMock.loadAllVodStreams.mockResolvedValue(copiedMovies);
    catalogMock.loadAllSeries.mockResolvedValue(copiedSeries);
    catalogMock.getSearchCatalogExpiresAt.mockResolvedValue(Date.now() + 60_000);

    view.deactivate();
    await view.open(account);
    await vi.waitFor(() => expect(catalogMock.loadAllVodStreams).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(catalogMock.getSearchCatalogExpiresAt).toHaveBeenCalledTimes(2));
    await view.setQuery('alpha');

    expect(workerMock.run.mock.calls.filter(([task]) => task === 'search.index')).toHaveLength(indexed);
    expect(container.textContent).toContain('Alpha Movie');
    expect(container.textContent).toContain('Alpha Series');
    const refreshed = catalogMock.onCatalogListRefreshed.mock.calls[0][0] as
      (key: string, changed?: boolean) => void;
    refreshed('x1|vod_all', false);
    await vi.waitFor(() => expect(catalogMock.getSearchCatalogExpiresAt).toHaveBeenCalledTimes(3));
    expect(catalogMock.loadAllVodStreams).toHaveBeenCalledTimes(2);
    expect(workerMock.run.mock.calls.filter(([task]) => task === 'search.index')).toHaveLength(indexed);
  });

  it('ignores a superseded refresh for the same account', async () => {
    catalogMock.getSearchCatalogExpiresAt.mockResolvedValue(Date.now() - 1);
    const { view } = await openWith({ vod: [vod('10', 'Old Movie')] });
    let finishStale: (value: unknown[]) => void = () => undefined;
    const stale = new Promise<unknown[]>(resolve => { finishStale = resolve; });
    catalogMock.loadAllVodStreams.mockReturnValueOnce(stale);

    view.deactivate();
    await view.open(account);
    await vi.waitFor(() => expect(catalogMock.loadAllVodStreams).toHaveBeenCalledTimes(2));
    catalogMock.getSearchCatalogExpiresAt.mockResolvedValue(Date.now() + 60_000);
    catalogMock.loadAllVodStreams.mockResolvedValue([vod('11', 'New Movie')]);
    const refreshed = catalogMock.onCatalogListRefreshed.mock.calls[0][0] as (key: string) => void;
    refreshed('x1|vod_all');
    await view.setQuery('movie');
    await vi.waitFor(() => expect(container.textContent).toContain('New Movie'));

    finishStale([vod('10', 'Old Movie')]);
    await stale;
    await new Promise(resolve => setTimeout(resolve, 0));
    await view.setQuery('movie');

    expect(container.textContent).toContain('New Movie');
    expect(container.textContent).not.toContain('Old Movie');
  });

  it('does not mark an inactive stale load fresh after a changed catalog notification', async () => {
    catalogMock.getSearchCatalogExpiresAt.mockResolvedValue(Date.now() - 1);
    const { view } = await openWith({ vod: [vod('10', 'Old Movie')] });
    let finishExpiry: (value: number) => void = () => undefined;
    const staleExpiry = new Promise<number>(resolve => { finishExpiry = resolve; });
    catalogMock.getSearchCatalogExpiresAt.mockReturnValueOnce(staleExpiry);

    view.deactivate();
    await view.open(account);
    await vi.waitFor(() => expect(catalogMock.getSearchCatalogExpiresAt).toHaveBeenCalledTimes(2));
    view.deactivate();
    catalogMock.loadAllVodStreams.mockResolvedValue([vod('11', 'New Movie')]);
    const expiresAt = Date.now() + 60_000;
    catalogMock.getSearchCatalogExpiresAt.mockResolvedValue(expiresAt);
    const refreshed = catalogMock.onCatalogListRefreshed.mock.calls[0][0] as (key: string) => void;
    refreshed('x1|vod_all');
    finishExpiry(expiresAt);
    await staleExpiry;
    await new Promise(resolve => setTimeout(resolve, 0));

    await view.open(account);
    await indexReady(view);
    await view.setQuery('movie');

    expect(container.textContent).toContain('New Movie');
    expect(container.textContent).not.toContain('Old Movie');
    expect(catalogMock.loadAllVodStreams).toHaveBeenCalledTimes(3);
  });

  it('reloads the account catalog after its natural TTL expires', async () => {
    catalogMock.getSearchCatalogExpiresAt.mockResolvedValue(Date.now() - 1);
    const { view } = await openWith({ vod: [vod('10', 'Old Movie')] });
    view.deactivate();
    catalogMock.loadAllVodStreams.mockResolvedValue([vod('11', 'New Movie')]);
    catalogMock.loadAllSeries.mockResolvedValue([]);

    await view.open(account);
    await indexReady(view);
    await view.setQuery('movie');

    expect(catalogMock.loadAllVodStreams).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(container.textContent).toContain('New Movie'));
    expect(container.textContent).not.toContain('Old Movie');
  });

  it('rebuilds the index after the shared worker was terminated while inactive', async () => {
    const { view } = await openWith();
    view.deactivate();
    workerMock.running = false;

    await view.open(account);

    expect(workerMock.run.mock.calls.filter(
      ([task, payload]) => task === 'search.index' && (payload as SearchIndexRequest).reset,
    )).toHaveLength(2);
  });

  it('rebuilds the index when playlist data changes while inactive', async () => {
    const { view } = await openWith();
    view.deactivate();
    playlistMock.channels = [chan('Bravo')];

    await view.open(account);
    await view.setQuery('bravo');

    expect(workerMock.run.mock.calls.filter(
      ([task, payload]) => task === 'search.index' && (payload as SearchIndexRequest).reset,
    )).toHaveLength(2);
    expect(container.textContent).toContain('Bravo');
  });

  it('renders Channels / Movies / Series result rails when the query is set', async () => {
    playlistMock.channels = [chan('Channel One')];
    const { view } = await openWith({ vod: [vod('10', 'Movie One')], series: [ser('s1', 'Series One')] });
    await view.setQuery('one');
    expect(container.querySelector('.catalog-tile[data-channel-index="0"]')?.textContent).toContain('Channel One');
    expect(container.querySelector('.catalog-tile[data-stream-id="10"]')?.textContent).toContain('Movie One');
    expect(container.querySelector('.catalog-tile[data-series-id="s1"]')?.textContent).toContain('Series One');
  });

  it('publishes a bounded first batch from 50,000 ranked results', async () => {
    const initial = CONFIG.SEARCH.INITIAL_RESULTS;
    const many = Array.from(
      { length: CONFIG.SEARCH.RESULT_CAP + 5 },
      (_, i) => vod(String(i), `Movie ${i}`),
    );
    const { view } = await openWith({ vod: many });
    await view.setQuery('movie');
    expect(initial).toBe(200);
    expect(container.querySelectorAll('.catalog-tile[data-stream-id]').length).toBeLessThan(30);
    expect(container.querySelector<HTMLElement>(
      '[data-search-virtual="movies"] .search-virtual-rail-spacer',
    )?.style.width).toBe(`${String(initial * 240)}px`);
  });

  it('expands the ranked batch near the virtual rail boundary', async () => {
    const many = Array.from(
      { length: 2_000 },
      (_, i) => vod(String(i), `Movie ${i}`),
    );
    const { view } = await openWith({ vod: many });
    await view.setQuery('movie');
    const rail = container.querySelector<HTMLElement>('[data-search-virtual="movies"]')!;
    rail.scrollLeft = CONFIG.SEARCH.INITIAL_RESULTS * 240;
    rail.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(container.querySelector<HTMLElement>(
      '[data-search-virtual="movies"] .search-virtual-rail-spacer',
    )?.style.width).toBe(
      `${String(CONFIG.SEARCH.INITIAL_RESULTS
        * CONFIG.SEARCH.EXPANSION_FACTOR * 240)}px`,
    );
  });

  it('does not open a focused result the rail scrolled out of its window', async () => {
    const many = Array.from({ length: 400 }, (_, i) => vod(String(i), `Movie ${i}`));
    const { view, handlers } = await openWith({ vod: many });
    Focus.setBase(() => view.focusScope);
    await view.setQuery('movie');
    view.focusFirstResult();
    Focus.flush();
    const first = container.querySelector<HTMLElement>('.catalog-tile[data-key="v:0"]')!;
    expect(first.classList.contains('focused')).toBe(true);

    const rail = container.querySelector<HTMLElement>('[data-search-virtual="movies"]')!;
    rail.scrollLeft = 24_000;
    rail.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    Focus.flush();
    expect(first.isConnected).toBe(false);
    expect(container.querySelector('.focused')).toBeNull();

    view.handleAction('select');
    expect(handlers.onOpenMovie).not.toHaveBeenCalled();
  });

  it('publishes only the newest query scheduled in one frame', async () => {
    playlistMock.channels = [chan('Alpha'), chan('Bravo')];
    const { view } = await openWith();
    view.scheduleQuery('alpha');
    view.scheduleQuery('bravo');
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(container.textContent).toContain('Bravo');
    expect(container.textContent).not.toContain('Alpha');
  });

  it('discards a slower response from an older query', async () => {
    playlistMock.channels = [chan('Alpha'), chan('Bravo')];
    const { view } = await openWith();
    const originalRun = workerMock.run.getMockImplementation()!;
    let resolveAlpha!: (value: unknown) => void;
    workerMock.run.mockImplementation((task: string, payload: SearchQueryRequest) => {
      if (task === 'search.query' && payload.query === 'alpha') {
        return new Promise(resolve => { resolveAlpha = resolve; });
      }
      return originalRun(task, payload);
    });

    const alpha = view.setQuery('alpha');
    await view.setQuery('bravo');
    resolveAlpha({
      channels: { indices: [0], hasMore: false },
      programmes: { indices: [], hasMore: false },
      movies: { indices: [], hasMore: false },
      series: { indices: [], hasMore: false },
    });
    await alpha;

    expect(container.textContent).toContain('Bravo');
    expect(container.textContent).not.toContain('Alpha');
    workerMock.run.mockImplementation(originalRun);
  });

  it('rebuilds worker indexes after a query failure', async () => {
    playlistMock.channels = [chan('Alpha')];
    const { view } = await openWith();
    const originalRun = workerMock.run.getMockImplementation()!;
    let failed = false;
    workerMock.run.mockImplementation((task: string, payload: SearchQueryRequest) => {
      if (task === 'search.query' && !failed) {
        failed = true;
        return Promise.reject(new Error('worker restarted'));
      }
      return originalRun(task, payload);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const info = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await view.setQuery('alpha');

    expect(container.textContent).toContain('Alpha');
    expect(diagEvents(info, 'search.worker.recovery.completed'))
      .toEqual([expect.stringMatching(/reason=query_failed elapsedMs=\d+$/)]);
    info.mockRestore();
    expect(workerMock.run).toHaveBeenCalledWith(
      'search.index',
      expect.objectContaining({ reset: true }),
    );
    workerMock.run.mockImplementation(originalRun);
  });

  it('plays a channel result on select via its playlist index', async () => {
    playlistMock.channels = [chan('Channel One')];
    playlistMock.indexOf.mockReturnValue(7);
    const { view, handlers } = await openWith();
    await view.setQuery('one');
    const tile = container.querySelector('.catalog-tile[data-channel-index="7"]') as HTMLElement;
    tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayChannel).toHaveBeenCalledWith(7);
  });

  it('routes a movie result to onOpenMovie and a series result to onOpenSeries', async () => {
    const { view, handlers } = await openWith({ vod: [vod('10', 'Movie One')], series: [ser('s1', 'Series One')] });
    await view.setQuery('one');
    const movie = container.querySelector('.catalog-tile[data-stream-id="10"]') as HTMLElement;
    movie.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onOpenMovie).toHaveBeenCalledWith(account, expect.objectContaining({ streamId: '10' }));

    const series = container.querySelector('.catalog-tile[data-series-id="s1"]') as HTMLElement;
    series.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onOpenSeries).toHaveBeenCalledWith(account, expect.objectContaining({ seriesId: 's1' }));
  });

  it('shows the preparing hint instead of results or No results until the index is ready', async () => {
    playlistMock.channels = [chan('Alpha')];
    let finishVod!: (items: unknown[]) => void;
    catalogMock.loadAllVodStreams.mockReturnValue(new Promise((resolve) => { finishVod = resolve; }));
    catalogMock.loadAllSeries.mockResolvedValue([]);
    const info = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const view = new Search(container, mkHandlers());
    await view.open(account, 'alpha');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const hint = container.querySelector('.search-results .catalog-hint.search-empty');
    expect(hint?.textContent).toBe('Preparing search…');
    expect(container.textContent).not.toContain('No results');
    // No partial results: the channel already indexed stays hidden.
    expect(container.querySelector('.catalog-tile')).toBeNull();
    expect(workerMock.run.mock.calls.some(([task]) => task === 'search.query')).toBe(false);
    await view.setQuery('zzz');
    expect(container.textContent).toContain('Preparing search…');
    expect(container.textContent).not.toContain('No results');

    view.scheduleQuery('alpha');
    finishVod([vod('10', 'Alpha Movie')]);
    await vi.waitFor(() => expect(container.textContent).toContain('Alpha Movie'));
    expect(container.textContent).not.toContain('Preparing search…');
    expect(container.querySelector('.catalog-tile[data-channel-index="0"]')).not.toBeNull();
    const [ready] = diagEvents(info, 'search.index.ready');
    expect(ready).toMatch(/mode=fallback channels=1 programmes=0 items=1 persisted=0 built=0 posted=2/);
    expect(Number(ready.match(/hintMs=(\d+)/)?.[1])).toBeGreaterThanOrEqual(40);
    info.mockRestore();
  });

  it('waits in the search box while the index prepares, then focuses the first result', async () => {
    playlistMock.channels = [chan('Alpha')];
    let finishVod!: (items: unknown[]) => void;
    catalogMock.loadAllVodStreams.mockReturnValue(new Promise((resolve) => { finishVod = resolve; }));
    catalogMock.loadAllSeries.mockResolvedValue([]);
    const box = document.createElement('input');
    box.className = 'tab-bar-search-input';
    document.body.appendChild(box);
    const handlers = mkHandlers();
    handlers.onRevealTabBar.mockImplementation(() => box.focus());
    handlers.onReleaseTabBar.mockImplementation(() => box.blur());
    const view = new Search(container, handlers);
    Focus.setBase(() => view.focusScope);
    await view.open(account, 'alpha');
    await new Promise((resolve) => setTimeout(resolve, 50));
    view.focusFirstResult();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.activeElement).toBe(box);
    expect(container.querySelector('.focused')).toBeNull();

    finishVod([vod('10', 'Movie Two')]);
    await vi.waitFor(() => expect(handlers.onReleaseTabBar).toHaveBeenCalledTimes(1));
    expect(container.querySelector('.catalog-tile[data-channel-index="0"]')?.classList.contains('focused'))
      .toBe(true);
    box.remove();
  });

  it('marks the index ready when the catalog fails to load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    playlistMock.channels = [chan('Alpha')];
    catalogMock.loadAllVodStreams.mockRejectedValue(new Error('offline'));
    catalogMock.loadAllSeries.mockRejectedValue(new Error('offline'));
    const view = new Search(container, mkHandlers());
    await view.open(account, 'alpha');

    await vi.waitFor(() => expect(container.querySelector('.catalog-tile[data-channel-index="0"]')).not.toBeNull());
    expect(container.textContent).not.toContain('Preparing search…');
    error.mockRestore();
  });

  it('posts a source the worker cannot read in frame-sized chunks', async () => {
    const total = CONFIG.SEARCH.INDEX_CHUNK_SIZE * 2 + 5;
    playlistMock.channels = Array.from({ length: total }, (_, i) => chan(`Channel ${i}`));
    const view = new Search(container, mkHandlers());
    await view.open(null);
    await indexReady(view);

    const chunks = workerMock.run.mock.calls
      .map(([, payload]) => (payload as SearchIndexRequest).chunk)
      .filter(chunk => chunk?.source === 'channels');
    expect(chunks.map(chunk => [chunk!.start, chunk!.documents!.length, chunk!.total])).toEqual([
      [0, CONFIG.SEARCH.INDEX_CHUNK_SIZE, total],
      [CONFIG.SEARCH.INDEX_CHUNK_SIZE, CONFIG.SEARCH.INDEX_CHUNK_SIZE, total],
      [CONFIG.SEARCH.INDEX_CHUNK_SIZE * 2, 5, total],
    ]);
    await view.setQuery(`channel ${total - 1}`);
    expect(container.querySelector('.search-channel-row, [data-channel-index]')).not.toBeNull();
  });

  it('re-indexes a stale catalog once its background refresh lands', async () => {
    const view = new Search(container, mkHandlers());
    const refreshed = catalogMock.onCatalogListRefreshed.mock.calls[0][0] as (key: string) => void;
    catalogMock.getSearchCatalogExpiresAt.mockResolvedValue(Date.now() - 1);
    catalogMock.loadAllVodStreams.mockResolvedValue([vod('10', 'Old Movie')]);
    catalogMock.loadAllSeries.mockResolvedValue([]);
    await view.open(account, 'movie');
    await vi.waitFor(() => expect(container.textContent).toContain('Old Movie'));

    catalogMock.getSearchCatalogExpiresAt.mockResolvedValue(Date.now() + 60000);
    catalogMock.loadAllVodStreams.mockResolvedValue([vod('11', 'New Movie')]);
    refreshed('x1|vod_all');

    await vi.waitFor(() => expect(container.textContent).toContain('New Movie'));
    expect(container.textContent).not.toContain('Old Movie');
  });

  it('rebuilds the index when a background catalog refresh fails to reach the worker', async () => {
    const view = new Search(container, mkHandlers());
    const refreshed = catalogMock.onCatalogListRefreshed.mock.calls[0][0] as (key: string) => void;
    catalogMock.getSearchCatalogExpiresAt.mockResolvedValue(Date.now() - 1);
    catalogMock.loadAllVodStreams.mockResolvedValue([vod('10', 'Old Movie')]);
    catalogMock.loadAllSeries.mockResolvedValue([]);
    await view.open(account, 'movie');
    await vi.waitFor(() => expect(container.textContent).toContain('Old Movie'));

    const run = workerMock.run.getMockImplementation()!;
    let rejected = false;
    workerMock.run.mockImplementation(async (task: string, payload: unknown) => {
      if (!rejected && (payload as SearchIndexRequest).chunk?.source === 'movies') {
        rejected = true;
        return { accepted: false };
      }
      return run(task, payload);
    });
    try {
      catalogMock.getSearchCatalogExpiresAt.mockResolvedValue(Date.now() + 60000);
      catalogMock.loadAllVodStreams.mockResolvedValue([vod('11', 'New Movie')]);
      refreshed('x1|vod_all');

      await vi.waitFor(() => expect(container.textContent).toContain('New Movie'));
      expect(rejected).toBe(true);
    } finally {
      workerMock.run.mockImplementation(run);
    }
  });

  it('maps a query answered mid-refresh onto the catalog the worker ranked', async () => {
    const handlers = mkHandlers();
    const view = new Search(container, handlers);
    const refreshed = catalogMock.onCatalogListRefreshed.mock.calls[0][0] as (key: string) => void;
    catalogMock.getSearchCatalogExpiresAt.mockResolvedValue(Date.now() - 1);
    catalogMock.loadAllVodStreams.mockResolvedValue([vod('10', 'Alpha Movie')]);
    catalogMock.loadAllSeries.mockResolvedValue([]);
    await view.open(account);
    await indexReady(view);

    let expire: (value: number) => void = () => undefined;
    catalogMock.getSearchCatalogExpiresAt.mockReturnValue(new Promise(resolve => { expire = resolve; }));
    catalogMock.loadAllVodStreams.mockResolvedValue([vod('11', 'Bravo Movie'), vod('10', 'Alpha Movie')]);
    const asked = catalogMock.getSearchCatalogExpiresAt.mock.calls.length;
    refreshed('x1|vod_all');
    await vi.waitFor(() => expect(catalogMock.getSearchCatalogExpiresAt.mock.calls.length).toBe(asked + 1));

    // The page holds the new list; the worker still ranks the old one.
    await view.setQuery('alpha');
    expect(container.textContent).toContain('Alpha Movie');
    expect(container.textContent).not.toContain('Bravo Movie');
    const tile = container.querySelector('.catalog-tile[data-stream-id]') as HTMLElement;
    expect(tile.dataset.streamId).toBe('10');
    tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onOpenMovie).toHaveBeenCalledWith(account, expect.objectContaining({ streamId: '10' }));

    expire(Date.now() + 60000);
    await vi.waitFor(() => expect(catalogMock.loadAllVodStreams).toHaveBeenCalledTimes(2));
    await view.setQuery('movie');
    await vi.waitFor(() => expect(container.textContent).toContain('Bravo Movie'));
    expect(container.querySelectorAll('.catalog-tile[data-stream-id]')).toHaveLength(2);
  });

  it('logs each source a rejected channel post leaves incomplete', async () => {
    playlistMock.channels = [chan('Alpha')];
    const run = workerMock.run.getMockImplementation()!;
    let rejected = false;
    workerMock.run.mockImplementation(async (task: string, payload: unknown) => {
      if (!rejected && (payload as SearchIndexRequest).chunk?.source === 'channels') {
        rejected = true;
        return { accepted: false };
      }
      return run(task, payload);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const view = new Search(container, mkHandlers());
      await view.open(null);
      await indexReady(view);
      expect(diagEvents(warn, 'search.index.lost')).toEqual([
        expect.stringMatching(/source=channels reason=rejected$/),
        expect.stringMatching(/source=programmes reason=rejected$/),
      ]);
    } finally {
      warn.mockRestore();
      workerMock.run.mockImplementation(run);
    }
  });

  it('runs one rebuild of a lost index for queries typed while it runs', async () => {
    playlistMock.channels = [chan('Alpha')];
    epgMock.programmes = { Alpha: [prog('Evening Report', Date.now() + 3600000, Date.now() + 7200000)] };
    const run = workerMock.run.getMockImplementation()!;
    let rejected = false;
    const held: Array<() => void> = [];
    let resets = 0;
    workerMock.run.mockImplementation(async (task: string, payload: unknown) => {
      const request = payload as SearchIndexRequest;
      if (!rejected && request.chunk?.source === 'programmes') {
        rejected = true;
        return { accepted: false };
      }
      if (rejected && request.reset) {
        resets++;
        await new Promise<void>(resolve => held.push(resolve));
      }
      return run(task, payload);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const view = new Search(container, mkHandlers());
      await view.open(null, 'report');
      await vi.waitFor(() => expect(held).toHaveLength(1));
      void view.setQuery('evening');
      void view.setQuery('evening report');
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(resets).toBe(1);
      expect((view as unknown as { workerIndexReady: boolean }).workerIndexReady).toBe(false);

      held.splice(0).forEach(release => release());
      await vi.waitFor(() => expect(container.querySelector('.search-program-row')?.textContent)
        .toContain('Evening Report'));
      expect(resets).toBe(1);
      expect((view as unknown as { workerIndexReady: boolean }).workerIndexReady).toBe(true);
      await view.setQuery('alpha');
      expect(container.textContent).toContain('Alpha');
      expect(resets).toBe(1);
    } finally {
      held.splice(0).forEach(release => release());
      warn.mockRestore();
      workerMock.run.mockImplementation(run);
    }
  });

  it('runs one recovery when a program refresh settles the last pending source', async () => {
    playlistMock.channels = [chan('Alpha')];
    const { view } = await openWith();
    await view.setQuery('report');
    const internals = view as unknown as { pendingIndex: unknown; workerIndexLost: boolean };
    internals.pendingIndex = { channels: false, programmes: true, catalog: false };
    internals.workerIndexLost = true;
    epgMock.programmes = { Alpha: [prog('Late Report', Date.now() + 3600000, Date.now() + 7200000)] };
    workerMock.run.mockClear();

    await view.refreshPrograms();
    await vi.waitFor(() => expect(container.querySelector('.search-program-row')?.textContent)
      .toContain('Late Report'));
    await new Promise(resolve => setTimeout(resolve, 50));
    const calls = workerMock.run.mock.calls;
    expect(calls.filter(([task, payload]) => task === 'search.index'
      && (payload as SearchIndexRequest).reset)).toHaveLength(1);
    expect(calls.filter(([task]) => task === 'search.query')).toHaveLength(1);
  });

  it('focuses a result that appears only once the catalog loads', async () => {
    let finishVod!: (items: unknown[]) => void;
    catalogMock.loadAllVodStreams.mockReturnValue(new Promise((resolve) => { finishVod = resolve; }));
    catalogMock.loadAllSeries.mockResolvedValue([]);
    const box = document.createElement('input');
    box.className = 'tab-bar-search-input';
    document.body.appendChild(box);
    const handlers = mkHandlers();
    handlers.onRevealTabBar.mockImplementation(() => box.focus());
    handlers.onReleaseTabBar.mockImplementation(() => box.blur());
    const view = new Search(container, handlers);
    Focus.setBase(() => view.focusScope);
    const opening = view.open(account);
    view.scheduleQuery('movie');
    view.focusFirstResult();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector('.catalog-tile')).toBeNull();
    // The remote waits in the box rather than on nothing.
    expect(document.activeElement).toBe(box);

    finishVod([vod('10', 'Movie One')]);
    await opening;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(handlers.onReleaseTabBar).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.catalog-tile[data-stream-id="10"]')?.classList.contains('focused')).toBe(true);
    box.remove();
  });

  it('leaves the remote where it went while the catalog loaded', async () => {
    let finishVod!: (items: unknown[]) => void;
    catalogMock.loadAllVodStreams.mockReturnValue(new Promise((resolve) => { finishVod = resolve; }));
    catalogMock.loadAllSeries.mockResolvedValue([]);
    const box = document.createElement('input');
    box.className = 'tab-bar-search-input';
    document.body.appendChild(box);
    const handlers = mkHandlers();
    handlers.onRevealTabBar.mockImplementation(() => box.focus());
    const view = new Search(container, handlers);
    Focus.setBase(() => view.focusScope);
    const opening = view.open(account);
    view.scheduleQuery('movie');
    view.focusFirstResult();
    await new Promise((resolve) => setTimeout(resolve, 50));
    box.blur();

    finishVod([vod('10', 'Movie One')]);
    await opening;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(handlers.onRevealTabBar).toHaveBeenCalledTimes(1);
    expect(handlers.onReleaseTabBar).not.toHaveBeenCalled();
    expect(container.querySelector('.catalog-tile.focused')).toBeNull();
    box.remove();
  });

  it('hands focus back to the search box when the query matches nothing', async () => {
    const { view, handlers } = await openWith({ vod: [vod('10', 'Movie One')] });
    await view.setQuery('zzz');
    view.focusFirstResult();
    expect(handlers.onRevealTabBar).toHaveBeenCalledTimes(1);
  });

  it('records the query when a result is opened', async () => {
    const { view } = await openWith({ vod: [vod('10', 'Movie One')] });
    await view.setQuery('  one ');
    container.querySelector<HTMLElement>('.catalog-tile[data-stream-id="10"]')!
      .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(storageMock.addSearchHistory).toHaveBeenCalledWith('  one ');
  });

  it('indexes channels, programmes, and the catalog from IndexedDB records', async () => {
    const source = [chan('Bravo'), chan('Alpha')];
    const alpha = { ...source[1], name: 'Alpha Prime', sourceName: 'Alpha' };
    playlistMock.channels = [alpha];
    const programmes = [prog('Evening Report', Date.now() + 3600000, Date.now() + 7200000)];
    epgMock.programmes = { Alpha: programmes };
    const movies = [vod('10', 'Alpha Movie'), vod('11', 'Bravo Movie')];
    const playlistRef = { store: 'playlist-cache', key: 'k', timestamp: 1 };
    const epgRef = { url: 'http://host/epg.xml', id: 'Alpha', timestamp: 2 };
    const vodRef = { store: 'catalog-cache', key: 'x1|vod_all', timestamp: 3 };
    cacheMock.records.set('playlist-cache|k', { timestamp: 1, data: { channels: source } });
    cacheMock.records.set('epg-cache|http://host/epg.xml', {
      timestamp: 2,
      data: { programmes: { Alpha: programmes } },
    });
    cacheMock.records.set('catalog-cache|x1|vod_all', { timestamp: 3, data: movies });
    cacheMock.refs.set(movies, vodRef);
    playlistMock.getChannelCacheSource.mockReturnValue({
      record: playlistRef,
      length: 2,
      selection: new Uint32Array([1]),
    });
    epgMock.programmeCacheOrigin.mockReturnValue(epgRef);
    const info = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const { view } = await openWith({ vod: movies });
    expect(diagEvents(info, 'search.index.ready')).toEqual([expect.stringMatching(
      /mode=cache channels=1 programmes=1 items=2 persisted=0 built=3 posted=0 elapsedMs=\d+ hintMs=0$/,
    )]);
    const requests = workerMock.run.mock.calls
      .filter(([task]) => task === 'search.index')
      .map(([, payload]) => payload as SearchIndexRequest);
    expect(requests.some(request => request.chunk && request.chunk.source !== 'series')).toBe(false);
    expect(requests.some(request => request.cachedChannels)).toBe(true);
    expect(requests.some(request => request.cachedProgrammes)).toBe(true);
    expect(requests.some(request => request.cachedMovies)).toBe(true);

    await view.setQuery('prime');
    expect(container.textContent).toContain('Alpha Prime');
    await view.setQuery('report');
    expect(container.querySelector('.search-program-row')?.textContent).toContain('Alpha Prime');
    await view.setQuery('bravo');
    expect(container.textContent).toContain('Bravo Movie');

    view.deactivate();
    workerMock.running = false;
    await view.open(account);
    await indexReady(view);
    expect(diagEvents(info, 'search.index.ready')[1])
      .toContain('mode=persisted channels=1 programmes=1 items=2 persisted=3 built=0 posted=0');
    info.mockRestore();
  });

  it('offers the indexes the worker built from IndexedDB records for storing', async () => {
    const source = [chan('Bravo'), chan('Alpha')];
    playlistMock.channels = [source[1]];
    cacheMock.records.set('playlist-cache|offer', { timestamp: 4, data: { channels: source } });
    playlistMock.getChannelCacheSource.mockReturnValue({
      record: { store: 'playlist-cache', key: 'offer', timestamp: 4 },
      length: 2,
      selection: new Uint32Array([1]),
    });

    await openWith();
    expect(persistMock).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'playlist-cache|offer|4|v1', prefix: 'playlist-cache|offer|' }),
    ]);
  });

  it('posts the documents a stale IndexedDB record cannot provide', async () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const channel = chan('Alpha');
    playlistMock.channels = [channel];
    epgMock.programmes = {
      Alpha: [prog('Evening Report', Date.now() + 3600000, Date.now() + 7200000)],
    };
    cacheMock.records.set('playlist-cache|stale', { timestamp: 9, data: { channels: [channel] } });
    playlistMock.getChannelCacheSource.mockReturnValue({
      record: { store: 'playlist-cache', key: 'stale', timestamp: 1 },
      length: 1,
      selection: new Uint32Array([0]),
    });
    epgMock.programmeCacheOrigin.mockReturnValue({ url: 'http://host/stale.xml', id: 'Alpha', timestamp: 2 });

    const { view } = await openWith();
    const posted = workerMock.run.mock.calls
      .filter(([task]) => task === 'search.index')
      .map(([, payload]) => payload as SearchIndexRequest);
    expect(posted.some(request => request.chunk?.source === 'channels'
      && request.chunk.documents?.length === 1)).toBe(true);
    expect(posted.some(request => request.chunk?.source === 'programmes'
      && request.chunk.documents?.length === 1)).toBe(true);
    expect(diagEvents(info, 'search.worker.cache.fallback')).toEqual([
      expect.stringMatching(/source=channels reason=record_changed$/),
      expect.stringMatching(/source=programmes reason=\w+$/),
    ]);
    expect(diagEvents(info, 'search.index.ready')[0]).toContain('mode=fallback');

    await view.setQuery('report');
    expect(container.querySelector('.search-program-row')?.textContent).toContain('Evening Report');
    info.mockRestore();
  });

  it('searches EPG program metadata and shows its channel and airtime', async () => {
    const channel = chan('Alpha');
    playlistMock.channels = [channel];
    epgMock.programmes = { Alpha: [prog('Evening Report', Date.now() + 3600000, Date.now() + 7200000)] };
    const { view } = await openWith();
    await view.setQuery('report');
    const row = container.querySelector('.search-program-row');
    expect(row?.textContent).toContain('Evening Report');
    expect(row?.textContent).toContain('Alpha');
    expect(row?.textContent).toContain('Set reminder');
  });

  it('lets overlapping chunked program posts take turns instead of colliding', async () => {
    const total = CONFIG.SEARCH.INDEX_CHUNK_SIZE * 2 + 5;
    const start = Date.now() + 3600000;
    playlistMock.channels = [chan('Alpha')];
    epgMock.programmes = {
      Alpha: Array.from({ length: total }, (_, i) => prog(`Show ${i}`, start + i * 60000, start + (i + 1) * 60000)),
    };
    const view = new Search(container, mkHandlers());
    await view.open(null);
    await indexReady(view);
    const internals = view as unknown as {
      workerSession: number;
      postSource(sessionId: number, source: string, total: number, at: (i: number) => string[]): Promise<boolean>;
    };
    const sessionId = internals.workerSession;
    const older = internals.postSource(sessionId, 'programmes', total, i => [`Old ${i}`]);
    const newer = internals.postSource(sessionId, 'programmes', total, i => [`Show ${i}`]);

    expect(await Promise.all([older, newer])).toEqual([true, true]);
    await view.setQuery(`show ${total - 1}`);
    expect(container.querySelector('.search-program-row')?.textContent).toContain(`Show ${total - 1}`);
  });

  it('runs a query typed while preparing once a program post is rejected', async () => {
    playlistMock.channels = [chan('Alpha')];
    epgMock.programmes = { Alpha: [prog('Evening Report', Date.now() + 3600000, Date.now() + 7200000)] };
    const run = workerMock.run.getMockImplementation()!;
    let rejected = false;
    workerMock.run.mockImplementation(async (task: string, payload: unknown) => {
      if (!rejected && (payload as SearchIndexRequest).chunk?.source === 'programmes') {
        rejected = true;
        return { accepted: false };
      }
      return run(task, payload);
    });
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const info = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const view = new Search(container, mkHandlers());
      await view.open(null, 'report');
      await vi.waitFor(() => expect(container.querySelector('.search-program-row')?.textContent)
        .toContain('Evening Report'));
      expect(container.textContent).not.toContain('Preparing search…');
      expect(diagEvents(warn, 'search.index.lost'))
        .toEqual([expect.stringMatching(/source=programmes reason=rejected$/)]);
      expect(diagEvents(info, 'search.index.ready')).toEqual([expect.stringContaining('mode=lost')]);
      expect(diagEvents(info, 'search.worker.recovery.completed'))
        .toEqual([expect.stringContaining('reason=lost')]);
      warn.mockRestore();
      info.mockRestore();
    } finally {
      workerMock.run.mockImplementation(run);
    }
  });

  it('rebuilds an index whose catalog post failed and never reuses it', async () => {
    const run = workerMock.run.getMockImplementation()!;
    let rejected = false;
    workerMock.run.mockImplementation(async (task: string, payload: unknown) => {
      if (!rejected && (payload as SearchIndexRequest).chunk?.source === 'movies') {
        rejected = true;
        return { accepted: false };
      }
      return run(task, payload);
    });
    try {
      const { view } = await openWith({ vod: [vod('10', 'Alpha Movie')] });
      const resets = (): number => workerMock.run.mock.calls.filter(
        ([task, payload]) => task === 'search.index' && (payload as SearchIndexRequest).reset,
      ).length;
      const before = resets();
      view.deactivate();
      await view.open(account);
      await indexReady(view);
      expect(resets()).toBeGreaterThan(before);

      await view.setQuery('alpha movie');
      expect(container.textContent).toContain('Alpha Movie');
    } finally {
      workerMock.run.mockImplementation(run);
    }
  });

  it('recovers movies when the catalog post fails during open', async () => {
    const run = workerMock.run.getMockImplementation()!;
    let rejected = false;
    workerMock.run.mockImplementation(async (task: string, payload: unknown) => {
      if (!rejected && (payload as SearchIndexRequest).chunk?.source === 'movies') {
        rejected = true;
        return { accepted: false };
      }
      return run(task, payload);
    });
    try {
      const { view } = await openWith({ vod: [vod('10', 'Alpha Movie')] });
      await view.setQuery('alpha movie');
      expect(container.textContent).toContain('Alpha Movie');
    } finally {
      workerMock.run.mockImplementation(run);
    }
  });

  it('keeps preparing for a pending catalog after a program post fails, then shows it', async () => {
    playlistMock.channels = [chan('Alpha')];
    epgMock.programmes = { Alpha: [prog('Evening Report', Date.now() + 3600000, Date.now() + 7200000)] };
    let finishVod: (value: unknown[]) => void = () => undefined;
    catalogMock.loadAllVodStreams.mockReturnValue(new Promise(resolve => { finishVod = resolve; }));
    catalogMock.loadAllSeries.mockResolvedValue([]);
    const run = workerMock.run.getMockImplementation()!;
    let rejected = false;
    workerMock.run.mockImplementation(async (task: string, payload: unknown) => {
      if (!rejected && (payload as SearchIndexRequest).chunk?.source === 'programmes') {
        rejected = true;
        return { accepted: false };
      }
      return run(task, payload);
    });
    try {
      const view = new Search(container, mkHandlers());
      void view.open(account, 'alpha');
      await vi.waitFor(() => expect(rejected).toBe(true));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(container.textContent).toContain('Preparing search…');
      expect(container.textContent).not.toContain('No results found.');

      finishVod([vod('10', 'Alpha Movie')]);
      await vi.waitFor(() => expect(container.textContent).toContain('Alpha Movie'));
      expect(container.textContent).toContain('Evening Report');
    } finally {
      workerMock.run.mockImplementation(run);
    }
  });

  it('recovers program results when a refresh loses its worker post', async () => {
    playlistMock.channels = [chan('Alpha')];
    const { view } = await openWith();
    await view.setQuery('report');
    epgMock.programmes = { Alpha: [prog('Late Report', Date.now() + 3600000, Date.now() + 7200000)] };
    const run = workerMock.run.getMockImplementation()!;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let crashed = false;
    workerMock.run.mockImplementation(async (task: string, payload: unknown) => {
      if (!crashed && (payload as SearchIndexRequest).chunk?.source === 'programmes') {
        crashed = true;
        throw new Error('worker crashed');
      }
      return run(task, payload);
    });
    try {
      await view.refreshPrograms();
      await vi.waitFor(() => expect(container.querySelector('.search-program-row')?.textContent)
        .toContain('Late Report'));
    } finally {
      workerMock.run.mockImplementation(run);
      error.mockRestore();
    }
  });

  it('refreshes program results when EPG finishes loading after Search opens', async () => {
    const channel = chan('Alpha');
    playlistMock.channels = [channel];
    const { view } = await openWith();
    await view.setQuery('report');
    expect(container.querySelector('.search-program-row')).toBeNull();

    epgMock.programmes = { Alpha: [prog('Late Report', Date.now() + 3600000, Date.now() + 7200000)] };
    await view.refreshPrograms();
    expect(container.querySelector('.search-program-row')?.textContent).toContain('Late Report');
  });

  it('refreshes a query typed while the initial program index is building', async () => {
    const channel = chan('Alpha');
    playlistMock.channels = [channel];
    epgMock.programmes = {
      Alpha: [prog('Late Report', Date.now() + 3600000, Date.now() + 7200000)],
    };
    catalogMock.loadAllVodStreams.mockResolvedValue([]);
    catalogMock.loadAllSeries.mockResolvedValue([]);
    const view = new Search(container, mkHandlers());

    const opening = view.open(account);
    await view.setQuery('report');
    await opening;

    expect(container.querySelector('.search-program-row')?.textContent)
      .toContain('Late Report');
  });

  it('does not build the program index until Search opens', async () => {
    const channel = chan('Alpha');
    playlistMock.channels = [channel];
    epgMock.programmes = {
      Alpha: [prog('Late Report', Date.now() + 3600000, Date.now() + 7200000)],
    };
    const view = new Search(container, mkHandlers());

    await view.refreshPrograms();
    expect(epgMock.findChannelId).not.toHaveBeenCalled();

    catalogMock.loadAllVodStreams.mockResolvedValue([]);
    catalogMock.loadAllSeries.mockResolvedValue([]);
    await view.open(null);
    expect(epgMock.findChannelId).toHaveBeenCalledWith(channel);
  });

  it('plays a current program and starts catch-up for an aired program', async () => {
    const now = Date.now();
    const liveChannel = chan('Alpha');
    const catchupChannel = { ...chan('Bravo'), catchupSource: '{utc}' };
    playlistMock.channels = [liveChannel, catchupChannel];
    epgMock.programmes = {
      Alpha: [prog('Live Report', now - 60000, now + 60000)],
      Bravo: [prog('Past Report', now - 120000, now - 60000)],
    };
    const { view, handlers } = await openWith();
    await view.setQuery('report');

    const rows = container.querySelectorAll<HTMLElement>('.search-program-row');
    rows[0].dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayChannel).toHaveBeenCalledWith(0, undefined);

    rows[1].dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayChannel).toHaveBeenCalledWith(1, expect.objectContaining({ title: 'Past Report' }));
  });

  it('offers resume or start over for a partially watched catch-up program', async () => {
    const now = Date.now();
    const start = now - 120000;
    const channel = { ...chan('Alpha'), catchupSource: '{utc}' };
    playlistMock.channels = [channel];
    epgMock.programmes = { Alpha: [prog('Past Report', start, now - 60000)] };
    storageMock.getCatchupProgressList.mockReturnValue([{
      channelKey: 'key',
      progStart: start,
      progEnd: now - 60000,
      position: 30,
      duration: 60,
      updatedAt: now,
      completed: false,
    }]);
    const { view, handlers } = await openWith();
    await view.setQuery('past');
    const row = container.querySelector('.search-program-row') as HTMLElement;
    row.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(document.querySelector('.catchup-resume-prompt')?.classList.contains('hidden')).toBe(false);
    expect(storageMock.addSearchHistory).not.toHaveBeenCalled();

    view.handleAction('select');
    expect(handlers.onPlayChannel).toHaveBeenCalledWith(0, expect.objectContaining({ resumeSecs: 30 }));
    expect(storageMock.addSearchHistory).toHaveBeenCalledWith('past');
  });

  it('does not play an Xtream program whose has_archive flag is false', async () => {
    const now = Date.now();
    const channel = {
      ...chan('Alpha'),
      catchupSource: '{utc}',
      catchupAccountId: 'x1',
      catchupStreamId: '101',
    };
    playlistMock.channels = [channel];
    epgMock.programmes = { Alpha: [prog('Past Report', now - 120000, now - 60000)] };
    archiveMock.load.mockResolvedValue(new Set());
    archiveMock.isAvailable.mockReturnValue(false);
    const { view, handlers } = await openWith();
    await view.setQuery('past');
    const row = container.querySelector('.search-program-row') as HTMLElement;
    row.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    await Promise.resolve();

    expect(handlers.onPlayChannel).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith("This program isn't available for catch-up.");
    expect(storageMock.addSearchHistory).not.toHaveBeenCalled();
  });

  it('toggles a reminder for a future program', async () => {
    const now = Date.now();
    const channel = chan('Alpha');
    playlistMock.channels = [channel];
    epgMock.programmes = { Alpha: [prog('Future Report', now + 60000, now + 120000)] };
    const { view } = await openWith();
    await view.setQuery('future');
    const row = container.querySelector('.search-program-row') as HTMLElement;
    row.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(reminderMock.add).toHaveBeenCalledWith(expect.objectContaining({
      channelName: 'Alpha',
      title: 'Future Report',
    }));
    expect(storageMock.addSearchHistory).not.toHaveBeenCalled();
  });

  it('opens an Xtream movie result on a pointer click', async () => {
    const { view, handlers } = await openWith({ vod: [vod('10', 'Movie One')] });
    await view.setQuery('one');
    const movie = container.querySelector('.catalog-tile[data-stream-id="10"]') as HTMLElement;
    const orig = document.elementFromPoint;
    document.elementFromPoint = () => movie;
    container.dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 50, bubbles: true }));
    document.elementFromPoint = orig;
    expect(handlers.onOpenMovie).toHaveBeenCalledWith(account, expect.objectContaining({ streamId: '10' }));
  });

  it('shows a no-results message when nothing matches', async () => {
    const { view } = await openWith();
    await view.setQuery('zzz');
    expect(container.textContent).toContain('No results');
  });

  it('focusFirstResult moves focus into the first result (tab bar handoff)', async () => {
    playlistMock.channels = [chan('Channel One')];
    const { view } = await openWith();
    Focus.setBase(() => view.focusScope);
    await view.setQuery('one');
    view.focusFirstResult();
    Focus.flush();
    expect(container.querySelector('.catalog-tile.focused')).not.toBeNull();
  });

  it('reveals the tab bar when Up cannot move within the view', async () => {
    const { view, handlers } = await openWith();
    view.handleAction('up');
    expect(handlers.onRevealTabBar).toHaveBeenCalled();
  });

  it('goes back to Live from Search', async () => {
    const { view, handlers } = await openWith();
    view.handleAction('back');
    expect(handlers.onBack).toHaveBeenCalled();
  });

  it('keeps a catalog load running across close and reopen', async () => {
    playlistMock.channels = [chan('Alpha')];
    let finish!: (items: unknown[]) => void;
    catalogMock.loadAllVodStreams.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    catalogMock.loadAllSeries.mockResolvedValue([]);
    const view = new Search(container, mkHandlers());
    await view.open(account);
    const signal = catalogMock.loadAllVodStreams.mock.calls[0][1] as AbortSignal;

    view.deactivate();
    expect(signal.aborted).toBe(false);
    await view.open(account, 'alpha');
    finish([vod('10', 'Alpha Movie')]);

    await vi.waitFor(() => expect(container.textContent).toContain('Alpha Movie'));
    expect(catalogMock.loadAllVodStreams).toHaveBeenCalledTimes(1);
  });

  it('aborts a catalog load when Search reopens for another account', async () => {
    catalogMock.loadAllVodStreams.mockReturnValue(new Promise(() => undefined));
    catalogMock.loadAllSeries.mockReturnValue(new Promise(() => undefined));
    const view = new Search(container, mkHandlers());
    await view.open(account);
    const signal = catalogMock.loadAllVodStreams.mock.calls[0][1] as AbortSignal;

    view.deactivate();
    await view.open({ ...account, id: 'x2' });

    expect(signal.aborted).toBe(true);
  });

  it('a superseded a1 load cannot clobber a2 catalog (account-switch race)', async () => {
    const a1: PlaylistEntry = { id: 'a1', name: 'A1', url: 'http://host/a', source: 'xtream', xtream: { username: 'u1', password: 'p1' } };
    const a2: PlaylistEntry = { id: 'a2', name: 'A2', url: 'http://host/a', source: 'xtream', xtream: { username: 'u2', password: 'p2' } };

    let resolveA1Vod!: (v: unknown) => void;
    let resolveA2Vod!: (v: unknown) => void;
    let resolveA1Series!: (v: unknown) => void;
    let resolveA2Series!: (v: unknown) => void;

    catalogMock.loadAllVodStreams
      .mockReturnValueOnce(new Promise((r) => { resolveA1Vod = r; }))
      .mockReturnValueOnce(new Promise((r) => { resolveA2Vod = r; }));
    catalogMock.loadAllSeries
      .mockReturnValueOnce(new Promise((r) => { resolveA1Series = r; }))
      .mockReturnValueOnce(new Promise((r) => { resolveA2Series = r; }));

    const view = new Search(container, mkHandlers());

    // Start both opens concurrently; neither load has resolved yet.
    const p1 = view.open(a1);
    const a1Signal = catalogMock.loadAllVodStreams.mock.calls[0][1] as AbortSignal;
    const p2 = view.open(a2);
    expect(a1Signal.aborted).toBe(true);
    expect(catalogMock.loadAllVodStreams.mock.calls[1][1]).toBeInstanceOf(AbortSignal);

    // Resolve a2's load first — it should commit as the current account.
    resolveA2Vod([vod('v2', 'Bravo Movie')]);
    resolveA2Series([]);
    await p2;

    // Resolve a1's stale load last — the guard should discard it.
    resolveA1Vod([vod('v1', 'Alpha Movie')]);
    resolveA1Series([]);
    await p1;

    await view.setQuery('movie');
    expect(container.textContent).toContain('Bravo Movie');
    expect(container.textContent).not.toContain('Alpha Movie');
  });

  it('does not retain the previous account catalog when the next load fails', async () => {
    const { view } = await openWith({ vod: [vod('v1', 'Alpha Movie')] });
    const a2: PlaylistEntry = {
      id: 'a2',
      name: 'A2',
      url: 'http://host/a',
      source: 'xtream',
      xtream: { username: 'u2', password: 'p2' },
    };
    catalogMock.loadAllVodStreams.mockRejectedValue(new Error('failed'));
    catalogMock.loadAllSeries.mockRejectedValue(new Error('failed'));

    await view.open(a2);
    await view.setQuery('movie');

    expect(container.textContent).not.toContain('Alpha Movie');
  });

  it('keeps movie search available when the series catalog fails', async () => {
    catalogMock.loadAllVodStreams.mockResolvedValue([vod('v1', 'Alpha Movie')]);
    catalogMock.loadAllSeries.mockRejectedValue(new Error('failed'));
    const view = new Search(container, mkHandlers());

    await view.open(account);
    await view.setQuery('movie');

    expect(container.textContent).toContain('Alpha Movie');
  });
});

describe('Search (M3U-only, no account)', () => {
  async function openM3U() {
    const handlers = mkHandlers();
    const view = new Search(container, handlers);
    await view.open(null);
    return { view, handlers };
  }

  it('does not load a catalog for an M3U-only account', async () => {
    await openM3U();
    expect(catalogMock.loadAllVodStreams).not.toHaveBeenCalled();
    expect(catalogMock.loadAllSeries).not.toHaveBeenCalled();
  });

  it('renders channel results as a vertical list (no poster rails)', async () => {
    playlistMock.channels = [chan('Alpha News'), chan('Beta News')];
    playlistMock.indexOf.mockImplementation((ch: { name: string }) => (ch.name === 'Alpha News' ? 0 : 1));
    const { view } = await openM3U();
    await view.setQuery('news');
    expect(container.querySelectorAll('.search-channel-row').length).toBe(2);
    expect(container.querySelector('.catalog-rail')).toBeNull();
    expect(container.querySelector('.search-channels .catalog-rail-title')?.textContent).toBe('Channels');
    const cells = container.querySelectorAll<HTMLElement>('.search-virtual-list-cell');
    expect(cells[0].style.top).toBe('0px');
    expect(cells[1].style.top).toBe('88px');
  });

  it('plays a channel row on select', async () => {
    playlistMock.channels = [chan('Alpha News')];
    playlistMock.indexOf.mockReturnValue(3);
    const { view, handlers } = await openM3U();
    await view.setQuery('news');
    const row = container.querySelector('.search-channel-row') as HTMLElement;
    row.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayChannel).toHaveBeenCalledWith(3);
  });

  it('plays a channel row on a pointer click', async () => {
    playlistMock.channels = [chan('Alpha News')];
    playlistMock.indexOf.mockReturnValue(5);
    const { handlers, view } = await openM3U();
    await view.setQuery('news');
    const row = container.querySelector('.search-channel-row') as HTMLElement;
    const orig = document.elementFromPoint;
    document.elementFromPoint = () => row;
    container.dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 50, bubbles: true }));
    document.elementFromPoint = orig;
    expect(handlers.onPlayChannel).toHaveBeenCalledWith(5);
  });
});
