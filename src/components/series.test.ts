// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PlaylistEntry, WatchlistEntry, WatchlistKind } from '../types';
import type { CatalogSortPreference } from '../utils/catalog-sort';

const { catalogMock, storageMock, watchlistState, toastMock } = vi.hoisted(() => {
  const watchlistState = { entries: [] as WatchlistEntry[] };
  return {
    catalogMock: { loadSeriesCategories: vi.fn(), loadSeries: vi.fn(), loadSeriesInfo: vi.fn() },
    watchlistState,
    storageMock: {
      getCatalogSort: vi.fn((): CatalogSortPreference => ({ by: 'default', direction: 'asc' })),
      setCatalogSort: vi.fn((_kind: 'vod' | 'series', _sort: CatalogSortPreference) => true),
      getResumeList: vi.fn(() => [] as unknown[]),
      getTmdbApiKey: vi.fn(() => ''),
      isWatched: vi.fn(() => false),
      getResume: vi.fn(() => null),
      getWatchlist: vi.fn(() => watchlistState.entries),
      isWatchlisted: vi.fn((_accountId: string, _kind: WatchlistKind, itemId: string) =>
        watchlistState.entries.some((entry) => entry.itemId === itemId)),
      toggleWatchlist: vi.fn((entry: WatchlistEntry) => {
        const index = watchlistState.entries.findIndex((item) => item.itemId === entry.itemId);
        if (index >= 0) {
          watchlistState.entries.splice(index, 1);
          return 'removed' as const;
        }
        watchlistState.entries.unshift(entry);
        return 'added' as const;
      }),
    },
    toastMock: { showToast: vi.fn() },
  };
});
vi.mock('../services/xtream-catalog', () => catalogMock);
vi.mock('../services/storage-service', () => ({ StorageService: storageMock }));
vi.mock('./toast', () => ({ showToast: toastMock.showToast }));

import { Series } from './series';
import { setLocale } from '../i18n';
import { Focus } from '../navigation/focus-scope';

const account: PlaylistEntry = {
  id: 'x1', name: 'X', url: 'http://host:8080', source: 'xtream', xtream: { username: 'u', password: 'p' },
};
const series = (id: string, name: string, categoryId = '1') => ({
  accountId: 'x1', seriesId: id, name, poster: '', rating: '', categoryId,
});

let container: HTMLElement;
function eventLines(spy: { mock: { calls: unknown[][] } }, code: string): string[] {
  return spy.mock.calls.map((args) => args.join(' ')).filter((l) => l.includes(`event=${code} `));
}

beforeEach(() => {
  Focus.uninstall();
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  // clearAllMocks clears calls but not implementations; re-establish defaults so a
  // prior test's mockReturnValue override doesn't leak (order-safety).
  storageMock.getResumeList.mockReturnValue([]);
  storageMock.getResume.mockReturnValue(null);
  storageMock.getCatalogSort.mockReturnValue({ by: 'default', direction: 'asc' });
  storageMock.setCatalogSort.mockReturnValue(true);
  watchlistState.entries = [];
  container = document.createElement('div');
  document.body.appendChild(container);
});

async function openWith(cats = [{ id: '1', name: 'Cat A' }], items = [series('s1', 'Series One')]) {
  catalogMock.loadSeriesCategories.mockResolvedValue(cats);
  catalogMock.loadSeries.mockResolvedValue(items);
  const handlers = { onBack: vi.fn(), onPlayVod: vi.fn() };
  const view = new Series(container, handlers);
  Focus.setBase(() => view.focusScope);
  await view.open(account);
  return { view, handlers };
}

