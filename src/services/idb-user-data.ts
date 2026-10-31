import { evictCachesForQuota } from './idb-cache';
import {
  idbWritesRefused,
  isQuotaExceededError,
  openPersistenceDb,
  refuseIdbWrites,
  requestResult,
  transactionDone,
  USER_DATA_STORES,
  USER_META_STORE,
  type UserDataStore,
} from './idb-database';
import { createLogger } from '../utils/logger';
import {
  applyFallbackChanges,
  clearFallback,
  fallbackRecordCount,
  fallbackSnapshot,
  forgetFallbackKeys,
  mergeFallbackRecords,
  replaceFallbackStore,
  type FallbackWriteOptions,
  type FallbackWriteResult,
} from './user-data-fallback';

const log = createLogger('UserDataStorage');

export interface UserDataRecord<T = unknown> {
  key: string;
  value: T;
  scope?: string;
  updatedAt?: number;
  expiresAt?: number;
}

let writeChain: Promise<void> = Promise.resolve();
let writeFailure: unknown = null;

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeChain.then(operation, operation);
  writeChain = result.then(
    () => {},
    (err) => { writeFailure = err; },
  );
  return result;
}

// IndexedDB that still refuses a write after the caches are evicted is
// read-only for the rest of the session: user data goes to localStorage.
function engageFallback(reason: string): void {
  if (!refuseIdbWrites(reason)) return;
  log.warn(
    'IndexedDB refuses writes; keeping user data in localStorage',
    'event=storage.idb.readonly',
    `reason=${reason}`,
    `fallbackKeys=${String(fallbackRecordCount())}`,
  );
}

let fallbackWriteFailed = false;

function reportFallbackFailure(store: UserDataStore, records: number, reason: FallbackWriteResult): void {
  if (fallbackWriteFailed) return;
  fallbackWriteFailed = true;
  log.error(
    'User data fallback write failed',
    'event=persistence.user.fallback.write.failed',
    `store=${store}`,
    `records=${String(records)}`,
    `reason=${reason}`,
  );
}

// IndexedDB is read-only for the session, so its keys stay as first read
// until a clear.
const storedKeyCache: Partial<Record<UserDataStore, string[]>> = {};

async function storedKeysOf(store: UserDataStore): Promise<string[] | undefined> {
  const cached = storedKeyCache[store];
  if (cached) return cached;
  const db = await openPersistenceDb();
  if (!db) return undefined;
  try {
    const tx = db.transaction(store, 'readonly');
    const keys = await requestResult(tx.objectStore(store).getAllKeys());
    const stored = keys.filter((key): key is string => typeof key === 'string');
    storedKeyCache[store] = stored;
    return stored;
  } catch {
    return undefined;
  }
}

async function writeFallback(
  store: UserDataStore,
  puts: UserDataRecord[],
  deletes: string[],
  options: FallbackWriteOptions = {},
): Promise<boolean> {
  const storedKeys = deletes.length ? await storedKeysOf(store) : undefined;
  const result = applyFallbackChanges(store, puts, deletes, { ...options, storedKeys });
  if (result === 'ok') return true;
  reportFallbackFailure(store, puts.length + deletes.length, result);
  return false;
}

async function writeFallbackOrThrow(
  store: UserDataStore,
  puts: UserDataRecord[],
  deletes: string[],
): Promise<void> {
  if (!await writeFallback(store, puts, deletes)) {
    throw new Error('User data fallback write failed');
  }
}

async function replaceFallback(
  db: IDBDatabase,
  records: Partial<Record<UserDataStore, UserDataRecord[]>>,
): Promise<void> {
  const tx = db.transaction(USER_DATA_STORES, 'readonly');
  const keys = await Promise.all(USER_DATA_STORES.map(storeName =>
    requestResult(tx.objectStore(storeName).getAllKeys())));
  let failed = false;
  USER_DATA_STORES.forEach((storeName, index) => {
    const stored = keys[index].filter((key): key is string => typeof key === 'string');
    const items = records[storeName] ?? [];
    const result = replaceFallbackStore(storeName, items, stored);
    if (result === 'ok') return;
    reportFallbackFailure(storeName, items.length, result);
    failed = true;
  });
  if (failed) throw new Error('User data fallback write failed');
}

