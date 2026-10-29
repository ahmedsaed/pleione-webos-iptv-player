import { getCachedCatalog, setCachedCatalog } from './idb-cache';
import { StorageService } from './storage-service';
import { createLogger } from '../utils/logger';
import { normalizeName } from '../utils/cast';

// Opt-in cast photos from TMDB with the user's own key. Nothing here touches
// the network without a key; the provider's ids pick the title, so there is
// no title search.

const log = createLogger('Tmdb');

const API_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w185';
const TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Enough for the dozen people a detail shows; keeps each cache entry tiny.
const MAX_PEOPLE = 24;

export type TmdbKind = 'movie' | 'tv';

// One credited person: name, profile path, and character or job.
export interface TmdbPerson {
  n: string;
  p: string;
  r: string;
}

export interface TmdbIds {
  tmdbId?: string;
  imdbId?: string;
}

interface TmdbRequest {
  url: string;
  headers: Record<string, string>;
}

// A v4 read access token is a JWT (three dot-separated parts) sent as a
// Bearer header; anything else is a v3 API key sent as `api_key`.
export function isTmdbReadToken(key: string): boolean {
  return key.split('.').length === 3 && key.length > 40;
}

export function tmdbRequest(path: string, key: string, params: Record<string, string> = {}): TmdbRequest {
  const query = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`);
  if (isTmdbReadToken(key)) {
    return {
      url: `${API_BASE}${path}${query.length ? `?${query.join('&')}` : ''}`,
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    };
  }
  query.unshift(`api_key=${encodeURIComponent(key)}`);
  return { url: `${API_BASE}${path}?${query.join('&')}`, headers: { Accept: 'application/json' } };
}

export function tmdbCreditsRequest(kind: TmdbKind, id: string, key: string): TmdbRequest {
  return tmdbRequest(`/${kind}/${encodeURIComponent(id)}/credits`, key);
}

export function tmdbFindRequest(imdbId: string, key: string): TmdbRequest {
  const id = /^tt/i.test(imdbId) ? imdbId : `tt${imdbId}`;
  return tmdbRequest(`/find/${encodeURIComponent(id)}`, key, { external_source: 'imdb_id' });
}

export function tmdbProfileUrl(path: string): string {
  return /^\/[\w.-]+$/.test(path) ? `${IMAGE_BASE}${path}` : '';
}

function validId(id: string | undefined, pattern: RegExp): string {
  const value = (id ?? '').trim();
  return pattern.test(value) ? value : '';
}

class TmdbHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function getJson(req: TmdbRequest, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const timer = setTimeout(abort, TIMEOUT_MS);
  signal?.addEventListener('abort', abort);
  try {
    const res = await fetch(req.url, { headers: req.headers, signal: controller.signal });
    if (!res.ok) throw new TmdbHttpError(res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function parseTmdbCredits(data: unknown): TmdbPerson[] {
  const body = (data && typeof data === 'object' ? data : {}) as { cast?: unknown; crew?: unknown };
  const out: TmdbPerson[] = [];
  const cast = Array.isArray(body.cast) ? body.cast as Record<string, unknown>[] : [];
  const crew = Array.isArray(body.crew) ? body.crew as Record<string, unknown>[] : [];
  cast.slice(0, MAX_PEOPLE - 4).forEach((c) => {
    if (str(c.name)) out.push({ n: str(c.name), p: str(c.profile_path), r: str(c.character) });
  });
  crew.filter(c => str(c.job) === 'Director').slice(0, 4).forEach((c) => {
    if (str(c.name)) out.push({ n: str(c.name), p: str(c.profile_path), r: '' });
  });
  return out;
}

async function resolveId(kind: TmdbKind, ids: TmdbIds, key: string, signal?: AbortSignal): Promise<string> {
  const tmdbId = validId(ids.tmdbId, /^\d{1,10}$/);
  if (tmdbId) return tmdbId;
  const imdbId = validId(ids.imdbId, /^(tt)?\d{5,10}$/i);
  if (!imdbId) return '';
  const found = await getJson(tmdbFindRequest(imdbId, key), signal) as Record<string, unknown> | null;
  const results = found?.[kind === 'movie' ? 'movie_results' : 'tv_results'];
  const first = Array.isArray(results) ? results[0] as Record<string, unknown> | undefined : undefined;
  const id = first ? first.id : undefined;
  return typeof id === 'number' ? String(id) : '';
}

// Credits for the title, from the cache or TMDB; null without a key or ids,
// or when TMDB could not be reached (nothing then is cached).
export async function loadTmdbCredits(
  kind: TmdbKind,
  ids: TmdbIds,
  signal?: AbortSignal,
): Promise<TmdbPerson[] | null> {
  const key = StorageService.getTmdbApiKey();
  if (!key) return null;
  const imdbId = validId(ids.imdbId, /^(tt)?\d{5,10}$/i);
  const idKey = validId(ids.tmdbId, /^\d{1,10}$/) || (imdbId ? `tt${imdbId.replace(/^tt/i, '')}` : '');
  if (!idKey) return null;
  const cacheKey = `tmdb|${kind}|${idKey}`;
  try {
    const cached = await getCachedCatalog<TmdbPerson[]>(cacheKey);
    if (cached && Array.isArray(cached.data)) return cached.data;
  } catch {
    // A cache that cannot be read only costs a request.
  }
  if (signal?.aborted) return null;
  try {
    const id = await resolveId(kind, ids, key, signal);
    const people = id ? parseTmdbCredits(await getJson(tmdbCreditsRequest(kind, id, key), signal)) : [];
    void setCachedCatalog(cacheKey, people, people.length ? CACHE_TTL_MS : MISS_TTL_MS).catch(() => undefined);
    return people;
  } catch (err) {
    if (signal?.aborted) return null;
    const status = err instanceof TmdbHttpError ? err.status : 0;
    if (status === 404) {
      void setCachedCatalog(cacheKey, [], MISS_TTL_MS).catch(() => undefined);
      return [];
    }
    log.warn('TMDB credits failed', 'event=tmdb.credits.failed', `kind=${kind}`, `status=${status}`, err);
    return null;
  }
}

// The TMDB entry for each provider name, matched by normalized name.
export function matchTmdbPeople(names: string[], people: TmdbPerson[]): Map<string, TmdbPerson> {
  const byName = new Map<string, TmdbPerson>();
  people.forEach((p) => {
    const k = normalizeName(p.n);
    if (k && !byName.has(k)) byName.set(k, p);
  });
  const out = new Map<string, TmdbPerson>();
  names.forEach((name) => {
    const match = byName.get(normalizeName(name));
    if (match) out.set(name, match);
  });
  return out;
}
