// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyFallbackChanges,
  FALLBACK_STORE_CAPS,
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

  it('keeps the most recent records of each store', () => {
    const cap = FALLBACK_STORE_CAPS['recently-watched'];
    for (let i = 0; i < cap + 5; i++) {
      applyFallbackChanges('recently-watched', [{ key: `live:ch${i}`, value: i }], []);
    }

    const kept = mergeFallbackRecords('recently-watched', []).map(item => item.key);
    expect(kept).toHaveLength(cap);
    expect(kept[0]).toBe('live:ch5');
    expect(kept[cap - 1]).toBe(`live:ch${cap + 4}`);
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
