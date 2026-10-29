import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cache, storage } = vi.hoisted(() => ({
  cache: {
    entries: new Map<string, unknown>(),
    getCachedCatalog: vi.fn(),
    setCachedCatalog: vi.fn(),
  },
  storage: { key: '' },
}));
vi.mock('./idb-cache', () => ({
  getCachedCatalog: cache.getCachedCatalog,
  setCachedCatalog: cache.setCachedCatalog,
}));
vi.mock('./storage-service', () => ({
  StorageService: { getTmdbApiKey: () => storage.key },
}));

import {
  isTmdbReadToken,
  loadTmdbCredits,
  matchTmdbPeople,
  parseTmdbCredits,
  tmdbCreditsRequest,
  tmdbFindRequest,
  tmdbProfileUrl,
} from './tmdb';

const V3_KEY = '0123456789abcdef0123456789abcdef';
const V4_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ0ZXN0In0.c2lnbmF0dXJlLXRlc3QtdG9rZW4';
const CREDITS = {
  cast: [
    { name: 'Actor A', profile_path: '/a.jpg', character: 'Role 1' },
    { name: 'Actor B', profile_path: null, character: 'Role 2' },
  ],
  crew: [
    { name: 'Director G', job: 'Director', profile_path: '/g.jpg' },
    { name: 'Writer W', job: 'Writer', profile_path: '/w.jpg' },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage.key = '';
  cache.entries.clear();
  cache.getCachedCatalog.mockImplementation(async (key: string) =>
    (cache.entries.has(key) ? { key, timestamp: 1, data: cache.entries.get(key) } : null));
  cache.setCachedCatalog.mockImplementation(async (key: string, data: unknown) => { cache.entries.set(key, data); });
  fetchMock = vi.fn(async () => json(CREDITS));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('TMDB requests', () => {
  it('sends a v3 key as api_key and a v4 read token as a Bearer header', () => {
    const v3 = tmdbCreditsRequest('movie', '123', V3_KEY);
    expect(v3.url).toBe(`https://api.themoviedb.org/3/movie/123/credits?api_key=${V3_KEY}`);
    expect(v3.headers.Authorization).toBeUndefined();

    const v4 = tmdbCreditsRequest('tv', '77', V4_TOKEN);
    expect(v4.url).toBe('https://api.themoviedb.org/3/tv/77/credits');
    expect(v4.headers.Authorization).toBe(`Bearer ${V4_TOKEN}`);
    expect(isTmdbReadToken(V3_KEY)).toBe(false);
  });

  it('finds a title by its IMDb id', () => {
    expect(tmdbFindRequest('1234567', V3_KEY).url).toBe(
      `https://api.themoviedb.org/3/find/tt1234567?api_key=${V3_KEY}&external_source=imdb_id`);
    expect(tmdbFindRequest('tt1234567', V4_TOKEN).url).toBe(
      'https://api.themoviedb.org/3/find/tt1234567?external_source=imdb_id');
  });

  it('builds w185 profile URLs only from plain paths', () => {
    expect(tmdbProfileUrl('/a.jpg')).toBe('https://image.tmdb.org/t/p/w185/a.jpg');
    expect(tmdbProfileUrl('')).toBe('');
    expect(tmdbProfileUrl('//evil/x.jpg')).toBe('');
    expect(tmdbProfileUrl('/a.jpg"onerror')).toBe('');
  });
});

describe('parseTmdbCredits', () => {
  it('keeps cast with characters and only directors from the crew', () => {
    expect(parseTmdbCredits(CREDITS)).toEqual([
      { n: 'Actor A', p: '/a.jpg', r: 'Role 1' },
      { n: 'Actor B', p: '', r: 'Role 2' },
      { n: 'Director G', p: '/g.jpg', r: '' },
    ]);
    expect(parseTmdbCredits(null)).toEqual([]);
  });

  it('keeps a cache entry small however long the credits run', () => {
    const cast = Array.from({ length: 200 }, (_, i) => ({ name: `Actor ${String(i)}`, profile_path: '/p.jpg', character: 'Role' }));
    expect(parseTmdbCredits({ cast, crew: [] }).length).toBeLessThanOrEqual(24);
  });
});

describe('loadTmdbCredits', () => {
  it('makes no TMDB request without a key', async () => {
    await expect(loadTmdbCredits('movie', { tmdbId: '123' })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cache.getCachedCatalog).not.toHaveBeenCalled();
  });

  it('makes no request without an id to look the title up by', async () => {
    storage.key = V3_KEY;
    await expect(loadTmdbCredits('movie', { tmdbId: '', imdbId: '' })).resolves.toBeNull();
    await expect(loadTmdbCredits('movie', { tmdbId: 'abc' })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches credits by TMDB id once, then serves them from the cache', async () => {
    storage.key = V3_KEY;
    const first = await loadTmdbCredits('movie', { tmdbId: '123' });
    expect(first?.map(p => p.n)).toEqual(['Actor A', 'Actor B', 'Director G']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cache.setCachedCatalog).toHaveBeenCalledWith('tmdb|movie|123', first, expect.any(Number));
    await loadTmdbCredits('movie', { tmdbId: '123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves an IMDb id through find before asking for credits', async () => {
    storage.key = V4_TOKEN;
    fetchMock.mockImplementationOnce(async () => json({ tv_results: [{ id: 77 }], movie_results: [] }));
    const people = await loadTmdbCredits('tv', { imdbId: '7654321' });
    expect(people).toHaveLength(3);
    expect(fetchMock.mock.calls[0][0]).toContain('/find/tt7654321');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.themoviedb.org/3/tv/77/credits');
    expect(cache.setCachedCatalog).toHaveBeenCalledWith('tmdb|tv|tt7654321', people, expect.any(Number));
  });

  it('caches a title TMDB does not know, and nothing when TMDB fails', async () => {
    storage.key = V3_KEY;
    fetchMock.mockImplementationOnce(async () => json({}, 404));
    await expect(loadTmdbCredits('movie', { tmdbId: '9' })).resolves.toEqual([]);
    expect(cache.entries.get('tmdb|movie|9')).toEqual([]);

    fetchMock.mockImplementationOnce(async () => json({}, 401));
    await expect(loadTmdbCredits('movie', { tmdbId: '10' })).resolves.toBeNull();
    expect(cache.entries.has('tmdb|movie|10')).toBe(false);
  });
});

describe('matchTmdbPeople', () => {
  it('matches provider names to TMDB people ignoring case and accents', () => {
    const people = parseTmdbCredits(CREDITS);
    const matched = matchTmdbPeople(['actor a', 'Director G', 'Nobody'], people);
    expect(matched.get('actor a')?.p).toBe('/a.jpg');
    expect(matched.get('Director G')?.p).toBe('/g.jpg');
    expect(matched.has('Nobody')).toBe(false);
  });
});