// User data outranks every cache: a write the origin quota rejects evicts
// caches and is tried once more; one still rejected runs `fallback`.
async function withQuotaRecovery(
  operation: string,
  store: string,
  write: () => Promise<void>,
  fallback: () => void | Promise<void>,
): Promise<void> {
  try {
    await write();
    return;
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err;
    let evicted = 'none';
    let freedBytes = 0;
    let outcome = 'evict_failed';
    try {
      const eviction = await evictCachesForQuota();
      evicted = eviction.stores.join(',') || 'none';
      freedBytes = eviction.bytes;
      outcome = 'retry_failed';
      await write();
      outcome = 'recovered';
    } catch (retryErr) {
      if (outcome === 'retry_failed' && !isQuotaExceededError(retryErr)) throw retryErr;
      outcome = 'fallback';
    } finally {
      log.warn(
        'User data write hit the storage quota; evicted caches',
        'event=persistence.user.quota.evicted',
        `operation=${operation}`,
        `store=${store}`,
        `evicted=${evicted}`,
        `freedBytes=${String(freedBytes)}`,
        `outcome=${outcome}`,
      );
    }
    if (outcome !== 'fallback') return;
    engageFallback('quota');
    await fallback();
  }
}

export async function flushUserDataWrites(): Promise<void> {
  await writeChain;
  if (writeFailure !== null) {
    const err = writeFailure;
    writeFailure = null;
    throw err;
  }
}

export async function loadUserRecords<T = unknown>(
  storeName: UserDataStore,
): Promise<UserDataRecord<T>[]> {
  await writeChain;
  const db = await openPersistenceDb();
  if (!db) {
    log.warn(
      'User data storage is unavailable',
      'event=persistence.user.unavailable',
      'operation=read',
      `store=${storeName}`,
    );
    return [];
  }
  try {
    const tx = db.transaction(storeName, 'readonly');
    return mergeFallbackRecords(
      storeName,
      await requestResult(tx.objectStore(storeName).getAll()) as UserDataRecord<T>[],
    );
  } catch (err) {
    log.error(
      'User data read failed',
      'event=persistence.user.read.failed',
      'operation=read',
      `store=${storeName}`,
      err,
    );
    throw err;
  }
}

export async function loadAllUserRecords(): Promise<
Record<UserDataStore, UserDataRecord[]>
> {
  await writeChain;
  const db = await openPersistenceDb();
  if (!db) {
    log.warn(
      'User data storage is unavailable',
      'event=persistence.user.unavailable',
      'operation=read_all',
    );
    return {
      favorites: [],
      reminders: [],
      'channel-state': [],
      watchlist: [],
      'playback-progress': [],
      'recently-watched': [],
      'online-sub-picks': [],
      'parental-control': [],
    };
  }
  try {
    const tx = db.transaction(USER_DATA_STORES, 'readonly');
    const records = await Promise.all(USER_DATA_STORES.map(async (storeName) => [
      storeName,
      await requestResult(tx.objectStore(storeName).getAll()) as UserDataRecord[],
    ] as const));
    const result = {} as Record<UserDataStore, UserDataRecord[]>;
    for (const [storeName, items] of records) {
      result[storeName] = mergeFallbackRecords(storeName, items);
    }
    return result;
  } catch (err) {
    log.error(
      'User data read failed',
      'event=persistence.user.read.failed',
      'operation=read_all',
      err,
    );
    throw err;
  }
}

// TODO: Remove this marker helper once all supported installs have upgraded to IndexedDB v4.
export async function loadMigrationMarkers(): Promise<Set<string>> {
  const db = await openPersistenceDb();
  if (!db) return new Set();
  try {
    const tx = db.transaction(USER_META_STORE, 'readonly');
    const keys = await requestResult(tx.objectStore(USER_META_STORE).getAllKeys());
    const migrated = new Set<string>();
    for (const key of keys) {
      if (typeof key === 'string' && key.indexOf('migration:') === 0) {
        migrated.add(key.slice(10));
      }
    }
    return migrated;
  } catch (err) {
    log.error(
      'Migration markers read failed',
      'event=persistence.user.migration.failed',
      'operation=read_markers',
      err,
    );
    throw err;
  }
}

