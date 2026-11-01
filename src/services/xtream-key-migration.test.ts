import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Channel } from '../types';

const { storageMock, parentalMock, fetchTextMock } = vi.hoisted(() => ({
  storageMock: {
    channelDataKeys: vi.fn((): Set<string> => new Set()),
    renameChannelKeys: vi.fn((aliases: Map<string, string>) => aliases.size),
  },
  parentalMock: {
    liveChannelKeys: vi.fn((): string[] => []),
    renameChannelKeys: vi.fn(() => 0),
  },
  fetchTextMock: vi.fn(),
}));

vi.mock('./storage-service', () => ({ StorageService: storageMock }));
vi.mock('./parental-control', () => ({ ParentalControlService: parentalMock }));
vi.mock('./channel-customization', () => ({ ChannelCustomizationService: { reload: vi.fn() } }));
vi.mock('../utils/fetch-helper', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/fetch-helper')>(),
  fetchLimitedText: fetchTextMock,
}));

import { migrateXtreamChannelKeys } from './xtream-key-migration';
import { createXtreamClient, resetXtreamSignIns } from './xtream-client';
import { ChannelCustomizationService } from './channel-customization';
import { channelKey } from '../utils/channel';

const credentials = { baseUrl: 'http://host:8080', username: 'u1', password: 'p1' };

function channel(url: string, streamId = ''): Channel {
  return {
    id: '', name: '', logo: '', group: '', url, extras: null, playlistIds: [],
    catchup: '', catchupSource: '', catchupDays: 0,
    ...(streamId ? { catchupStreamId: streamId } : {}),
  };
}

const keyOf = (url: string): string => channelKey(channel(url));
const api101 = channel('http://host:8080/live/u1/p1/101.m3u8', '101');
const api102 = channel('http://host:8080/live/u1/p1/102.m3u8', '102');

beforeEach(() => {
  vi.clearAllMocks();
  resetXtreamSignIns();
  storageMock.channelDataKeys.mockReturnValue(new Set());
  parentalMock.liveChannelKeys.mockReturnValue([]);
});

describe('migrateXtreamChannelKeys', () => {
  it('does nothing when every saved key belongs to a loaded channel', () => {
    storageMock.channelDataKeys.mockReturnValue(new Set([channelKey(api101)]));
    expect(migrateXtreamChannelKeys([{ credentials, channels: [api101] }], [api101])).toBe(0);
    expect(storageMock.renameChannelKeys).not.toHaveBeenCalled();
  });

  it('moves keys saved under other get.php spellings of the same stream', () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const tsKey = keyOf('http://host:8080/live/u1/p1/101.ts');
    const bareKey = keyOf('http://host:8080/u1/p1/102');
    storageMock.channelDataKeys.mockReturnValue(new Set([tsKey, 'unrelated']));
    parentalMock.liveChannelKeys.mockReturnValue([bareKey]);

    migrateXtreamChannelKeys([{ credentials, channels: [api101, api102] }], [api101, api102]);

    const aliases = new Map([[tsKey, channelKey(api101)], [bareKey, channelKey(api102)]]);
    expect(storageMock.renameChannelKeys).toHaveBeenCalledWith(aliases);
    expect(info).toHaveBeenCalledWith('[Playlist]', expect.any(String),
      'event=xtream.channel_keys.migrated', 'keys=2', 'records=2');
    info.mockRestore();
    expect(parentalMock.renameChannelKeys).toHaveBeenCalledWith(aliases);
    expect(ChannelCustomizationService.reload).toHaveBeenCalled();
  });

  it("moves a key saved under the panel's own host once a sign-in named it", async () => {
    const panelKey = keyOf('http://panel/live/u1/p1/101.ts');
    storageMock.channelDataKeys.mockReturnValue(new Set([panelKey]));
    const sources = [{ credentials, channels: [api101] }];

    expect(migrateXtreamChannelKeys(sources, [api101])).toBe(0);

    fetchTextMock.mockResolvedValue(JSON.stringify({
      user_info: { auth: 1 }, server_info: { url: 'panel', port: '80' },
    }));
    await createXtreamClient(credentials).getAccountInfo();
    migrateXtreamChannelKeys(sources, [api101]);
    expect(storageMock.renameChannelKeys)
      .toHaveBeenCalledWith(new Map([[panelKey, channelKey(api101)]]));
  });

  it('leaves a key that a loaded channel, such as a plain M3U entry, still uses', () => {
    const m3u = channel('http://host:8080/live/u1/p1/101.ts');
    storageMock.channelDataKeys.mockReturnValue(new Set([channelKey(m3u)]));
    expect(migrateXtreamChannelKeys([{ credentials, channels: [api101] }], [api101, m3u])).toBe(0);
    expect(storageMock.renameChannelKeys).not.toHaveBeenCalled();
  });

  it('leaves a key two loaded streams could claim', () => {
    const tsKey = keyOf('http://host:8080/live/u1/p1/101.ts');
    const twin = channel('https://host/direct/101', '101');
    storageMock.channelDataKeys.mockReturnValue(new Set([tsKey]));
    expect(migrateXtreamChannelKeys(
      [{ credentials, channels: [api101, twin] }],
      [api101, twin],
    )).toBe(0);
  });
});
