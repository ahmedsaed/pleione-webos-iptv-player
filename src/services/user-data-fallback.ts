import { CONFIG } from '../config';
import { USER_DATA_STORES, type UserDataStore } from './idb-database';
import type { UserDataRecord } from './idb-user-data';

// Durable user records written to localStorage while IndexedDB refuses
// writes, read back merged over the IndexedDB records. One key per store:
// `r` holds puts and `d` deletions of keys IndexedDB may still hold, each
// with the time it was written so the oldest records go first.
export const FALLBACK_KEY_PREFIX = `${CONFIG.STORAGE_PREFIX}fb_`;

// Serialized characters across every fallback key (2 MiB as UTF-16, of the
// 5 Mi characters Chromium allows), so boot configuration keeps the rest.
export const FALLBACK_TOTAL_CHARS = 1024 * 1024;

// A record this large would push most others out, so it is refused.
export const FALLBACK_RECORD_MAX_CHARS = FALLBACK_TOTAL_CHARS / 2;

// Never evicted for room: losing it would lift the parental lock.
const PINNED_STORE: UserDataStore = 'parental-control';

// `evicted`: the write kept, but older records were dropped for room.
export type FallbackWriteResult = 'ok' | 'evicted' | 'too_large' | 'full';

export interface FallbackWriteOptions {
  // Keys IndexedDB holds: a deletion of any other key needs no marker.
  storedKeys?: readonly string[];
  // Records already in the fallback are newer and stay.
  keepExisting?: boolean;
  // Fails instead of evicting other records for room.
  noEvict?: boolean;
}

interface FallbackState {
  r: Record<string, { v: UserDataRecord; t: number }>;
  d: Record<string, number>;
}

interface FallbackEntry {
  store: UserDataStore;
  key: string;
  t: number;
  size: number;
}

let lastStamp = 0;

// Strictly increasing, so records written in one batch keep their order.
function stamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

function storageKey(store: UserDataStore): string {
  return FALLBACK_KEY_PREFIX + store;
}

function rawState(store: UserDataStore): string | null {
  try {
    return localStorage.getItem(storageKey(store));
  } catch {
    return null;
  }
}

function readState(store: UserDataStore): FallbackState {
  const raw = rawState(store);
  if (raw === null) return { r: {}, d: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<FallbackState> | null;
    return {
      r: parsed && typeof parsed.r === 'object' && parsed.r ? parsed.r : {},
      d: parsed && typeof parsed.d === 'object' && parsed.d ? parsed.d : {},
    };
  } catch {
    return { r: {}, d: {} };
  }
}

function isEmpty(state: FallbackState): boolean {
  return !Object.keys(state.r).length && !Object.keys(state.d).length;
}

function serialize(state: FallbackState): string {
  return JSON.stringify(state);
}

function recordSize(key: string, entry: { v: UserDataRecord; t: number }): number {
  return key.length + JSON.stringify(entry).length + 4;
}

// Deletion markers are never evicted: dropping one would bring the deleted
// record back from IndexedDB.
function recordEntries(store: UserDataStore, state: FallbackState): FallbackEntry[] {
  return Object.keys(state.r).map(key => ({
    store,
    key,
    t: state.r[key].t,
    size: recordSize(key, state.r[key]),
  }));
}

function loadStates(changed: UserDataStore, next: FallbackState): Record<UserDataStore, FallbackState> {
  const states = {} as Record<UserDataStore, FallbackState>;
  for (const store of USER_DATA_STORES) {
    states[store] = store === changed ? next : readState(store);
  }
  return states;
}

// Drops the oldest unpinned records across every store until `limit`
// characters remain; returns the stores it changed.
function evictOldest(
  states: Record<UserDataStore, FallbackState>,
  limit: number,
): UserDataStore[] {
  let total = 0;
  for (const store of USER_DATA_STORES) {
    if (!isEmpty(states[store])) total += serialize(states[store]).length;
  }
  if (total <= limit) return [];
  const entries: FallbackEntry[] = [];
  for (const store of USER_DATA_STORES) {
    if (store !== PINNED_STORE) entries.push(...recordEntries(store, states[store]));
  }
  entries.sort((a, b) => a.t - b.t);
  const touched: UserDataStore[] = [];
  for (const entry of entries) {
    if (total <= limit) break;
    delete states[entry.store].r[entry.key];
    total -= entry.size;
    if (touched.indexOf(entry.store) < 0) touched.push(entry.store);
  }
  return touched;
}

function writeState(store: UserDataStore, state: FallbackState): void {
  if (isEmpty(state)) localStorage.removeItem(storageKey(store));
  else localStorage.setItem(storageKey(store), serialize(state));
}

function writeStates(
  states: Record<UserDataStore, FallbackState>,
  stores: UserDataStore[],
): boolean {
  try {
    for (const store of stores) writeState(store, states[store]);
    return true;
  } catch {
    return false;
  }
}

function usage(states: Record<UserDataStore, FallbackState>): number {
  return USER_DATA_STORES.reduce((sum, item) =>
    sum + (isEmpty(states[item]) ? 0 : serialize(states[item]).length), 0);
}

