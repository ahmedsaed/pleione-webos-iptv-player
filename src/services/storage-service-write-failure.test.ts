// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StorageService } from './storage-service';
import * as idbUserData from './idb-user-data';
import { clearAllCachedData, getCachedCatalog, setCachedCatalog } from './idb-cache';
import { CATALOG_STORE } from './idb-database';
import { fillOrigin } from '../test/full-origin';

// persistUserChanges() is fire-and-forget: it attaches its own .then()/.catch()
// to the applyUserChanges() promise *before* the caller here gets a chance to.
// Awaiting that same promise (once it's mocked to a value we hold onto)
// therefore guarantees persistUserChanges' own continuation already ran —
// same-tier .then() callbacks fire in attachment order.
function mockNextWriteRejection(message: string): Promise<never> {
  const rejection = Promise.reject(new Error(message));
  vi.spyOn(idbUserData, 'applyUserChanges').mockImplementationOnce(() => rejection);
  return rejection;
}

// Same ordering guarantee, but for a write that's left to actually succeed —
// spies just to capture the exact promise persistUserChanges() also awaits.
function captureNextWrite(): { result: Promise<void> } {
  const capture = { result: Promise.resolve() };
  const real = idbUserData.applyUserChanges;
  vi.spyOn(idbUserData, 'applyUserChanges').mockImplementationOnce((...args) => {
    capture.result = real(...args);
    return capture.result;
  });
  return capture;
}

describe('StorageService write-failure handler', () => {
  beforeEach(async () => {
    localStorage.clear();
    await StorageService.init();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await StorageService.clearUserData();
  });

  it('notifies once per failure streak, and again after it recovers', async () => {
    const onFailure = vi.fn();
    StorageService.setWriteFailureHandler(onFailure);

    const first = mockNextWriteRejection('boom');
    StorageService.setFavorites(['ch1']);
    await first.catch(() => {});
    expect(onFailure).toHaveBeenCalledTimes(1);

    // A second failure in the same streak must not notify again.
    const second = mockNextWriteRejection('boom again');
    StorageService.setFavorites(['ch1', 'ch2']);
    await second.catch(() => {});
    expect(onFailure).toHaveBeenCalledTimes(1);

    // A write that succeeds ends the streak.
    const recovered = captureNextWrite();
    StorageService.setFavorites(['ch1']);
    await recovered.result;

    // So a later failure notifies again.
    const third = mockNextWriteRejection('boom once more');
    StorageService.setFavorites(['ch1', 'ch3']);
    await third.catch(() => {});
    expect(onFailure).toHaveBeenCalledTimes(2);
  });

  it('does not notify at all when writes succeed', async () => {
    const onFailure = vi.fn();
    StorageService.setWriteFailureHandler(onFailure);

    const write = captureNextWrite();
    StorageService.setFavorites(['ch1']);
    await write.result;

    expect(onFailure).not.toHaveBeenCalled();
  });
});

describe('StorageService.flush on a full origin', () => {
  let origin: ReturnType<typeof fillOrigin> | null = null;

  beforeEach(async () => {
    localStorage.clear();
    await StorageService.init();
    await clearAllCachedData();
    await setCachedCatalog('x1|vod_all', ['x'.repeat(5 * 1024 * 1024)]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    origin?.restore();
    origin = null;
    vi.restoreAllMocks();
    await StorageService.clearUserData();
  });

  it('saves user data by evicting the caches', async () => {
    origin = fillOrigin([CATALOG_STORE]);
    StorageService.setFavorites(['ch1']);

    await expect(StorageService.flush()).resolves.toBeUndefined();

    expect(origin.full).toBe(false);
    expect(await idbUserData.loadUserRecords('favorites')).toHaveLength(1);
    expect(await getCachedCatalog('x1|vod_all')).toBeNull();
  });

  it('evicts the caches for the snapshot retry too', async () => {
    // The first write fails for another reason; the origin fills before the
    // flush rewrites the in-memory snapshot.
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const write = captureNextWrite();
    StorageService.setFavorites(['ch1']);
    await write.result.catch(() => {});
    put.mockRestore();
    origin = fillOrigin([CATALOG_STORE]);

    await expect(StorageService.flush()).resolves.toBeUndefined();

    expect(await idbUserData.loadUserRecords('favorites')).toHaveLength(1);
    expect(await getCachedCatalog('x1|vod_all')).toBeNull();
  });
});