export interface UserDataMigration {
  legacyKey: string;
  storeName: UserDataStore;
  records: UserDataRecord[];
  replacePrefix: string | null;
  replaceExisting: boolean;
}

// TODO: Remove this migration writer once all supported installs have upgraded to IndexedDB v4.
export function migrateUserRecordSets(migrations: UserDataMigration[]): Promise<void> {
  if (!migrations.length) return Promise.resolve();
  return enqueueWrite(async () => {
    const db = await openPersistenceDb();
    if (!db) {
      log.warn(
        'User data storage is unavailable',
        'event=persistence.user.unavailable',
        'operation=migrate',
      );
      throw new Error('IndexedDB unavailable');
    }
    // Read-only: the fallback keeps the records; markers wait for a later
    // session, which migrates again only what is still in localStorage.
    const toFallback = async () => {
      for (const migration of migrations) {
        await writeFallback(migration.storeName, migration.records, []);
      }
    };
    if (idbWritesRefused()) {
      await toFallback();
      return;
    }
    try {
      const storeNames = [...new Set(migrations.map(item => item.storeName))];
      const existingKeys = new Map<UserDataStore, string[]>();
      const replacementStores = [...new Set(migrations
        .filter(item => item.replaceExisting)
        .map(item => item.storeName))];
      for (const storeName of replacementStores) {
        const readTx = db.transaction(storeName, 'readonly');
        const readDone = transactionDone(readTx);
        const keys = await requestResult(readTx.objectStore(storeName).getAllKeys());
        await readDone;
        existingKeys.set(storeName, keys.filter((key): key is string => typeof key === 'string'));
      }
      const tx = db.transaction([...storeNames, USER_META_STORE], 'readwrite');
      const meta = tx.objectStore(USER_META_STORE);
      for (const migration of migrations) {
        const store = tx.objectStore(migration.storeName);
        const keys = existingKeys.get(migration.storeName) ?? [];
        if (migration.replaceExisting) {
          for (const key of keys) {
            if (migration.replacePrefix === null || key.startsWith(migration.replacePrefix)) {
              store.delete(key);
            }
          }
        }
        for (const record of migration.records) store.put(record);
        meta.put({
          key: `migration:${migration.legacyKey}`,
          migratedAt: Date.now(),
        });
      }
      await transactionDone(tx);
      log.info(
        'User data migration completed',
        'event=persistence.user.migration.completed',
        `datasets=${migrations.length}`,
        `records=${migrations.reduce((count, item) => count + item.records.length, 0)}`,
      );
    } catch (err) {
      if (isQuotaExceededError(err)) {
        engageFallback('quota');
        await toFallback();
        return;
      }
      log.error(
        'User data migration failed',
        'event=persistence.user.migration.failed',
        'operation=migrate',
        `keys=${migrations.map(item => item.legacyKey).join(',')}`,
        err,
      );
      throw err;
    }
  });
}

export function applyUserChanges(
  storeName: UserDataStore,
  puts: UserDataRecord[],
  deletes: string[] = [],
): Promise<void> {
  if (!puts.length && !deletes.length) return Promise.resolve();
  return enqueueWrite(async () => {
    if (idbWritesRefused()) {
      await writeFallbackOrThrow(storeName, puts, deletes);
      return;
    }
    const db = await openPersistenceDb();
    if (!db) {
      log.warn(
        'User data storage is unavailable',
        'event=persistence.user.unavailable',
        'operation=write',
        `store=${storeName}`,
      );
      throw new Error('IndexedDB unavailable');
    }
    try {
      await withQuotaRecovery('write', storeName, async () => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        for (const key of deletes) store.delete(key);
        for (const record of puts) store.put(record);
        await transactionDone(tx);
        forgetFallbackKeys(storeName, [...deletes, ...puts.map(record => record.key)]);
      }, () => writeFallbackOrThrow(storeName, puts, deletes));
    } catch (err) {
      log.error(
        'User data write failed',
        'event=persistence.user.write.failed',
        'operation=write',
        `store=${storeName}`,
        err,
      );
      throw err;
    }
  });
}