describe('Series browse + grid', () => {
  // An entry saved before resume points named their series.
  it('plays an episode saved without its series directly, returning to its neighbor once it completes', async () => {
    const entries = ['e1', 'e2', 'e3', 'e4'].map((itemId, i) => ({
      accountId: 'x1', kind: 'episode', itemId, name: `Title ${i}`, poster: '', ext: 'mp4',
      position: 100, duration: 600, updatedAt: 4 - i,
    }));
    storageMock.getResumeList.mockReturnValue(entries);
    const { view, handlers } = await openWith();
    const episode = container.querySelector<HTMLElement>('[data-resume-episode="e3"]')!;
    episode.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'e3' }));
    storageMock.getResumeList.mockReturnValue([entries[0], entries[1], entries[3]]);
    view.refreshPlaybackState();
    expect(container.querySelector('.catalog-layer-browse .focused')?.getAttribute('data-key')).toBe('r:e4');
  });

  // Two episodes of one series, the older one picked.
  const owned = () => ['e2', 'e1'].map((itemId, i) => ({
    accountId: 'x1', kind: 'episode', itemId, ext: 'mp4', poster: '',
    name: itemId === 'e2' ? 'Series One — S2E1 — Episode Two' : 'Series One — S1E1 — Episode One',
    position: 300, duration: 1500, updatedAt: 2 - i, categoryId: '1',
    watchlistOwner: { kind: 'series', itemId: 's1' },
  }));
  function useResume(entries: ReturnType<typeof owned>): void {
    storageMock.getResumeList.mockReturnValue(entries);
    (storageMock.getResume as ReturnType<typeof vi.fn>).mockImplementation(
      (_account: string, _kind: string, id: string) => entries.find(entry => entry.itemId === id) ?? null);
  }
  const browseFocus = () => container.querySelector('.catalog-layer-browse .focused')?.getAttribute('data-key');

  it('opens the series page from a Continue Watching episode, with Resume on that episode', async () => {
    const entries = owned();
    useResume(entries);
    catalogMock.loadSeriesInfo.mockResolvedValue(SERIES_INFO);
    const { view, handlers } = await openWith();
    container.querySelector<HTMLElement>('[data-rail-key="continue"] [data-resume-episode="e1"]')!
      .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    await Promise.resolve(); await Promise.resolve();
    expect(handlers.onPlayVod).not.toHaveBeenCalled();
    expect(catalogMock.loadSeriesInfo).toHaveBeenCalledWith(account, 's1', expect.anything());
    expect(container.querySelector('.catalog-layer-detail .detail-title')?.textContent).toBe('Series One');
    const resume = container.querySelector<HTMLElement>('[data-action="resume"]')!;
    expect(resume.textContent).toContain('Resume S1E1');
    resume.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'e1', resumeSecs: 300 }));

    // Playback moved the episode to the front; Back lands on it in the rail.
    useResume([{ ...entries[1], updatedAt: 3 }, entries[0]]);
    view.refreshPlaybackState();
    view.handleAction('back');
    expect(container.querySelector('.catalog-layer-browse')?.classList.contains('catalog-layer-hidden')).toBe(false);
    expect(container.querySelector('[data-rail-key="continue"] .catalog-tile')?.getAttribute('data-key')).toBe('r:e1');
    expect(browseFocus()).toBe('r:e1');
  });

  it('opens the series page on the episode after a finished one, playing it from the start', async () => {
    useResume([{
      accountId: 'x1', kind: 'episode', itemId: 'e2', ext: 'mkv', poster: '',
      name: 'Series One — S2E1 — Episode Two', position: 0, duration: 0, updatedAt: 3, categoryId: '1',
      watchlistOwner: { kind: 'series', itemId: 's1' },
    }]);
    (storageMock.getResume as ReturnType<typeof vi.fn>).mockReturnValue(null);
    catalogMock.loadSeriesInfo.mockResolvedValue(SERIES_INFO);
    const { view, handlers } = await openWith();
    const tile = container.querySelector<HTMLElement>('[data-rail-key="continue"] [data-resume-episode="e2"]')!;
    expect(tile.querySelector('.catalog-progress')).toBeNull();
    tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    await Promise.resolve(); await Promise.resolve();
    const resume = container.querySelector<HTMLElement>('[data-action="resume"]')!;
    expect(resume.textContent).toContain('Resume S2E1');
    expect(container.querySelector('[data-action="restart"]')).toBeNull();
    resume.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'e2', resumeSecs: 0 }));
  });

  it('names a series missing from the loaded rails from its episode', async () => {
    useResume(owned());
    catalogMock.loadSeriesInfo.mockResolvedValue(SERIES_INFO);
    const { view } = await openWith([], []);
    container.querySelector<HTMLElement>('[data-resume-episode="e2"]')!
      .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    await Promise.resolve(); await Promise.resolve();
    expect(catalogMock.loadSeriesInfo).toHaveBeenCalledWith(account, 's1', expect.anything());
    expect(container.querySelector('.catalog-layer-detail .detail-title')?.textContent).toBe('Series One');
    expect(container.querySelector('[data-action="resume"]')?.textContent).toContain('Resume S2E1');
    view.handleAction('back');
    expect(browseFocus()).toBe('r:e2');
  });

  it('leaves the Continue rail when its only episode completes from the series page', async () => {
    useResume(owned().slice(1));
    catalogMock.loadSeriesInfo.mockResolvedValue(SERIES_INFO);
    const { view, handlers } = await openWith();
    container.querySelector<HTMLElement>('[data-resume-episode="e1"]')!
      .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    await Promise.resolve(); await Promise.resolve();
    container.querySelector<HTMLElement>('[data-action="resume"]')!
      .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'e1' }));
    useResume([]);
    view.refreshPlaybackState();
    view.handleAction('back');
    expect(container.querySelector('[data-rail-key="continue"]')).toBeNull();
    expect(container.querySelector('.catalog-layer-browse .focused')).not.toBeNull();
  });

  // Past RAIL_CATEGORIES, so All categories opens a category page, where sorting lives.
  const sevenCats = Array.from({ length: 7 }, (_, i) => ({ id: String(i + 1), name: `Cat ${i + 1}` }));
  const grid = () => container.querySelector<HTMLElement>('.catalog-layer-grid')!;
  function openCategory(view: Series): void {
    container.querySelector<HTMLElement>('.catalog-cat[data-category-id="1"]')!
      .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
  }

  it('restores its own saved sort field and direction', async () => {
    storageMock.getCatalogSort.mockReturnValue({ by: 'name', direction: 'desc' });
    const { view } = await openWith(sevenCats, [series('s1', 'Title 1'), series('s2', 'Title 2'), series('s10', 'Title 10')]);
    expect(storageMock.getCatalogSort).toHaveBeenCalledWith('series');
    expect(Array.from(container.querySelectorAll<HTMLElement>(
      '[data-rail-key="cat:1"] .catalog-tile',
    )).map(el => el.dataset.itemId)).toEqual(['s10', 's2', 's1']);
    expect(container.querySelector('.catalog-layer-browse .catalog-sort')).toBeNull();
    openCategory(view);
    expect(grid().querySelector('[data-sort-direction="desc"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('writes series direction changes without changing movie preferences', async () => {
    const { view } = await openWith(sevenCats, [series('s2', 'Title 2'), series('s1', 'Title 1')]);
    openCategory(view);
    grid().querySelector<HTMLElement>('.dropdown-trigger')!.click();
    grid().querySelector<HTMLElement>('[data-dropdown-value="name"]')!.click();
    grid().querySelector<HTMLElement>('[data-sort-direction="desc"]')!.click();
    expect(storageMock.setCatalogSort).toHaveBeenLastCalledWith('series', { by: 'name', direction: 'desc' });
    expect(storageMock.setCatalogSort.mock.calls.every(([kind]) => kind === 'series')).toBe(true);
    expect(view.focusScope.focusKey).toBe(JSON.stringify(['grid', '', 'sort-direction:desc']));
  });

  it('labels See all with the series count', async () => {
    await openWith([{ id: '1', name: 'Cat A' }], Array.from({ length: 21 }, (_, i) => series(`s${String(i)}`, `Series ${String(i)}`)));
    expect(container.querySelector('.catalog-see-all')?.textContent).toContain('21 series');
  });

  it('renders a rail per preloaded category with poster tiles', async () => {
    await openWith([{ id: '1', name: 'Cat A' }], [series('s1', 'Series One')]);
    expect(container.querySelector('.catalog-rail-title')?.textContent).toContain('Cat A');
    expect(container.querySelector('.catalog-tile[data-item-id="s1"]')?.textContent).toContain('Series One');
  });

  it('updates the hero to the focused series with its list details', async () => {
    const s1 = {
      accountId: 'x1', seriesId: 's1', name: 'Series One', poster: 'http://host/a1.jpg', rating: '', categoryId: '1',
      genre: 'Genre 1', year: 2001, plot: 'Plot 1', backdrop: 'http://host/b1.jpg',
    };
    const s2 = { accountId: 'x1', seriesId: 's2', name: 'Series Two', poster: 'http://host/a2.jpg', rating: '', categoryId: '1' };
    await openWith([{ id: '1', name: 'Cat A' }], [s1, s2]);
    const art = () => container.querySelector<HTMLElement>('.catalog-hero-art')!;
    const title = () => container.querySelector('.catalog-hero-title')?.textContent;
    expect(container.querySelector('.catalog-hero-kicker')).toBeNull();
    expect(title()).toBe('Series One');

    container.querySelector('.catalog-tile[data-item-id="s2"]')!
      .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    expect(title()).toBe('Series Two');
    expect(art().style.backgroundImage).toContain('a2.jpg');
    expect(art().classList.contains('catalog-hero-art-soft')).toBe(true);
    expect(container.querySelector('.catalog-hero-meta')?.textContent).toBe('');
    expect(container.querySelector('.catalog-hero-plot')).toBeNull();

    container.querySelector('.catalog-tile[data-item-id="s1"]')!
      .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    expect(title()).toBe('Series One');
    expect(art().style.backgroundImage).toContain('b1.jpg');
    expect(art().classList.contains('catalog-hero-art-soft')).toBe(false);
    expect(container.querySelector('.catalog-hero-meta')?.textContent).toBe('Genre 1  ·  2001');
    expect(container.querySelector('.catalog-hero-plot')?.textContent).toBe('Plot 1');
    expect(catalogMock.loadSeriesInfo).not.toHaveBeenCalled();
  });

  it('keeps an untrusted title and artwork URL inert in the hero', async () => {
    const hostile = {
      ...series('s1', '<img src=x onerror=alert(1)>'),
      poster: "http://host/a.jpg') ; background: url('http://host/evil",
      plot: '<b>bold</b>',
    };
    await openWith([{ id: '1', name: 'Cat A' }], [hostile]);
    const hero = container.querySelector<HTMLElement>('.catalog-hero')!;
    expect(hero.querySelector('img, b')).toBeNull();
    expect(hero.querySelector('.catalog-hero-title')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(hero.querySelector('.catalog-hero-plot')?.textContent).toBe('<b>bold</b>');
    const bg = hero.querySelector<HTMLElement>('.catalog-hero-art')!.style.backgroundImage;
    expect(bg).not.toContain("')");
    expect(bg).not.toContain('evil\'');
  });

  it('shows a Continue rail from the episode resume list and resumes an episode directly', async () => {
    storageMock.getResumeList.mockReturnValue([
      { accountId: 'x1', kind: 'episode', itemId: 'e1', name: 'Series One — S1E1 — Episode One', poster: '', ext: 'mkv', position: 300, duration: 1500, updatedAt: 1 },
    ]);
    const { view, handlers } = await openWith();
    expect(container.textContent).toContain('Continue Watching');
    const tile = container.querySelector('.catalog-tile[data-resume-episode="e1"]') as HTMLElement;
    expect(tile).not.toBeNull();
    tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'e1', accountId: 'x1', kind: 'episode', resumeSecs: 300,
      url: 'http://host:8080/series/u/p/e1.mkv',
    }));
  });

  it.each([true, false])('updates the hero from resumed episodes with a loaded category: %s', async withCategory => {
    storageMock.getResumeList.mockReturnValue([1, 2].map(n => ({
      accountId: 'x1', kind: 'episode', itemId: `e${n}`, name: `Episode ${n}`,
      poster: `http://host/episode${n}.jpg`, ext: 'mp4',
      position: 100, duration: 600, updatedAt: 3 - n,
    })));
    await openWith(withCategory ? [{ id: '1', name: 'Cat A' }] : [], withCategory
      ? [{ ...series('s1', 'Series One'), poster: 'http://host/catalog.jpg' }] : []);
    const hero = container.querySelector<HTMLElement>('.catalog-hero')!;
    for (const n of [2, 1]) {
      container.querySelector<HTMLElement>(`[data-resume-episode="e${n}"]`)!
        .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
      expect(container.querySelector('.catalog-hero-title')?.textContent).toBe(`Episode ${n}`);
      expect(hero.querySelector<HTMLElement>('.catalog-hero-art')!.style.backgroundImage).toContain(`episode${n}.jpg`);
    }
    if (withCategory) {
      container.querySelector<HTMLElement>('[data-item-id="s1"]')!
        .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
      expect(container.querySelector('.catalog-hero-title')?.textContent).toBe('Series One');
      expect(hero.querySelector<HTMLElement>('.catalog-hero-art')!.style.backgroundImage).toContain('catalog.jpg');
    }
    expect(catalogMock.loadSeriesInfo).not.toHaveBeenCalled();
  });

  it('shows a Watchlist rail from stored series snapshots', async () => {
    watchlistState.entries = [{
      accountId: 'x1', kind: 'series', itemId: 's9', name: 'Saved Series',
      poster: '', rating: '', categoryId: '9', addedAt: 2,
    }];
    catalogMock.loadSeriesInfo.mockResolvedValue({ seasons: [], episodesBySeason: {} });
    const { view } = await openWith();
    expect(container.textContent).toContain('Watchlist');
    const tile = container.querySelector('.catalog-tile[data-item-id="s9"]') as HTMLElement;
    expect(tile.textContent).toContain('Saved Series');
    tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    await Promise.resolve(); await Promise.resolve();
    expect(container.querySelector('.series-detail')?.textContent).toContain('Saved Series');
  });

  it('leaves Up at the top and Left at the left edge on the focused tile', async () => {
    const { view, handlers } = await openWith();
    const start = container.querySelector('.focused');
    expect(start).not.toBeNull();
    view.handleAction('up');
    expect(container.querySelector('.catalog-sort')).toBeNull();
    view.handleAction('left');
    expect(container.querySelector('.focused')).toBe(start);
    expect(handlers.onBack).not.toHaveBeenCalled();
  });

  it('drills into a non-rail category grid and back to browse', async () => {
    // 7 categories: the first RAIL_CATEGORIES (6) become poster rails; the 7th
    // is a non-rail tile in the "All Categories" rail — the drill-in target.
    const cats = Array.from({ length: 7 }, (_, i) => ({ id: String(i + 1), name: `Cat ${i + 1}` }));
    const { view, handlers } = await openWith(cats, [series('s1', 'Series One')]);
    const cat = container.querySelector('.catalog-cat[data-category-id="7"]') as HTMLElement;
    expect(cat).not.toBeNull();
    cat.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    catalogMock.loadSeries.mockResolvedValue([series('s2', 'Series Two', '7')]);
    view.handleAction('select');
    await Promise.resolve(); await Promise.resolve();
    expect(container.querySelector('.catalog-grid')).not.toBeNull();
    expect(container.querySelector('.catalog-tile[data-item-id="s2"]')).not.toBeNull();
    view.handleAction('back');
    expect(container.querySelector('.catalog-browse')).not.toBeNull();
    expect(handlers.onBack).not.toHaveBeenCalled();
  });

  it('opens a series detail on select and backs out to browse', async () => {
    catalogMock.loadSeriesInfo.mockResolvedValue({ seasons: [], episodesBySeason: {} });
    const { view, handlers } = await openWith();
    const tile = container.querySelector('.catalog-tile[data-item-id="s1"]') as HTMLElement;
    tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    await Promise.resolve(); await Promise.resolve();
    expect(container.querySelector('.series-detail')).not.toBeNull();
    expect(container.textContent).toContain('Series One');
    view.handleAction('back');
    expect(container.querySelector('.catalog-browse')).not.toBeNull();
    expect(handlers.onBack).not.toHaveBeenCalled();
  });

  it('returns from a removed Watchlist series to its rail neighbor, not its category twin', async () => {
    const saved = (id: string, addedAt: number): WatchlistEntry => ({
      accountId: 'x1', kind: 'series', itemId: id, name: `Series ${id}`, poster: '',
      rating: '', categoryId: '1', addedAt,
    });
    watchlistState.entries = [saved('s0', 3), saved('s1', 2), saved('s2', 1)];
    catalogMock.loadSeriesInfo.mockResolvedValue({ seasons: [], episodesBySeason: {} });
    const { view } = await openWith(
      [{ id: '1', name: 'Cat A' }],
      [series('s0', 'Series s0'), series('s1', 'Series s1'), series('s2', 'Series s2')],
    );
    const watchlist = container.querySelector('[data-rail-key="watchlist"]')!;
    watchlist.querySelector('[data-item-id="s1"]')!
      .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    await Promise.resolve(); await Promise.resolve();
    container.querySelector('[data-action="watchlist"]')!
      .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    view.handleAction('back');

    const focused = container.querySelector<HTMLElement>('.catalog-browse .focused');
    expect(focused?.closest('[data-rail-key]')?.getAttribute('data-rail-key')).toBe('watchlist');
    expect(focused?.dataset.itemId).toBe('s2');
  });

  it('goes back to Live from the browse top level', async () => {
    const { view, handlers } = await openWith();
    view.handleAction('back');
    expect(handlers.onBack).toHaveBeenCalled();
  });

  it('refreshes the Continue rail from storage on each browse render', async () => {
    catalogMock.loadSeriesInfo.mockResolvedValue({ seasons: [], episodesBySeason: {} });
    const { view } = await openWith();
    expect(container.textContent).not.toContain('Continue Watching');
    // An episode is watched, so a resume entry now exists; walking detail -> browse
    // should surface it without re-entering the section.
    storageMock.getResumeList.mockReturnValue([
      { accountId: 'x1', kind: 'episode', itemId: 'e1', name: 'Series One — S1E1', poster: '', ext: 'mp4', position: 300, duration: 1500, updatedAt: 1 },
    ]);
    const tile = container.querySelector('.catalog-tile[data-item-id="s1"]') as HTMLElement;
    tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    await Promise.resolve(); await Promise.resolve();
    view.handleAction('back'); // detail -> browse re-render
    expect(container.textContent).toContain('Continue Watching');
  });
});

