// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyUserChanges,
  clearAllUserData,
  flushUserDataWrites,
  loadAllUserRecords,
  loadMigrationMarkers,
  loadUserRecords,
  migrateUserRecordSets,
} from './idb-user-data';
import { clearAllCachedData, getCachedCatalog, setCachedCatalog } from './idb-cache';
import { CATALOG_STORE, idbWritesRefused, resetIdbWriteStateForTests } from './idb-database';
import { fillOrigin } from '../test/full-origin';

describe('IndexedDB user-data write barrier', () => {
  beforeEach(async () => {
    await clearAllUserData();
  });

  it('waits for queued writes before resolving', async () => {
    void applyUserChanges('favorites', [{ key: 'favorite:ch1', value: 'ch1' }]);

    await flushUserDataWrites();

    expect(await loadUserRecords('favorites')).toEqual([
      { key: 'favorite:ch1', value: 'ch1' },
    ]);
  });

  it('loads every user-data store through one snapshot', async () => {
    await applyUserChanges('favorites', [{ key: 'favorite:ch1', value: 'ch1' }]);
    await applyUserChanges('watchlist', [{
      key: 'watch:x1|movie|1',
      value: { accountId: 'x1', kind: 'movie', itemId: '1' },
    }]);

    const records = await loadAllUserRecords();

    expect(records.favorites).toHaveLength(1);
    expect(records.watchlist).toHaveLength(1);
    expect(records.reminders).toEqual([]);
    expect(records['parental-control']).toEqual([]);
  });

  it('rejects once when a queued write failed', async () => {
    const failed = applyUserChanges('favorites', [{
      key: 'favorite:bad',
      value: () => 'not cloneable',
    }]);
    await expect(failed).rejects.toBeTruthy();

    await expect(flushUserDataWrites()).rejects.toBeTruthy();
    await expect(flushUserDataWrites()).resolves.toBeUndefined();
  });

  it('replaces one migrated namespace without deleting sibling state', async () => {
    await applyUserChanges('channel-state', [
      { key: 'audio:old', value: { name: 'Track 1' } },
      { key: 'subtitle:ch1', value: { off: true } },
    ]);

    await migrateUserRecordSets([{
      legacyKey: 'audio_prefs',
      storeName: 'channel-state',
      records: [{ key: 'audio:new', value: { name: 'Track 2' } }],
      replacePrefix: 'audio:',
      replaceExisting: true,
    }]);

    expect(await loadUserRecords('channel-state')).toEqual(expect.arrayContaining([
      { key: 'audio:new', value: { name: 'Track 2' } },
      { key: 'subtitle:ch1', value: { off: true } },
    ]));
    expect((await loadUserRecords('channel-state')).some(item => item.key === 'audio:old'))
      .toBe(false);
  });

  it('loads all completed migration markers in one batch', async () => {
    await migrateUserRecordSets([
      {
        legacyKey: 'favorites',
        storeName: 'favorites',
        records: [],
        replacePrefix: null,
        replaceExisting: true,
      },
      {
        legacyKey: 'watchlist',
        storeName: 'watchlist',
        records: [],
        replacePrefix: null,
        replaceExisting: true,
      },
    ]);

    expect(await loadMigrationMarkers()).toEqual(new Set(['favorites', 'watchlist']));
  });
});

describe('IndexedDB user data on a full origin', () => {
  const progress = { key: 'progress:x1|movie|1', value: { position: 1 } };
  let origin: ReturnType<typeof fillOrigin> | null = null;

  beforeEach(async () => {
    await clearAllUserData();
    await clearAllCachedData();
    await setCachedCatalog('x1|vod_all', ['x'.repeat(5 * 1024 * 1024)]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    origin?.restore();
    origin = null;
    vi.restoreAllMocks();
    resetIdbWriteStateForTests();
    localStorage.clear();
  });

  function quotaEvents(warn: ReturnType<typeof vi.spyOn>): string[] {
    return warn.mock.calls.map(call => call.join(' '))
      .filter(line => line.indexOf('event=persistence.user.quota.evicted') >= 0);
  }

  it('evicts caches and retries a write the quota rejected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    origin = fillOrigin([CATALOG_STORE]);

    await applyUserChanges('playback-progress', [progress]);
    await flushUserDataWrites();

    expect(origin.full).toBe(false);
    expect(await loadUserRecords('playback-progress')).toEqual([progress]);
    expect(await getCachedCatalog('x1|vod_all')).toBeNull();
    const events = quotaEvents(warn);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatch(
      /event=persistence\.user\.quota\.evicted operation=write store=playback-progress evicted=search-index-cache,catalog-cache freedBytes=\d+ outcome=recovered$/,
    );
  });

  it('keeps a write in localStorage when eviction frees no room', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    origin = fillOrigin([]);

    await expect(applyUserChanges('playback-progress', [progress])).resolves.toBeUndefined();
    await expect(flushUserDataWrites()).resolves.toBeUndefined();

    expect(idbWritesRefused()).toBe(true);
    expect(localStorage.getItem('iptv_fb_playback-progress')).toContain('progress:x1|movie|1');
    expect(await loadUserRecords('playback-progress')).toEqual([progress]);
    const events = quotaEvents(warn);
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('outcome=fallback');
    const readOnly = warn.mock.calls.map(call => call.join(' '))
      .filter(line => line.indexOf('event=storage.idb.readonly') >= 0);
    expect(readOnly).toHaveLength(1);
    expect(readOnly[0]).toMatch(/event=storage\.idb\.readonly reason=quota fallbackKeys=0$/);

    // Read-only for the session: the next write skips IndexedDB.
    origin.restore();
    origin = null;
    await applyUserChanges('favorites', [{ key: 'favorite:ch1', value: 'ch1' }]);
    expect(localStorage.getItem('iptv_fb_favorites')).toContain('favorite:ch1');
    expect(quotaEvents(warn)).toHaveLength(1);
  });

  it('leaves the caches alone when a write fails for another reason', async () => {
    await expect(applyUserChanges('favorites', [{
      key: 'favorite:bad',
      value: () => 'not cloneable',
    }])).rejects.toBeTruthy();
    await expect(flushUserDataWrites()).rejects.toBeTruthy();

    expect(await getCachedCatalog('x1|vod_all')).not.toBeNull();
  });
});