export function replaceAllUserData(
  records: Partial<Record<UserDataStore, UserDataRecord[]>>,
): Promise<void> {
  return enqueueWrite(async () => {
    const db = await openPersistenceDb();
    if (!db) {
      log.warn(
        'User data storage is unavailable',
        'event=persistence.user.unavailable',
        'operation=recover',
      );
      throw new Error('IndexedDB unavailable');
    }
    if (idbWritesRefused()) {
      await replaceFallback(db, records);
      return;
    }
    try {
      await withQuotaRecovery('recover', 'all', async () => {
        const tx = db.transaction(USER_DATA_STORES, 'readwrite');
        for (const storeName of USER_DATA_STORES) {
          const store = tx.objectStore(storeName);
          store.clear();
          for (const item of records[storeName] ?? []) store.put(item);
        }
        await transactionDone(tx);
        clearFallback();
      }, () => replaceFallback(db, records));
    } catch (err) {
      log.error(
        'User data recovery write failed',
        'event=persistence.user.write.failed',
        'operation=recover',
        err,
      );
      throw err;
    }
  });
}

export function clearAllUserData(): Promise<void> {
  return enqueueWrite(async () => {
    const db = await openPersistenceDb();
    if (!db) {
      log.warn(
        'User data storage is unavailable',
        'event=persistence.user.unavailable',
        'operation=clear',
      );
      throw new Error('IndexedDB unavailable');
    }
    try {
      const tx = db.transaction([...USER_DATA_STORES, USER_META_STORE], 'readwrite');
      for (const storeName of USER_DATA_STORES) tx.objectStore(storeName).clear();
      tx.objectStore(USER_META_STORE).clear();
      await transactionDone(tx);
      for (const storeName of USER_DATA_STORES) delete storedKeyCache[storeName];
      clearFallback();
      writeFailure = null;
      log.info(
        'User data clear completed',
        'event=persistence.user.clear.completed',
        'operation=clear',
        'scope=all',
      );
    } catch (err) {
      log.error(
        'User data clear failed',
        'event=persistence.user.clear.failed',
        'operation=clear',
        'scope=all',
        err,
      );
      throw err;
    }
  });
}

const PROBE_KEY = 'probe:write';

// One small write at startup tells whether IndexedDB accepts writes for the
// session.
export function probeUserDataWrites(): Promise<void> {
  return enqueueWrite(async () => {
    if (idbWritesRefused()) return;
    const db = await openPersistenceDb();
    if (!db) return;
    try {
      await withQuotaRecovery('probe', USER_META_STORE, async () => {
        const tx = db.transaction(USER_META_STORE, 'readwrite');
        tx.objectStore(USER_META_STORE).put({ key: PROBE_KEY, writtenAt: Date.now() });
        await transactionDone(tx);
      }, () => undefined);
    } catch (err) {
      log.warn(
        'User data write probe failed',
        'event=persistence.user.probe.failed',
        err,
      );
    }
  });
}

// After a read-only session, moves the localStorage fallback back once
// IndexedDB accepts writes again.
export function restoreFallbackUserData(): Promise<void> {
  return enqueueWrite(async () => {
    if (idbWritesRefused()) return;
    const db = await openPersistenceDb();
    if (!db) return;
    const snapshot = fallbackSnapshot();
    if (!snapshot.length) return;
    try {
      await withQuotaRecovery('restore', 'all', async () => {
        const tx = db.transaction(snapshot.map(item => item.store), 'readwrite');
        for (const item of snapshot) {
          const store = tx.objectStore(item.store);
          for (const key of item.deletes) store.delete(key);
          for (const record of item.puts) store.put(record);
        }
        await transactionDone(tx);
      }, () => undefined);
    } catch (err) {
      log.warn(
        'Restoring user data from localStorage failed',
        'event=persistence.user.fallback.restore.failed',
        err,
      );
      return;
    }
    if (idbWritesRefused()) return;
    clearFallback();
    log.info(
      'User data moved back to IndexedDB',
      'event=storage.idb.restored',
      `records=${String(snapshot.reduce((count, item) =>
        count + item.puts.length + item.deletes.length, 0))}`,
    );
  });
}