const SERIES_INFO = {
  plot: 'Series plot.',
  cast: 'Actor 1, Actor 2',
  director: 'Director 1',
  genre: 'Drama',
  releaseDate: '2021-02-03',
  episodeRunTimeMins: 45,
  poster: 'http://host/series.jpg',
  rating: '8.4',
  imdbId: '1234567',
  tmdbId: '7654',
  year: 2021,
  seasons: [1, 2],
  episodesBySeason: {
    1: [{ id: 'e1', title: 'Episode One', season: 1, episode: 1, containerExtension: 'mp4', durationSecs: 1500, plot: 'Ep plot.', poster: '' }],
    2: [{ id: 'e2', title: 'Episode Two', season: 2, episode: 1, containerExtension: 'mkv', durationSecs: 1600, plot: '', poster: '' }],
  },
};

function metaParts(): string[] {
  return Array.from(container.querySelectorAll('.detail-meta-part')).map(part => part.textContent?.trim() ?? '');
}

async function openDetail(view: Series) {
  const tile = container.querySelector('.catalog-tile[data-item-id="s1"]') as HTMLElement;
  tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
  view.handleAction('select');
  await Promise.resolve(); await Promise.resolve(); // info-less render, then the loaded render
}

describe('Series detail', () => {
  it('renders a bounded episode window for a 50,000-item season', async () => {
    const episodes = Array.from({ length: 50_000 }, (_, index) => ({
      id: `e${String(index)}`,
      title: `Episode ${String(index)}`,
      season: 1,
      episode: index + 1,
      containerExtension: 'mp4',
      durationSecs: 1500,
      plot: '',
      poster: '',
      subtitles: [],
    }));
    catalogMock.loadSeriesInfo.mockResolvedValue({
      seasons: [1],
      episodesBySeason: { 1: episodes },
    });
    const { view } = await openWith();
    await openDetail(view);

    expect(container.querySelectorAll('.episode-card').length).toBeLessThan(20);
    expect(container.querySelector<HTMLElement>('.episode-track-spacer')?.style.width)
      .toBe('21400000px');

    const track = container.querySelector<HTMLElement>('.episode-track')!;
    track.scrollLeft = 100 * 428;
    track.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const episode = container.querySelector<HTMLElement>(
      '[data-episode-index="100"] .episode-card',
    )!;
    episode.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));

    view.refreshPlaybackState();
    Focus.flush();

    expect(container.querySelector<HTMLElement>('.focused')?.dataset.key).toBe('ep:e100');
  });

  it('brings in an episode the list scrolled away instantly when a held key reaches it', async () => {
    const episodes = Array.from({ length: 500 }, (_, index) => ({
      id: `e${String(index)}`,
      title: `Episode ${String(index)}`,
      season: 1,
      episode: index + 1,
      containerExtension: 'mp4',
      durationSecs: 1500,
      plot: '',
      poster: '',
      subtitles: [],
    }));
    catalogMock.loadSeriesInfo.mockResolvedValue({ seasons: [1], episodesBySeason: { 1: episodes } });
    let now = 1_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { view } = await openWith();
      await openDetail(view);
      const detail = container.querySelector<HTMLElement>('.episode-track')!;
      const keyOf = (index: number): string => {
        const row = container.querySelector<HTMLElement>(`[data-episode-index="${String(index)}"] [data-key]`)!;
        const rail = row.closest<HTMLElement>('[data-rail-key]')?.dataset.railKey ?? '';
        return JSON.stringify(['detail', rail, row.dataset.key]);
      };
      const first = keyOf(0);
      view.focusScope.focus(keyOf(1), 'key');
      Focus.flush();

      let top = 0;
      const behaviors: string[] = [];
      Object.defineProperty(detail, 'scrollLeft', {
        configurable: true,
        get: () => top,
        set: (value: number) => { top = value; behaviors.push(detail.style.scrollBehavior); },
      });
      top = 100 * 428;
      detail.dispatchEvent(new Event('scroll', { bubbles: true }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(container.querySelector('[data-episode-index="0"]')).toBeNull();
      behaviors.length = 0;

      view.focusScope.focus(first, 'key');
      Focus.flush();

      expect(container.querySelector('[data-episode-index="0"]')).not.toBeNull();
      expect(behaviors.length).toBeGreaterThan(0);
      expect(behaviors).toEqual(behaviors.map(() => 'auto'));
    } finally {
      clock.mockRestore();
    }
  });

  it('scrolls smoothly again when a later input reveals the same episode a held key reached', async () => {
    const episodes = Array.from({ length: 500 }, (_, index) => ({
      id: `e${String(index)}`,
      title: `Episode ${String(index)}`,
      season: 1,
      episode: index + 1,
      containerExtension: 'mp4',
      durationSecs: 1500,
      plot: '',
      poster: '',
      subtitles: [],
    }));
    catalogMock.loadSeriesInfo.mockResolvedValue({ seasons: [1], episodesBySeason: { 1: episodes } });
    let now = 1_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { view } = await openWith();
      await openDetail(view);
      const detail = container.querySelector<HTMLElement>('.episode-track')!;
      const keyOf = (index: number): string => {
        const row = container.querySelector<HTMLElement>(`[data-episode-index="${String(index)}"] [data-key]`)!;
        const rail = row.closest<HTMLElement>('[data-rail-key]')?.dataset.railKey ?? '';
        return JSON.stringify(['detail', rail, row.dataset.key]);
      };
      const first = keyOf(0);
      view.focusScope.focus(keyOf(1), 'key');
      Focus.flush();

      let top = 0;
      const behaviors: string[] = [];
      Object.defineProperty(detail, 'scrollLeft', {
        configurable: true,
        get: () => top,
        set: (value: number) => { top = value; behaviors.push(detail.style.scrollBehavior); },
      });
      const scrollAway = async (): Promise<void> => {
        top = 100 * 428;
        detail.dispatchEvent(new Event('scroll', { bubbles: true }));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        expect(container.querySelector('[data-episode-index="0"]')).toBeNull();
        behaviors.length = 0;
      };
      await scrollAway();
      now += 50;
      view.focusScope.focus(first, 'key');
      Focus.flush();
      expect(behaviors.length).toBeGreaterThan(0);
      expect(behaviors).toEqual(behaviors.map(() => 'auto'));

      for (let frame = 0; frame < 2; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      await scrollAway();
      now += 1_000;
      view.focusScope.focus(first, 'key');
      Focus.flush();

      expect(container.querySelector('[data-episode-index="0"]')).not.toBeNull();
      expect(behaviors.length).toBeGreaterThan(0);
      expect(behaviors).not.toContain('auto');
    } finally {
      clock.mockRestore();
    }
  });

  it('brings a scrolled-away episode into the row when focus reaches it', async () => {
    const episodes = Array.from({ length: 500 }, (_, index) => ({
      id: `e${String(index)}`,
      title: `Episode ${String(index)}`,
      season: 1,
      episode: index + 1,
      containerExtension: 'mp4',
      durationSecs: 1500,
      plot: '',
      poster: '',
      subtitles: [],
    }));
    catalogMock.loadSeriesInfo.mockResolvedValue({ seasons: [1], episodesBySeason: { 1: episodes } });
    const { view } = await openWith();
    await openDetail(view);
    const card = container.querySelector<HTMLElement>('[data-episode-index="0"] [data-key]')!;
    const rail = card.closest<HTMLElement>('[data-rail-key]')?.dataset.railKey ?? '';
    expect(container.querySelector('[data-episode-index="40"]')).toBeNull();

    view.focusScope.focus(JSON.stringify(['detail', rail, 'ep:e40']), 'key');
    Focus.flush();

    const list = (view as unknown as {
      episodeVirtualizer: { scrollOffset: number; getItemOffset(index: number): number };
    }).episodeVirtualizer;
    const viewport = 1760;
    expect(list.getItemOffset(41) - list.getItemOffset(40)).toBe(428);
    expect(list.getItemOffset(41)).toBeLessThanOrEqual(list.scrollOffset + viewport);
    expect(list.getItemOffset(40)).toBeGreaterThanOrEqual(list.scrollOffset);
    expect(container.querySelector<HTMLElement>('.episode-track')!.scrollLeft).toBe(list.scrollOffset);
    expect(container.querySelector<HTMLElement>('.focused')?.dataset.key).toBe('ep:e40');
  });

  it('steps through episodes with Left and Right and stays put at either end', async () => {
    catalogMock.loadSeriesInfo.mockResolvedValue(SERIES_INFO);
    const { view } = await openWith();
    await openDetail(view);
    const first = container.querySelector<HTMLElement>('.episode-card')!;
    first.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('left');
    Focus.flush();
    expect(container.querySelector<HTMLElement>('.focused')?.dataset.key).toBe(first.dataset.key);
  });

  it('adds and removes the series from Watchlist without losing button focus', async () => {
    catalogMock.loadSeriesInfo.mockResolvedValue(SERIES_INFO);
    const { view } = await openWith();
    await openDetail(view);

    const button = container.querySelector('[data-action="watchlist"]') as HTMLElement;
    button.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(storageMock.toggleWatchlist).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'x1', kind: 'series', itemId: 's1', name: 'Series One',
    }));
    expect(container.querySelector('[data-action="watchlist"]')?.getAttribute('aria-pressed')).toBe('true');
    Focus.flush();
    expect(container.querySelector('.focused')?.getAttribute('data-key')).toBe('watchlist');
    expect(toastMock.showToast).toHaveBeenLastCalledWith('Added to Watchlist');

    view.handleAction('select');
    expect(container.querySelector('[data-action="watchlist"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(toastMock.showToast).toHaveBeenLastCalledWith('Removed from Watchlist');
  });

  it('keeps a provider episode title that already names the series and episode', async () => {
    const first = SERIES_INFO.episodesBySeason[1][0];
    catalogMock.loadSeriesInfo.mockResolvedValue({
      ...SERIES_INFO,
      episodesBySeason: { ...SERIES_INFO.episodesBySeason, 1: [{ ...first, title: 'Series One - S01E01 - Pilot' }] },
    });
    const { view, handlers } = await openWith();
    await openDetail(view);
    const row = container.querySelector(`.episode-card[data-episode-id="${first.id}"]`) as HTMLElement;
    row.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({ title: 'Series One - S01E01 - Pilot' }));
  });

  it('names episodes in the UI language, a placeholder title included', async () => {
    const first = SERIES_INFO.episodesBySeason[1][0];
    catalogMock.loadSeriesInfo.mockResolvedValue({
      ...SERIES_INFO,
      episodesBySeason: { ...SERIES_INFO.episodesBySeason, 1: [{ ...first, title: 'Episode 6', episode: 6 }] },
    });
    setLocale('ar');
    try {
      const { view, handlers } = await openWith();
      await openDetail(view);
      const row = container.querySelector(`.episode-card[data-episode-id="${first.id}"]`) as HTMLElement;
      expect(row.querySelector('.episode-title')?.textContent).toBe('ح6 · الحلقة 6');
      row.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
      view.handleAction('select');
      expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Series One — م1ح6 — الحلقة 6',
      }));
    } finally {
      setLocale('en');
    }
  });

  it.each([
    ['the season letter', 'م'],
    ['the season letter saved before it was corrected', 'س'],
  ])('finds the series and episode in an Arabic resume label with %s', async (_case, letter) => {
    catalogMock.loadSeriesInfo.mockResolvedValue(SERIES_INFO);
    storageMock.getResumeList.mockReturnValue([
      { accountId: 'x1', kind: 'episode', itemId: 'e9', name: `Series One — ${letter}2ح1 — الحلقة 1`, poster: '', ext: 'mkv', position: 300, duration: 1600, updatedAt: 1, watchlistOwner: { kind: 'series', itemId: 's1' } },
    ]);
    const { view } = await openWith();
    await openDetail(view);
    expect(container.querySelector('[data-action="resume"]')?.textContent).toContain('Resume S2E1');
  });

  it('renders a season selector and the first season\'s episodes, and plays from the start', async () => {
    catalogMock.loadSeriesInfo.mockResolvedValue(SERIES_INFO);
    const { view, handlers } = await openWith();
    await openDetail(view);

    expect(metaParts()).toEqual(['2021', '2 seasons', 'Drama', '8.4']);
    expect(container.querySelector('.detail-plot')?.textContent).toBe('Series plot.');
    expect(Array.from(container.querySelectorAll('.detail-person-name')).map(n => n.textContent))
      .toEqual(['Actor 1', 'Actor 2', 'Director 1']);
    expect(Array.from(container.querySelectorAll('.detail-person-role')).map(n => n.textContent))
      .toEqual(['Director']);
    expect(Array.from(container.querySelectorAll('.detail-person-initials')).map(n => n.textContent))
      .toEqual(['A', 'A', 'D']);
    expect(container.querySelector<HTMLImageElement>('.detail-poster-wrap img')?.src)
      .toBe('http://host/series.jpg');
    expect(container.querySelector('.series-season-btn[data-season="1"]')?.textContent).toContain('Season 1');
    expect(container.querySelector('.series-season-btn[data-season="2"]')).not.toBeNull();
    expect(container.querySelector('.episode-card[data-episode-id="e1"]')?.textContent).toContain('Episode One');

    const row = container.querySelector('.episode-card[data-episode-id="e1"]') as HTMLElement;
    row.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'e1', accountId: 'x1', kind: 'episode', resumeSecs: 0,
      url: 'http://host:8080/series/u/p/e1.mp4',
      title: expect.stringContaining('S1E1'),
      watchlistOwner: { kind: 'series', itemId: 's1' },
      previousEpisodes: [],
      episodeQueue: [
        expect.objectContaining({
          itemId: 'e2',
          url: 'http://host:8080/series/u/p/e2.mkv',
          title: expect.stringContaining('S2E1'),
          watchlistOwner: { kind: 'series', itemId: 's1' },
        }),
      ],
    }));
  });

  it('renders the normalized year when no release date is available', async () => {
    catalogMock.loadSeriesInfo.mockResolvedValue({
      ...SERIES_INFO,
      releaseDate: '',
      year: 2022,
    });
    const { view } = await openWith();
    await openDetail(view);

    expect(metaParts()).toEqual(['2022', '2 seasons', 'Drama', '8.4']);
  });

  it('switches season and plays that season\'s episode with its own container extension', async () => {
    catalogMock.loadSeriesInfo.mockResolvedValue(SERIES_INFO);
    const { view, handlers } = await openWith();
    await openDetail(view);

    const season2 = container.querySelector('.series-season-btn[data-season="2"]') as HTMLElement;
    season2.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(container.querySelector('.episode-card[data-episode-id="e2"]')).not.toBeNull();
    expect(container.querySelector('.episode-card[data-episode-id="e1"]')).toBeNull();

    const row = container.querySelector('.episode-card[data-episode-id="e2"]') as HTMLElement;
    row.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 'e2', kind: 'episode', url: 'http://host:8080/series/u/p/e2.mkv',
      // Previous episode reaches back across the season boundary.
      previousEpisodes: [expect.objectContaining({ itemId: 'e1', url: 'http://host:8080/series/u/p/e1.mp4' })],
      episodeQueue: [],
    }));
  });

  it('marks an episode with a resume point and passes its saved position', async () => {
    catalogMock.loadSeriesInfo.mockResolvedValue(SERIES_INFO);
    storageMock.getResume.mockImplementation((_a: string, _k: string, id: string) =>
      id === 'e1' ? { accountId: 'x1', kind: 'episode', itemId: 'e1', name: '', poster: '', position: 450, duration: 1500, updatedAt: 1 } : null);
    const { view, handlers } = await openWith();
    await openDetail(view);

    expect(container.querySelector('.episode-card[data-episode-id="e1"] .catalog-progress-fill')).not.toBeNull();
    const row = container.querySelector('.episode-card[data-episode-id="e1"]') as HTMLElement;
    row.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'e1', resumeSecs: 450 }));
  });

  it('resumes the last-watched episode from the detail and opens on its season', async () => {
    catalogMock.loadSeriesInfo.mockResolvedValue(SERIES_INFO);
    const saved = {
      accountId: 'x1', kind: 'episode', itemId: 'e2', name: 'Series One — S2E1 — Episode Two',
      poster: '', ext: 'mkv', position: 400, duration: 1600, updatedAt: 2,
      watchlistOwner: { kind: 'series', itemId: 's1' },
    };
    storageMock.getResumeList.mockReturnValue([saved]);
    storageMock.getResume.mockImplementation((_a: string, _k: string, id: string) => (id === 'e2' ? saved : null));
    const { view, handlers } = await openWith();
    await openDetail(view);

    const resume = container.querySelector<HTMLElement>('[data-action="resume"]')!;
    expect(resume.textContent).toContain('Resume S2E1');
    expect(resume.querySelector('.detail-btn-progress')).toBeNull();
    expect(Array.from(container.querySelectorAll<HTMLElement>('.detail-actions [data-action]'))
      .map(el => el.dataset.action)).toEqual(['resume', 'restart', 'watchlist']);
    expect(container.querySelector('.series-season-btn.active')?.getAttribute('data-season')).toBe('2');
    expect(container.querySelector('.focused')?.getAttribute('data-key')).toBe('resume');
    view.handleAction('select');
    expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'e2', resumeSecs: 400 }));
  });

  it('plays the resumed episode from the start with Play from start', async () => {
    catalogMock.loadSeriesInfo.mockResolvedValue(SERIES_INFO);
    const saved = {
      accountId: 'x1', kind: 'episode', itemId: 'e2', name: 'Series One — S2E1 — Episode Two',
      poster: '', ext: 'mkv', position: 400, duration: 1600, updatedAt: 2,
      watchlistOwner: { kind: 'series', itemId: 's1' },
    };
    storageMock.getResumeList.mockReturnValue([saved]);
    storageMock.getResume.mockImplementation((_a: string, _k: string, id: string) => (id === 'e2' ? saved : null));
    const { view, handlers } = await openWith();
    await openDetail(view);

    const restart = container.querySelector<HTMLElement>('[data-action="restart"]')!;
    expect(restart.textContent).toContain('Play from start');
    restart.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'e2', resumeSecs: 0 }));
  });

  it('fills the progress bar of a watched episode', async () => {
    catalogMock.loadSeriesInfo.mockResolvedValue(SERIES_INFO);
    storageMock.isWatched.mockImplementation((_a: string, kind: string, id: string) => kind === 'episode' && id === 'e1');
    try {
      const { view } = await openWith();
      await openDetail(view);
      const fill = container.querySelector<HTMLElement>('.episode-card[data-episode-id="e1"] .catalog-progress-fill');
      expect(fill?.style.width).toBe('100%');
    } finally {
      storageMock.isWatched.mockImplementation(() => false);
    }
  });

  it('plays the first episode from Play when nothing was watched', async () => {
    catalogMock.loadSeriesInfo.mockResolvedValue(SERIES_INFO);
    const { view, handlers } = await openWith();
    await openDetail(view);
    expect(container.querySelector('[data-action="resume"]')).toBeNull();
    container.querySelector<HTMLElement>('[data-action="play"]')!
      .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'e1', resumeSecs: 0 }));
  });

  it('restores the episodes before and after from Continue Watching', async () => {
    const next = {
      url: 'http://host:8080/series/u/p/e2.mkv', title: 'Series One — S2E1 — Episode Two',
      poster: '', accountId: 'x1', itemId: 'e2', kind: 'episode', subtitles: [],
    };
    const previous = { ...next, itemId: 'e0', title: 'Series One — S0E1' };
    storageMock.getResumeList.mockReturnValue([
      {
        accountId: 'x1', kind: 'episode', itemId: 'e1', name: 'Series One — S1E1',
        poster: '', ext: 'mp4', position: 450, duration: 1500, updatedAt: 1,
        episodeQueue: [next],
        previousEpisodes: [previous],
        watchlistOwner: { kind: 'series', itemId: 's1' },
      },
    ]);
    // The episodes failed to load, so Resume plays the saved entry as stored.
    catalogMock.loadSeriesInfo.mockResolvedValue(null);
    const { view, handlers } = await openWith();
    const tile = container.querySelector('.catalog-tile[data-resume-episode="e1"]') as HTMLElement;
    tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    await Promise.resolve(); await Promise.resolve();
    expect(handlers.onPlayVod).not.toHaveBeenCalled();
    container.querySelector<HTMLElement>('[data-action="resume"]')!
      .dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    view.handleAction('select');
    expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({
      episodeQueue: [next],
      previousEpisodes: [previous],
      watchlistOwner: { kind: 'series', itemId: 's1' },
    }));
  });

  it('shows an empty state when the series has no seasons', async () => {
    catalogMock.loadSeriesInfo.mockResolvedValue({ seasons: [], episodesBySeason: {} });
    const { view } = await openWith();
    await openDetail(view);
    expect(container.querySelector('.series-detail')).not.toBeNull();
    expect(container.textContent).toContain('No episodes available');
  });

  it('shows a failed state instead of a perpetual Loading when info is null', async () => {
    catalogMock.loadSeriesInfo.mockResolvedValue(null);
    const { view } = await openWith();
    await openDetail(view);
    expect(container.querySelector('.series-detail')).not.toBeNull();
    expect(container.textContent).toContain('Unable to load episodes.');
    expect(container.textContent).not.toContain('Loading…');
  });

  it('Play on a series whose episodes failed to load asks again, then plays', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    catalogMock.loadSeriesInfo.mockRejectedValueOnce(new Error('timeout'));
    const { view, handlers } = await openWith();
    await openDetail(view);
    errors.mockRestore();
    expect(container.textContent).toContain('Unable to load episodes.');
    Focus.flush();
    expect(container.querySelector('.focused')?.getAttribute('data-action')).toBe('play');

    catalogMock.loadSeriesInfo.mockResolvedValue(SERIES_INFO);
    view.handleAction('select');
    expect(catalogMock.loadSeriesInfo).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => {
      expect(handlers.onPlayVod).toHaveBeenCalledWith(expect.objectContaining({
        itemId: SERIES_INFO.episodesBySeason[1][0].id,
      }));
    });
    expect(container.querySelector('.episode-card')).not.toBeNull();
  });
});

describe('Series deep-link (openItem)', () => {
  it('opens a series detail directly and Back returns to Search via the callback', async () => {
    catalogMock.loadSeriesInfo.mockResolvedValue({ seasons: [], episodesBySeason: {} });
    const handlers = { onBack: vi.fn(), onPlayVod: vi.fn() };
    const onDetailBack = vi.fn();
    const view = new Series(container, handlers);
    Focus.setBase(() => view.focusScope);
    await view.openItem(account, series('s9', 'Deep Series', '9'), onDetailBack);
    expect(container.querySelector('.series-detail')).not.toBeNull();
    expect(container.textContent).toContain('Deep Series');
    expect(container.querySelector('.catalog-browse')).toBeNull();
    const logs = vi.spyOn(console, 'log');
    view.handleAction('back');
    Focus.flush();
    expect(eventLines(logs, 'nav.focus.repaired')).toEqual([]);
    logs.mockRestore();
    expect(onDetailBack).toHaveBeenCalledTimes(1);
    expect(handlers.onBack).not.toHaveBeenCalled();
  });
});
