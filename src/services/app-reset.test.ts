// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';

const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('./luna', () => ({
  isLunaAvailable: () => true,
  lunaRequest: vi.fn((_uri: string, opts: { method: string; parameters: { activityName?: string } }) => {
    calls.push(`${opts.method}:${opts.parameters.activityName ?? ''}`);
  }),
}));
vi.mock('./playlist-service', () => ({
  PlaylistService: { channels: [], getUnconcealedChannels: () => [] },
}));
vi.mock('./idb-cache', async importOriginal => ({
  ...await importOriginal<typeof import('./idb-cache')>(),
  clearAllCachedData: vi.fn(async () => { calls.push('clearAllCachedData'); }),
}));

import { resetAppData } from './app-reset';
import { StorageService } from './storage-service';
import { lunaRequest } from './luna';
import { clearAllCachedData } from './idb-cache';

describe('resetAppData', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    calls.length = 0;
  });

  it('cancels every scheduled reminder activity before clearing storage', async () => {
    StorageService.setReminders([
      { channelKey: 'ch1', channelName: 'Alpha', title: 'Bravo', startMs: 5000, stopMs: 6000 },
      { channelKey: 'ch2', channelName: 'Charlie', title: 'Bravo', startMs: 7000, stopMs: 8000 },
    ]);
    vi.spyOn(StorageService, 'clearUserData').mockImplementation(async () => {
      calls.push('clearUserData');
    });
    vi.spyOn(StorageService, 'clearAll').mockImplementation(() => {
      calls.push('clearAll');
    });

    await resetAppData();

    expect(lunaRequest).toHaveBeenCalledWith(
      'luna://com.webos.service.activitymanager',
      expect.objectContaining({ method: 'cancel' }),
    );
    expect(calls).toEqual([
      'cancel:iptvReminder-ch1-5000',
      'cancel:iptvReminder-ch2-7000',
      'clearAllCachedData',
      'clearUserData',
      'clearAll',
    ]);
  });

  it('clears localStorage even when IndexedDB cannot be cleared', async () => {
    localStorage.setItem('iptv_playlists', '[{"id":"p1","url":"http://host/a"}]');
    localStorage.setItem('iptv_fb_favorites', '{"r":{},"d":{"favorite:ch1":1}}');
    vi.mocked(clearAllCachedData).mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    vi.spyOn(StorageService, 'clearUserData').mockRejectedValue(new Error('IndexedDB unavailable'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(resetAppData()).resolves.toBeUndefined();

    expect(localStorage.length).toBe(0);
    expect(error.mock.calls.map(call => call.join(' '))
      .filter(line => line.indexOf('event=persistence.reset.step.failed') >= 0)
      .map(line => /step=(\w+)/.exec(line)?.[1])).toEqual(['caches', 'user_data']);
  });
});