function persist(store: UserDataStore, next: FallbackState, noEvict = false): FallbackWriteResult {
  const states = loadStates(store, next);
  if (noEvict) {
    if (usage(states) > FALLBACK_TOTAL_CHARS) return 'full';
    return writeStates(states, [store]) ? 'ok' : 'full';
  }
  const evicted = evictOldest(states, FALLBACK_TOTAL_CHARS);
  const touched = evicted.indexOf(store) < 0 ? evicted.concat(store) : evicted;
  if (writeStates(states, touched)) return evicted.length ? 'evicted' : 'ok';
  // localStorage itself is full: give up the oldest half of the fallback,
  // never another key, and try once more.
  const more = evictOldest(states, Math.floor(usage(states) / 2));
  return writeStates(states, USER_DATA_STORES.filter(item =>
    touched.indexOf(item) >= 0 || more.indexOf(item) >= 0)) ? 'evicted' : 'full';
}

function tooLarge(state: FallbackState, puts: UserDataRecord[]): boolean {
  return puts.some(record =>
    recordSize(record.key, state.r[record.key]) > FALLBACK_RECORD_MAX_CHARS);
}

// A deletion marker only matters for a key IndexedDB holds.
function collapseDeletes(state: FallbackState, storedKeys: readonly string[] | undefined): void {
  if (!storedKeys) return;
  const stored = new Set(storedKeys);
  for (const key of Object.keys(state.d)) {
    if (!stored.has(key)) delete state.d[key];
  }
}

export function applyFallbackChanges(
  store: UserDataStore,
  puts: UserDataRecord[],
  deletes: string[],
  options: FallbackWriteOptions = {},
): FallbackWriteResult {
  const state = readState(store);
  for (const key of deletes) {
    delete state.r[key];
    state.d[key] = stamp();
  }
  const written: UserDataRecord[] = [];
  for (const record of puts) {
    if (options.keepExisting && (state.r[record.key] || state.d[record.key] !== undefined)) {
      continue;
    }
    delete state.d[record.key];
    state.r[record.key] = { v: record, t: stamp() };
    written.push(record);
  }
  if (tooLarge(state, written)) return 'too_large';
  collapseDeletes(state, options.storedKeys);
  return persist(store, state, options.noEvict);
}

// Makes `records` the whole store: every key IndexedDB holds that is not
// among them is recorded as deleted.
export function replaceFallbackStore(
  store: UserDataStore,
  records: UserDataRecord[],
  storedKeys: string[],
): FallbackWriteResult {
  const state: FallbackState = { r: {}, d: {} };
  const keep = new Set(records.map(item => item.key));
  for (const key of storedKeys) {
    if (!keep.has(key)) state.d[key] = stamp();
  }
  for (const record of records) state.r[record.key] = { v: record, t: stamp() };
  if (tooLarge(state, records)) return 'too_large';
  return persist(store, state);
}

// Keys written to IndexedDB again no longer need their fallback copy.
export function forgetFallbackKeys(store: UserDataStore, keys: string[]): void {
  if (rawState(store) === null || !keys.length) return;
  const state = readState(store);
  for (const key of keys) {
    delete state.r[key];
    delete state.d[key];
  }
  try {
    writeState(store, state);
  } catch {
    // The stale copy only matters until the next successful restore.
  }
}

export function mergeFallbackRecords<T>(
  store: UserDataStore,
  records: UserDataRecord<T>[],
): UserDataRecord<T>[] {
  if (rawState(store) === null) return records;
  const state = readState(store);
  const merged: UserDataRecord<T>[] = [];
  for (const record of records) {
    if (state.d[record.key] === undefined && !state.r[record.key]) merged.push(record);
  }
  for (const key of Object.keys(state.r).sort((a, b) => state.r[a].t - state.r[b].t)) {
    merged.push(state.r[key].v as UserDataRecord<T>);
  }
  return merged;
}

export interface FallbackStoreSnapshot {
  store: UserDataStore;
  puts: UserDataRecord[];
  deletes: string[];
}

export function fallbackSnapshot(): FallbackStoreSnapshot[] {
  const snapshot: FallbackStoreSnapshot[] = [];
  for (const store of USER_DATA_STORES) {
    if (rawState(store) === null) continue;
    const state = readState(store);
    if (isEmpty(state)) continue;
    snapshot.push({
      store,
      puts: Object.keys(state.r).map(key => state.r[key].v),
      deletes: Object.keys(state.d),
    });
  }
  return snapshot;
}

export function fallbackRecordCount(): number {
  return fallbackSnapshot().reduce((count, item) =>
    count + item.puts.length + item.deletes.length, 0);
}

export function clearFallback(): void {
  for (const store of USER_DATA_STORES) {
    try {
      localStorage.removeItem(storageKey(store));
    } catch {
      // Nothing to clear without Web Storage.
    }
  }
}

// Frees room for a boot-critical key: drops the oldest half of the fallback.
export function shrinkFallback(): boolean {
  const states = loadStates(USER_DATA_STORES[0], readState(USER_DATA_STORES[0]));
  const usage = USER_DATA_STORES.reduce((sum, item) =>
    sum + (isEmpty(states[item]) ? 0 : serialize(states[item]).length), 0);
  const touched = evictOldest(states, Math.floor(usage / 2));
  return touched.length > 0 && writeStates(states, touched);
}
