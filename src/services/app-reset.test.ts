// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

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

describe('resetAppData', () => {
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
});
