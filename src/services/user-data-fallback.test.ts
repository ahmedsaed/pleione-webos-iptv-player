// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyFallbackChanges,
  FALLBACK_TOTAL_CHARS,
  fallbackSnapshot,
  mergeFallbackRecords,
} from './user-data-fallback';

function fallbackChars(): number {
  return Object.keys(localStorage)
    .filter(key => key.indexOf('iptv_fb_') === 0)
    .reduce((sum, key) => sum + localStorage.getItem(key)!.length, 0);
}

describe('user-data localStorage fallback', () => {
  beforeEach(() => localStorage.clear());

  it('keeps every record up to the size budget, past the app caps', () => {
    const watched = Array.from({ length: 2600 }, (_, i) => ({ key: `watched:x1|vod|${i}`, value: i }));
    const watchlist = Array.from({ length: 1200 }, (_, i) => ({ key: `watch:x${i % 3}|vod|${i}`, value: i }));

    expect(applyFallbackChanges('playback-progress', watched, [])).toBe('ok');
    expect(applyFallbackChanges('watchlist', watchlist, [])).toBe('ok');
    expect(mergeFallbackRecords('playback-progress', [])).toHaveLength(2600);
    expect(mergeFallbackRecords('watchlist', [])).toHaveLength(1200);
  });

  it('keeps every deletion, so a cleared record never comes back', () => {
    const stored = Array.from({ length: 1500 }, (_, i) => ({ key: `watched:x1|vod|${i}`, value: i }));

    expect(applyFallbackChanges('playback-progress', [], stored.map(item => item.key))).toBe('ok');
    expect(mergeFallbackRecords('playback-progress', stored)).toEqual([]);
  });

  it('evicts records but never deletions for room, and reports it', () => {
    const stored = Array.from({ length: 300 }, (_, i) => `favorite:ch${i}`);
    expect(applyFallbackChanges('favorites', [], stored)).toBe('ok');
    const big = 'x'.repeat(10 * 1024);
    const count = Math.ceil(FALLBACK_TOTAL_CHARS / big.length) + 5;
    const results: string[] = [];
    for (let i = 0; i < count; i++) {
      results.push(applyFallbackChanges('channel-state', [{ key: `audio:ch${i}`, value: big }], []));
    }

    expect(results[0]).toBe('ok');
    expect(results[count - 1]).toBe('evicted');
    expect(fallbackChars()).toBeLessThanOrEqual(FALLBACK_TOTAL_CHARS);
    expect(mergeFallbackRecords('favorites', stored.map(key => ({ key, value: key })))).toEqual([]);
  });

  it('refuses an oversized record and keeps every other change', () => {
    applyFallbackChanges('favorites', [{ key: 'favorite:ch1', value: 'ch1' }], ['favorite:ch2']);
    applyFallbackChanges('channel-state', [{ key: 'audio:ch1', value: { language: 'l1' } }], []);
    const before = fallbackSnapshot();

    const meta = { order: Array.from({ length: 60000 }, (_, i) => `channel-${i}-xx`) };
    expect(JSON.stringify(meta).length).toBeGreaterThan(FALLBACK_TOTAL_CHARS);
    expect(applyFallbackChanges('channel-state', [{ key: 'custom:meta', value: meta }], []))
      .toBe('too_large');
    expect(fallbackSnapshot()).toEqual(before);
  });

  it('drops a deletion of a key IndexedDB does not hold', () => {
    applyFallbackChanges('recently-watched', [{ key: 'live:ch1', value: 1 }], []);

    expect(applyFallbackChanges('recently-watched', [], ['live:ch1', 'live:ch2'], {
      storedKeys: ['live:ch2'],
    })).toBe('ok');
    expect(fallbackSnapshot()).toEqual([{ store: 'recently-watched', puts: [], deletes: ['live:ch2'] }]);
  });

  it('keeps newer fallback records over a migrated baseline, and never evicts for it', () => {
    applyFallbackChanges('favorites', [], ['favorite:ch1']);
    applyFallbackChanges('reminders', [{ key: 'r1', value: 'new' }], []);

    expect(applyFallbackChanges('reminders', [
      { key: 'r1', value: 'old' },
      { key: 'r2', value: 'old' },
    ], [], { keepExisting: true, noEvict: true })).toBe('ok');
    expect(applyFallbackChanges('favorites', [{ key: 'favorite:ch1', value: 'ch1' }], [], {
      keepExisting: true,
    })).toBe('ok');
    expect(mergeFallbackRecords('reminders', [])).toEqual([
      { key: 'r1', value: 'new' },
      { key: 'r2', value: 'old' },
    ]);
    expect(mergeFallbackRecords('favorites', [{ key: 'favorite:ch1', value: 'ch1' }])).toEqual([]);

    const big = 'x'.repeat(FALLBACK_TOTAL_CHARS / 2 - 100);
    expect(applyFallbackChanges('channel-state', [{ key: 'a', value: big }], [])).toBe('ok');
    expect(applyFallbackChanges('channel-state', [{ key: 'b', value: big }], [], {
      noEvict: true,
    })).toBe('full');
    expect(mergeFallbackRecords('channel-state', []).map(item => item.key)).toEqual(['a']);
  });

  it('caps the total by evicting the oldest, never the parental lock or boot keys', () => {
    localStorage.setItem('iptv_playlists', '[{"id":"p1","url":"http://host/a"}]');
    localStorage.setItem('iptv_locale', '"system"');
    applyFallbackChanges('parental-control', [{ key: 'config', value: { enabled: true } }], []);
    const big = 'x'.repeat(10 * 1024);
    const count = Math.ceil(FALLBACK_TOTAL_CHARS / big.length) + 20;
    for (let i = 0; i < count; i++) {
      applyFallbackChanges('channel-state', [{ key: `audio:ch${i}`, value: big }], []);
    }

    expect(fallbackChars()).toBeLessThanOrEqual(FALLBACK_TOTAL_CHARS);
    const kept = mergeFallbackRecords('channel-state', []).map(item => item.key);
    expect(kept).toContain(`audio:ch${count - 1}`);
    expect(kept).not.toContain('audio:ch0');
    expect(mergeFallbackRecords('parental-control', [])).toEqual([
      { key: 'config', value: { enabled: true } },
    ]);
    expect(localStorage.getItem('iptv_playlists')).toBe('[{"id":"p1","url":"http://host/a"}]');
    expect(localStorage.getItem('iptv_locale')).toBe('"system"');
  });

  it('merges puts and deletions over the IndexedDB records', () => {
    applyFallbackChanges('favorites', [{ key: 'favorite:ch3', value: 'ch3' }], ['favorite:ch1']);

    expect(mergeFallbackRecords('favorites', [
      { key: 'favorite:ch1', value: 'ch1' },
      { key: 'favorite:ch2', value: 'ch2' },
    ])).toEqual([
      { key: 'favorite:ch2', value: 'ch2' },
      { key: 'favorite:ch3', value: 'ch3' },
    ]);
    expect(fallbackSnapshot()).toEqual([{
      store: 'favorites',
      puts: [{ key: 'favorite:ch3', value: 'ch3' }],
      deletes: ['favorite:ch1'],
    }]);
  });
});
