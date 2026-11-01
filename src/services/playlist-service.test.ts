import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Channel, ChannelCustomization, PlaylistEntry } from '../types';
import { UNCATEGORIZED_GROUP } from '../types';

const { storageMock, cacheMock, fetchTextMock } = vi.hoisted(() => ({
  storageMock: {
    getPlaylists: vi.fn(),
    getFavorites: vi.fn(() => [] as string[]),
    getShowHiddenChannels: vi.fn(() => false),
    getChannelCustomization: vi.fn(() => null),
    getPlaylistRefreshIntervalMs: vi.fn(() => 6 * 60 * 60 * 1000),
    setChannelCustomization: vi.fn(),
    clearChannelCustomization: vi.fn(),
    liveCategorySnapshots: new Map<string, unknown>(),
    getLiveCategorySnapshot: vi.fn(function getLiveCategorySnapshot(id: string) {
      return storageMock.liveCategorySnapshots.get(id) ?? null;
    }),
    setLiveCategorySnapshot: vi.fn((id: string, snapshot: unknown) => {
      storageMock.liveCategorySnapshots.set(id, snapshot);
    }),
    getXtreamOutputFormats: vi.fn((): string[] | null => null),
    setXtreamOutputFormats: vi.fn(),
    channelDataKeys: vi.fn(() => new Set<string>(storageMock.getFavorites())),
    renameChannelKeys: vi.fn((aliases: Map<string, string>) => {
      const favorites = storageMock.getFavorites();
      storageMock.getFavorites.mockReturnValue(favorites.map(key => aliases.get(key) ?? key));
      return favorites.filter(key => aliases.has(key)).length;
    }),
  },
  cacheMock: {
    getCachedPlaylist: vi.fn(),
    scheduleCachedPlaylist: vi.fn(),
    playlistCacheToken: vi.fn(() => ({ signature: 's1', generation: 0 })),
    cacheRecordRef: vi.fn((_value: unknown): unknown => null),
  },
  fetchTextMock: vi.fn(),
}));

vi.mock('./storage-service', () => ({ StorageService: storageMock }));
vi.mock('./idb-cache', () => cacheMock);
vi.mock('../parsers/m3u-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../parsers/m3u-loader')>();
  return {
    ...actual,
    fetchAndParseM3U: vi.fn(async (
      url: string,
      timeout: number,
      streams?: Array<{ streamId: string; directSource: string }>,
      baseUrl?: string,
      onProgress?: (progress: {
        inputBytes: number;
        chunks: number;
        channelsProcessed: number;
        channelsKept: number;
        channelsDropped: number;
      }) => void,
      groupFilter?: { mode: 'include' | 'exclude'; names: string[] },
    ) => {
      const text = await fetchTextMock(url, timeout);
      const { parseM3U } = await import('../parsers/m3u-parser');
      const liveFilters = actual.createXtreamM3ULiveFilters(streams, baseUrl, groupFilter);
      const data = parseM3U(text, url, {
        ...(liveFilters.streamLocationPrefilter
          ? {
              streamLocationPrefilter:
                liveFilters.streamLocationPrefilter,
            }
          : {}),
        ...(liveFilters.channelPostfilter
          ? { channelPostfilter: liveFilters.channelPostfilter }
          : {}),
      });
      onProgress?.({
        inputBytes: text.length,
        chunks: 1,
        channelsProcessed: data.channels.length + liveFilters.getDroppedCount(),
        channelsKept: data.channels.length,
        channelsDropped: liveFilters.getDroppedCount(),
      });
      return {
        data,
        metrics: {
          transport: 'stream' as const,
          filter: liveFilters.mode,
          inputBytes: text.length,
          chunks: 1,
          channelsKept: data.channels.length,
          channelsDropped: liveFilters.getDroppedCount(),
          elapsedMs: 0,
        },
      };
    }),
  };
});
vi.mock('../utils/fetch-helper', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/fetch-helper')>(),
  fetchText: fetchTextMock,
  fetchLimitedText: fetchTextMock,
}));

import { PlaylistService } from './playlist-service';
import { fetchAndParseM3U } from '../parsers/m3u-loader';
import {
  channelKey,
  legacyChannelKey,
} from '../utils/channel';
import { ChannelCustomizationService } from './channel-customization';
import { ParentalControlService } from './parental-control';
import { CONFIG } from '../config';
import { parseM3U } from '../parsers/m3u-parser';
import { checkConnections } from './connection-check';
import { resetXtreamSignIns } from './xtream-client';

function channel(over: Partial<Channel>): Channel {
  return {
    id: '', name: '', logo: '', group: '', url: '', extras: null,
    playlistIds: [], catchup: '', catchupSource: '', catchupDays: 0, ...over,
  };
}

const P1 = `#EXTM3U url-tvg="http://localhost:8080/epg.xml"
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://stream/u1
#EXTINF:-1 tvg-id="b",Bravo
http://stream/u2`;

const P2 = `#EXTM3U
#EXTINF:-1 tvg-id="b",Bravo Dup
http://stream/u2
#EXTINF:-1 tvg-id="c" group-title="Sports",Charlie
http://stream/u3`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  resetXtreamSignIns();
  storageMock.getFavorites.mockReturnValue([]);
  storageMock.getXtreamOutputFormats.mockReturnValue(null);
  cacheMock.getCachedPlaylist.mockResolvedValue(null);
  PlaylistService.allChannels = [];
  PlaylistService.channels = [];
  PlaylistService.groups = [];
  PlaylistService.playlistTabs = [];
  PlaylistService.epgSources = [];
});

describe('PlaylistService.refresh', () => {
  beforeEach(() => {
    storageMock.getPlaylists.mockReturnValue([
      { id: 'a', name: 'P1', url: 'http://host1/p1.m3u' },
      { id: 'b', name: 'P2', url: 'http://host2/p2.m3u' },
    ]);
    fetchTextMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes('p1') ? P1 : P2),
    );
  });

  it('merges playlists and de-duplicates channels by URL', async () => {
    const channels = await PlaylistService.refresh();
    expect(channels.map(c => c.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('schedules the next refresh from the last successful refresh time', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      await PlaylistService.refresh();

      now.mockReturnValue(1_000_000 + 2 * 60 * 60 * 1000);

      expect(PlaylistService.getNextRefreshDelayMs(6 * 60 * 60 * 1000))
        .toBe(4 * 60 * 60 * 1000);
    } finally {
      now.mockRestore();
    }
  });

  it('reports cumulative channel-loading progress across sources', async () => {
    const progress: Parameters<typeof PlaylistService.refresh>[0] extends
      ((value: infer Value) => void) ? Value[] : never = [];

    await PlaylistService.refresh(value => progress.push(value));

    expect(progress).toEqual([
      {
        sourceNumber: 1,
        sourceCount: 2,
        inputBytes: P1.length,
        channelsProcessed: 2,
        channelsKept: 2,
      },
      {
        sourceNumber: 2,
        sourceCount: 2,
        inputBytes: P2.length,
        channelsProcessed: 4,
        channelsKept: 4,
      },
    ]);
  });

  it('loads a bare MPD playlist URL as a single DASH channel', async () => {
    storageMock.getPlaylists.mockReturnValue([
      { id: 'a', name: 'DASH', url: 'http://host/live.mpd' },
    ]);
    fetchTextMock.mockResolvedValue(
      '<?xml version="1.0"?><MPD type="dynamic"></MPD>',
    );

    const channels = await PlaylistService.refresh();

    expect(channels).toEqual([
      expect.objectContaining({
        name: 'live',
        url: 'http://host/live.mpd',
        playlistIds: ['a'],
      }),
    ]);
  });

  it('loads every distinct EPG URL declared by a playlist', async () => {
    fetchTextMock.mockResolvedValue(
      '#EXTM3U url-tvg="http://host/a.xml,http://host/b.xml"\n'
      + '#EXTINF:-1,Alpha\nhttp://host/a',
    );
    await PlaylistService.refresh();
    expect(PlaylistService.epgSources.map(source => source.url)).toEqual([
      'http://host/a.xml',
      'http://host/b.xml',
    ]);
  });

  it('tags each channel with every source playlist (by id) it appears in', async () => {
    await PlaylistService.refresh();
    // P1 is id 'a', P2 is id 'b'. Bravo (u2) is shared, so it belongs to both.
    expect(PlaylistService.channels.map(c => c.playlistIds)).toEqual([['a'], ['a', 'b'], ['b']]);
  });

  it('rewrites a loopback EPG host to the playlist host', async () => {
    await PlaylistService.refresh();
    expect(PlaylistService.epgSources).toEqual([
      { url: 'http://host1:8080/epg.xml', playlistIds: ['a'], kind: 'm3u' },
    ]);
  });

  it('builds the group set and one tab per loaded playlist', async () => {
    await PlaylistService.refresh();
    expect(PlaylistService.groups).toEqual(['News', UNCATEGORIZED_GROUP, 'Sports']);
    expect(PlaylistService.playlistTabs).toEqual([
      { id: 'a', name: 'P1' },
      { id: 'b', name: 'P2' },
    ]);
  });

  it('keeps a fully-duplicated playlist as its own tab showing its channels', async () => {
    // P3 has the same content as P1: every channel is de-duplicated away, but
    // its tab must still appear and list those shared channels.
    storageMock.getPlaylists.mockReturnValue([
      { id: 'a', name: 'P1', url: 'http://host1/p1.m3u' },
      { id: 'b', name: 'P2', url: 'http://host2/p2.m3u' },
      { id: 'c', name: 'P3', url: 'http://host3/p1.m3u' },
    ]);
    await PlaylistService.refresh();
    expect(PlaylistService.playlistTabs).toEqual([
      { id: 'a', name: 'P1' },
      { id: 'b', name: 'P2' },
      { id: 'c', name: 'P3' },
    ]);
    expect(PlaylistService.getByGroup('builtin:all', 'c').map(c => c.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('keeps a same-URL sibling tab after the other is deleted', async () => {
    // The reported case: two playlists share a URL; deleting one must not drop
    // the other. Each has its own id, so the survivor keeps its tab + channels.
    storageMock.getPlaylists.mockReturnValue([
      { id: 'a', name: 'P1', url: 'http://host1/p1.m3u' },
      { id: 'c', name: 'P3', url: 'http://host3/p1.m3u' }, // same content as P1
    ]);
    await PlaylistService.refresh();
    expect(PlaylistService.playlistTabs).toEqual([
      { id: 'a', name: 'P1' },
      { id: 'c', name: 'P3' },
    ]);

    // Delete P1; only P3 remains configured.
    storageMock.getPlaylists.mockReturnValue([
      { id: 'c', name: 'P3', url: 'http://host3/p1.m3u' },
    ]);
    await PlaylistService.refresh();
    expect(PlaylistService.playlistTabs).toEqual([{ id: 'c', name: 'P3' }]);
    expect(PlaylistService.getByGroup('builtin:all', 'c').map(ch => ch.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('still shows a tab for a configured playlist that loaded no channels', async () => {
    storageMock.getPlaylists.mockReturnValue([
      { id: 'a', name: 'P1', url: 'http://host1/p1.m3u' },
      { id: 'x', name: 'Down', url: 'http://host9/down.m3u' }, // unreachable
    ]);
    fetchTextMock.mockImplementation((url: string) =>
      url.includes('down') ? Promise.reject(new Error('unreachable')) : Promise.resolve(P1));
    await PlaylistService.refresh();
    expect(PlaylistService.playlistTabs).toEqual([
      { id: 'a', name: 'P1' },
      { id: 'x', name: 'Down' },
    ]);
    expect(PlaylistService.getByGroup('builtin:all', 'x')).toEqual([]); // its tab is empty when selected
  });

  it('shows two same-named playlists as separate tabs, each with its own channels', async () => {
    storageMock.getPlaylists.mockReturnValue([
      { id: 'a', name: 'Combo', url: 'http://host1/p1.m3u' },
      { id: 'b', name: 'Combo', url: 'http://host2/p2.m3u' },
    ]);
    await PlaylistService.refresh();
    expect(PlaylistService.playlistTabs).toEqual([
      { id: 'a', name: 'Combo' },
      { id: 'b', name: 'Combo' },
    ]);
    // Each tab shows only its own playlist's channels; "All" still de-dups.
    expect(PlaylistService.getByGroup('builtin:all', 'a').map(c => c.name)).toEqual(['Alpha', 'Bravo']);
    expect(PlaylistService.getByGroup('builtin:all', 'b').map(c => c.name)).toEqual(['Bravo', 'Charlie']);
    expect(PlaylistService.channels.map(c => c.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('persists the merged result to the cache', async () => {
    await PlaylistService.refresh();
    expect(cacheMock.scheduleCachedPlaylist).toHaveBeenCalledWith(
      PlaylistService.channels,
      [{ url: 'http://host1:8080/epg.xml', playlistIds: ['a'], kind: 'm3u' }],
      expect.any(Number),
      6 * 60 * 60 * 1000,
      { signature: 's1', generation: 0 },
    );
  });

  it('binds the cache write to the sources the refresh started with', async () => {
    const started = { signature: 'before', generation: 1 };
    cacheMock.playlistCacheToken.mockReturnValueOnce(started);
    cacheMock.playlistCacheToken.mockReturnValueOnce({ signature: 'after', generation: 2 });

    await PlaylistService.refresh();

    expect(cacheMock.scheduleCachedPlaylist.mock.calls[0][4]).toBe(started);
  });

  it('does not block the refreshed channel list on cache persistence', async () => {
    await expect(PlaylistService.refresh()).resolves.toHaveLength(3);
    expect(cacheMock.scheduleCachedPlaylist).toHaveBeenCalledOnce();
  });

  it('returns an empty list and skips fetching when no playlists are configured', async () => {
    storageMock.getPlaylists.mockReturnValue([]);
    const channels = await PlaylistService.refresh();
    expect(channels).toEqual([]);
    expect(fetchTextMock).not.toHaveBeenCalled();
  });

  it('skips disabled sources and omits their playlist tabs', async () => {
    storageMock.getPlaylists.mockReturnValue([
      { id: 'a', name: 'P1', url: 'http://host1/p1.m3u', enabled: false },
      { id: 'b', name: 'P2', url: 'http://host2/p2.m3u' },
    ]);

    const channels = await PlaylistService.refresh();

    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(fetchTextMock).toHaveBeenCalledWith('http://host2/p2.m3u', 60000);
    expect(channels.map(channel => channel.name)).toEqual(['Bravo Dup', 'Charlie']);
    expect(PlaylistService.playlistTabs).toEqual([{ id: 'b', name: 'P2' }]);
  });

  it('clears in-memory channels when every source is disabled', async () => {
    PlaylistService.allChannels = [
      channel({ id: 'a', name: 'Alpha', url: 'http://stream/a', playlistIds: ['a'] }),
    ];
    PlaylistService.channels = PlaylistService.allChannels;
    storageMock.getPlaylists.mockReturnValue([
      { id: 'a', name: 'P1', url: 'http://host1/p1.m3u', enabled: false },
    ]);

    await expect(PlaylistService.refresh()).resolves.toEqual([]);

    expect(PlaylistService.allChannels).toEqual([]);
    expect(PlaylistService.playlistTabs).toEqual([]);
    expect(fetchTextMock).not.toHaveBeenCalled();
  });

  it('skips a playlist that fails to fetch but keeps the others', async () => {
    fetchTextMock.mockImplementation((url: string) =>
      url.includes('p1') ? Promise.reject(new Error('boom')) : Promise.resolve(P2),
    );
    const channels = await PlaylistService.refresh();
    expect(channels.map(c => c.name)).toEqual(['Bravo Dup', 'Charlie']);
    expect(cacheMock.scheduleCachedPlaylist).not.toHaveBeenCalled();
    expect(PlaylistService.hasFailedSource(['a'])).toBe(true);
    expect(PlaylistService.hasFailedSource(['b'])).toBe(false);
    fetchTextMock.mockResolvedValue(P1);
    await PlaylistService.refresh();
    expect(PlaylistService.hasFailedSource(['a'])).toBe(false);
  });

  it('keeps the current list when an automatic refresh is incomplete', async () => {
    await PlaylistService.refresh();
    const previousChannels = PlaylistService.channels;
    const previousEpgSources = PlaylistService.epgSources;
    fetchTextMock.mockImplementation((url: string) =>
      url.includes('p1') ? Promise.reject(new Error('boom')) : Promise.resolve(P2),
    );

    const channels = await PlaylistService.refresh(
      undefined,
      { preserveOnFailure: true },
    );

    expect(channels).toBe(previousChannels);
    expect(PlaylistService.channels).toBe(previousChannels);
    expect(PlaylistService.epgSources).toBe(previousEpgSources);
    expect(PlaylistService.channels.map(channel => channel.name))
      .toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(PlaylistService.hasFailedSource(['a'])).toBe(true);
    expect(cacheMock.scheduleCachedPlaylist).toHaveBeenCalledOnce();
  });

  it('reports a failed load only when no source brought channels', async () => {
    fetchTextMock.mockImplementation((url: string) =>
      url.includes('p1') ? Promise.reject(new Error('boom')) : Promise.resolve(P2),
    );
    await PlaylistService.refresh();
    expect(PlaylistService.loadFailed).toBe(false);

    fetchTextMock.mockRejectedValue(new Error('offline'));
    await PlaylistService.refresh();
    expect(PlaylistService.loadFailed).toBe(true);

    fetchTextMock.mockResolvedValue('#EXTM3U\n');
    await PlaylistService.refresh();
    expect(PlaylistService.allChannels).toEqual([]);
    expect(PlaylistService.loadFailed).toBe(false);
  });

  it('clears unresolved source state when the catalog is reset', async () => {
    fetchTextMock.mockRejectedValue(new Error('offline'));
    await PlaylistService.refresh();
    expect(PlaylistService.hasFailedSource(['a'])).toBe(true);
    PlaylistService.reset();
    expect(PlaylistService.hasFailedSource(['a'])).toBe(false);
  });

  it('logs the loaded catalog size for a diagnostics report', async () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    await PlaylistService.refresh();
    expect(info.mock.calls.map(args => args.join(' '))).toContainEqual(
      expect.stringContaining(
        'event=playlist.load.completed source=network channels=3 all=3'
        + ' groups=3 epg=1 sources=2 failed=0',
      ),
    );
    info.mockRestore();
  });

  it('warns with the failed source count when a playlist load fails', async () => {
    fetchTextMock.mockRejectedValue(new Error('down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await PlaylistService.refresh();
    expect(warn.mock.calls.map(args => args.join(' '))).toContainEqual(
      expect.stringContaining(
        'event=playlist.load.completed source=network channels=0 all=0'
        + ' groups=0 epg=0 sources=2 failed=2',
      ),
    );
    warn.mockRestore();
    error.mockRestore();
  });
});

describe('PlaylistService.refresh (xtream source)', () => {
  // What an m3u_plus get.php lists for the same account: the live lines,
  // then a movie the Player API path never sees.
  const XT = `#EXTM3U
#EXTINF:-1 tvg-id="epg-a" tvg-name="Alpha" tvg-logo="http://host/a.png" group-title="News",Alpha
http://host:8080/live/u1/p1/101.ts
#EXTINF:-1 tvg-id="" tvg-name="Bravo" tvg-logo="" group-title="Sports",Bravo
http://host:8080/live/u1/p1/102.ts
#EXTINF:-1 tvg-id="" tvg-name="Movie" tvg-logo="" group-title="Films",Movie
http://host:8080/movie/u1/p1/301.mp4`;
  const CATEGORIES = [
    { category_id: '1', category_name: 'News' },
    { category_id: '2', category_name: 'Sports' },
  ];
  let liveStreams: Array<Record<string, unknown>>;
  let liveStreamsBody: string | null;
  let accountBody: string;
  let playlistBody: string | Error;

  const requests = (match: RegExp): string[] =>
    fetchTextMock.mock.calls.map(([url]) => url as string).filter(url => match.test(url));
  const SIGN_IN = /\/player_api\.php\?username=u1&password=p1$/;
  const GET_PHP = /\/get\.php\?/;

  function account(xtream: Record<string, unknown> = {}) {
    storageMock.getPlaylists.mockReturnValue([
      { id: 'x', name: 'Acct', url: 'http://host:8080', source: 'xtream',
        xtream: { username: 'u1', password: 'p1', ...xtream } },
    ]);
  }

  beforeEach(() => {
    account();
    liveStreams = [
      { num: 1, stream_id: 101, name: 'Alpha', stream_icon: 'http://host/a.png',
        epg_channel_id: 'epg-a', category_id: '1', tv_archive: 1, tv_archive_duration: '7' },
      { num: 2, stream_id: 102, name: 'Bravo', stream_icon: '', epg_channel_id: null,
        category_id: '2', tv_archive: 0, tv_archive_duration: 0 },
    ];
    liveStreamsBody = null;
    accountBody = JSON.stringify({
      user_info: { auth: 1, allowed_output_formats: ['ts', 'm3u8'] },
      server_info: { url: 'host', port: '8080', timezone: 'Etc/GMT-2',
        timestamp_now: 1784665800, time_now: '2026-07-21 22:30:00' },
    });
    playlistBody = XT;
    fetchTextMock.mockImplementation((url: string) => {
      if (url.includes('action=get_live_streams')) {
        return Promise.resolve(liveStreamsBody ?? JSON.stringify(liveStreams));
      }
      if (url.includes('action=get_live_categories')) return Promise.resolve(JSON.stringify(CATEGORIES));
      if (url.includes('player_api.php')) return Promise.resolve(accountBody);
      if (playlistBody instanceof Error) return Promise.reject(playlistBody);
      return Promise.resolve(playlistBody);
    });
  });

  it('builds Live from the Player API without requesting get.php', async () => {
    const channels = await PlaylistService.refresh();

    expect(channels.map(c => c.name)).toEqual(['Alpha', 'Bravo']);
    expect(channels.map(c => c.url)).toEqual([
      'http://host:8080/live/u1/p1/101.ts',
      'http://host:8080/live/u1/p1/102.ts',
    ]);
    expect(requests(GET_PHP)).toEqual([]);
    expect(vi.mocked(fetchAndParseM3U)).not.toHaveBeenCalled();
  });

  it('gives the channels get.php would, with the same keys', async () => {
    const fromApi = await PlaylistService.refresh();
    const apiChannels = PlaylistService.allChannels.slice();
    liveStreamsBody = '<html>nope</html>';
    const fromPlaylist = await PlaylistService.refresh();

    expect(requests(GET_PHP)).toHaveLength(1);
    const shape = (channels: Channel[]) => channels.map(c => ({
      id: c.id, name: c.name, logo: c.logo, group: c.group, url: c.url,
      key: channelKey(c), legacyKey: legacyChannelKey(c),
    }));
    // get.php also listed a movie; the fallback has no catalog to drop it by.
    expect(shape(fromApi)).toEqual(shape(fromPlaylist.slice(0, 2)));
    expect(PlaylistService.groups.slice(0, 2)).toEqual(['News', 'Sports']);
    expect(apiChannels[0]).toMatchObject({
      catchup: 'xtream',
      catchupDays: 7,
      catchupSource: 'http://host:8080/timeshift/u1/p1/{duration}/{start}/101.ts',
      catchupAccountId: 'x',
      catchupStreamId: '101',
      catchupTimeZone: 'Etc/GMT-2',
      catchupTimeOffsetMinutes: 120,
    });
    expect(apiChannels[1].catchupSource).toBe('');
  });

  it('keeps favorites and hidden channels saved against get.php channels', async () => {
    const saved = parseM3U(XT, 'http://host:8080/get.php').channels;
    storageMock.getFavorites.mockReturnValue([channelKey(saved[0])]);
    storageMock.getChannelCustomization.mockReturnValue({
      version: CONFIG.CHANNEL_CUSTOMIZATION_VERSION,
      overrides: { [channelKey(saved[1])]: { hidden: true } },
      order: [], groupOrder: [], groupOverrides: {}, customGroups: [],
    });
    ChannelCustomizationService.reload();
    try {
      await PlaylistService.refresh();
      expect(PlaylistService.channels.map(c => c.name)).toEqual(['Alpha']);
      expect(PlaylistService.getByGroup('builtin:favorites').map(c => c.name)).toEqual(['Alpha']);
      expect(storageMock.renameChannelKeys).not.toHaveBeenCalled();
    } finally {
      storageMock.getChannelCustomization.mockReturnValue(null);
      ChannelCustomizationService.reload();
    }
  });

  it('lists channels in the provider order and keeps its numbers', async () => {
    liveStreams = [
      { num: 3, stream_id: 103, name: 'Charlie', category_id: '2' },
      { num: 1, stream_id: 101, name: 'Alpha', category_id: '1' },
      { num: 2, stream_id: 102, name: 'Bravo', category_id: '2' },
    ];
    const channels = await PlaylistService.refresh();
    expect(channels.map(c => [c.name, c.channelNumber])).toEqual([
      ['Alpha', 1], ['Bravo', 2], ['Charlie', 3],
    ]);

    liveStreams = [
      { stream_id: 103, name: 'Charlie', category_id: '2' },
      { num: 1, stream_id: 101, name: 'Alpha', category_id: '1' },
    ];
    expect((await PlaylistService.refresh()).map(c => c.name)).toEqual(['Charlie', 'Alpha']);
  });

  it('builds HLS URLs for an explicit m3u8 preference without signing in', async () => {
    account({ liveOutput: 'm3u8' });
    liveStreams[0].tv_archive = 0;
    const channels = await PlaylistService.refresh();
    expect(channels[0].url).toBe('http://host:8080/live/u1/p1/101.m3u8');
    expect(requests(SIGN_IN)).toEqual([]);
  });

  it('auto-prefers HLS when the account advertises it, and remembers that', async () => {
    account({ liveOutput: 'auto' });
    const channels = await PlaylistService.refresh();
    expect(channels[0].url).toBe('http://host:8080/live/u1/p1/101.m3u8');
    expect(storageMock.setXtreamOutputFormats)
      .toHaveBeenCalledWith('x', 'http://host:8080|u1', ['ts', 'm3u8']);
  });

  it('loads with the remembered formats before the sign-in answers', async () => {
    account({ liveOutput: 'auto' });
    liveStreams[0].tv_archive = 0;
    storageMock.getXtreamOutputFormats.mockReturnValue(['m3u8']);
    fetchTextMock.mockImplementation((url: string) => {
      if (url.includes('action=get_live_streams')) return Promise.resolve(JSON.stringify(liveStreams));
      if (url.includes('action=get_live_categories')) return Promise.resolve('[]');
      return new Promise<string>(() => {});
    });

    const channels = await PlaylistService.refresh();

    expect(channels[0].url).toBe('http://host:8080/live/u1/p1/101.m3u8');
    expect(storageMock.getXtreamOutputFormats).toHaveBeenCalledWith('x', 'http://host:8080|u1');
  });

  it("signs in once across Home's check and the channel load", async () => {
    account({ liveOutput: 'auto' });
    const playlists = storageMock.getPlaylists() as PlaylistEntry[];

    const check = checkConnections(playlists);
    const channels = await PlaylistService.refresh();

    expect(await check).toBeNull();
    expect(channels[0]).toMatchObject({ catchup: 'xtream', catchupTimeZone: 'Etc/GMT-2' });
    expect(requests(SIGN_IN)).toHaveLength(1);
    expect(requests(GET_PHP)).toEqual([]);
    expect(requests(/player_api\.php/)).toHaveLength(3);
  });

  it('treats a successful empty Live catalog as authoritative', async () => {
    liveStreams = [];
    expect(await PlaylistService.refresh()).toEqual([]);
    expect(requests(GET_PHP)).toEqual([]);
  });

  it('loads get.php when the Live catalog is unavailable', async () => {
    liveStreamsBody = '<html>nope</html>';
    account({ liveOutput: 'auto' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const channels = await PlaylistService.refresh();

    expect(requests(GET_PHP)).toEqual([
      'http://host:8080/get.php?username=u1&password=p1&type=m3u_plus&output=m3u8',
    ]);
    // With no catalog to tell Live from VOD, nothing is guessed from the URL.
    expect(channels.map(c => c.name)).toEqual(['Alpha', 'Bravo', 'Movie']);
    expect(requests(/action=get_live_streams/)).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith('[Playlist]', expect.any(String),
      'event=xtream.live_fallback.used', 'load=1', 'reason=catalog_unavailable');
  });

  it('fails the source when neither the catalog nor get.php loads', async () => {
    liveStreamsBody = '<html>nope</html>';
    playlistBody = new Error('get.php unavailable');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await PlaylistService.refresh()).toEqual([]);
    expect(PlaylistService.loadFailed).toBe(true);
    expect(PlaylistService.playlistTabs).toEqual([{ id: 'x', name: 'Acct' }]);
  });

  it('uses a usable direct source and drops an unsafe one', async () => {
    liveStreams[0].direct_source = 'https://host/direct/101';
    liveStreams[1].direct_source = 'file:///tmp/not-allowed';
    const channels = await PlaylistService.refresh();
    expect(channels.map(c => c.url)).toEqual([
      'https://host/direct/101',
      'http://host:8080/live/u1/p1/102.ts',
    ]);
    expect(channels[0]).toMatchObject({ catchup: 'xtream', catchupStreamId: '101' });
  });

  it('loads uncategorized live streams when live categories are unsupported', async () => {
    fetchTextMock.mockImplementation((url: string) => {
      if (url.includes('action=get_live_categories')) {
        return Promise.resolve('<html>unsupported</html>');
      }
      if (url.includes('action=get_live_streams')) return Promise.resolve(JSON.stringify(liveStreams));
      if (url.includes('player_api.php')) return Promise.resolve(accountBody);
      return Promise.resolve('#EXTM3U');
    });

    const channels = await PlaylistService.refresh();
    expect(channels.map(c => c.group)).toEqual([UNCATEGORIZED_GROUP, UNCATEGORIZED_GROUP]);
  });

  it('pushes the derived xmltv.php EPG URL', async () => {
    await PlaylistService.refresh();
    expect(PlaylistService.epgSources.map((source) => source.url)).toEqual([
      'http://host:8080/xmltv.php?username=u1&password=p1',
    ]);
  });

  it('keeps provider-supplied catch-up metadata from a get.php fallback', async () => {
    liveStreamsBody = '<html>nope</html>';
    playlistBody = XT.replace(
      'tvg-id="epg-a"',
      'tvg-id="epg-a" catchup="default" catchup-days="3" catchup-source="http://host/archive/{utc}"',
    );
    const channels = await PlaylistService.refresh();
    expect(channels[0]).toMatchObject({
      catchup: 'default',
      catchupDays: 3,
      catchupSource: 'http://host/archive/{utc}',
    });
  });

  it('keeps one tab for the account even when its feed is unreachable', async () => {
    fetchTextMock.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await PlaylistService.refresh();
    expect(PlaylistService.playlistTabs).toEqual([{ id: 'x', name: 'Acct' }]);
  });
});

describe('PlaylistService.refresh (Xtream Live categories)', () => {
  const XT = `#EXTM3U
#EXTINF:-1 group-title="News",Alpha
http://host:8080/live/u1/p1/101.ts
#EXTINF:-1 group-title="Sports",Bravo
http://host:8080/live/u1/p1/102.ts`;
  let liveStreams: Array<Record<string, unknown>>;
  let liveStreamsBody: string | null;
  let categoriesBody: string;

  function account(liveCategories?: { mode: 'include' | 'exclude'; ids: string[] }) {
    storageMock.getPlaylists.mockReturnValue([
      { id: 'x', name: 'Acct', url: 'http://host:8080', source: 'xtream',
        xtream: { username: 'u1', password: 'p1', ...(liveCategories ? { liveCategories } : {}) } },
    ]);
  }

  beforeEach(() => {
    storageMock.liveCategorySnapshots.clear();
    PlaylistService.takeLiveCategoryNotices();
    liveStreams = [
      { stream_id: 101, name: 'Alpha', category_id: 'c1', tv_archive: 1, tv_archive_duration: 2 },
      { stream_id: 102, name: 'Bravo', category_id: 'c2', tv_archive: 1, tv_archive_duration: 3 },
    ];
    liveStreamsBody = null;
    categoriesBody = JSON.stringify([
      { category_id: 'c1', category_name: '  NEWS ' },
      { category_id: 'c2', category_name: 'Sports' },
    ]);
    account();
    fetchTextMock.mockImplementation((url: string) => {
      if (url.includes('action=get_live_streams')) {
        return Promise.resolve(liveStreamsBody ?? JSON.stringify(liveStreams));
      }
      if (url.includes('action=get_live_categories')) return Promise.resolve(categoriesBody);
      if (url.includes('player_api.php')) {
        return Promise.resolve(JSON.stringify({ server_info: { timezone: 'UTC' } }));
      }
      return Promise.resolve(XT);
    });
  });

  it('loads every Live channel without a filter', async () => {
    const channels = await PlaylistService.refresh();
    expect(channels.map(channel => channel.name)).toEqual(['Alpha', 'Bravo']);
    expect(vi.mocked(fetchAndParseM3U)).not.toHaveBeenCalled();
  });

  it('keeps only included categories and their catch-up', async () => {
    account({ mode: 'include', ids: ['c1'] });

    const channels = await PlaylistService.refresh();

    expect(channels.map(channel => channel.name)).toEqual(['Alpha']);
    expect(channels[0]).toMatchObject({
      group: '  NEWS ',
      catchup: 'xtream',
      catchupStreamId: '101',
      catchupDays: 2,
    });
  });

  it('drops excluded categories but keeps a stream listed in another category', async () => {
    liveStreams[0].category_ids = ['c1', 'c3'];
    liveStreams.push({ stream_id: 103, name: 'Charlie', category_id: 'c2', tv_archive: 0 });
    account({ mode: 'exclude', ids: ['c2', 'c1'] });

    const channels = await PlaylistService.refresh();

    // 101 sits in c3 too, so it survives excluding c1 and c2.
    expect(channels.map(channel => channel.name)).toEqual(['Alpha']);
  });

  it('ignores a malformed filter and loads everything', async () => {
    account({ mode: 'include', ids: [] });
    const channels = await PlaylistService.refresh();
    expect(channels.map(channel => channel.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('filters get.php by category name when the Live catalog is unavailable', async () => {
    liveStreamsBody = '<html>nope</html>';
    account({ mode: 'include', ids: ['c1'] });

    const channels = await PlaylistService.refresh();

    expect(vi.mocked(fetchAndParseM3U).mock.calls[0][2]).toBeUndefined();
    expect(vi.mocked(fetchAndParseM3U).mock.calls[0][5])
      .toEqual({ mode: 'include', names: ['news'] });
    expect(channels.map(channel => channel.name)).toEqual(['Alpha']);
  });

  it('loads no channels by name when every included category was removed', async () => {
    liveStreamsBody = '<html>nope</html>';
    account({ mode: 'include', ids: ['c9'] });

    const channels = await PlaylistService.refresh();

    expect(vi.mocked(fetchAndParseM3U).mock.calls[0][5]).toEqual({ mode: 'include', names: [] });
    expect(channels).toEqual([]);
  });

  it('applies an exclude filter by category name when the Live catalog is unavailable', async () => {
    liveStreamsBody = '<html>nope</html>';
    account({ mode: 'exclude', ids: ['c1'] });

    const channels = await PlaylistService.refresh();

    expect(vi.mocked(fetchAndParseM3U).mock.calls[0][5])
      .toEqual({ mode: 'exclude', names: ['news'] });
    expect(channels.map(channel => channel.name)).toEqual(['Bravo']);
  });

  it('loads unfiltered when neither the catalog nor the categories load', async () => {
    liveStreamsBody = '<html>nope</html>';
    categoriesBody = '<html>nope</html>';
    account({ mode: 'include', ids: ['c1'] });

    const channels = await PlaylistService.refresh();

    expect(vi.mocked(fetchAndParseM3U).mock.calls[0][5]).toBeUndefined();
    expect(channels.map(channel => channel.name)).toEqual(['Alpha', 'Bravo']);
    expect(storageMock.setLiveCategorySnapshot).not.toHaveBeenCalled();
  });

  it('announces new categories while filtering by category name', async () => {
    liveStreamsBody = '<html>nope</html>';
    categoriesBody = JSON.stringify([
      { category_id: 'c1', category_name: 'News' },
      { category_id: 'c2', category_name: 'Sports' },
      { category_id: 'c3', category_name: 'Movies' },
    ]);
    account({ mode: 'include', ids: ['c1'] });
    storageMock.liveCategorySnapshots.set('x', {
      knownIds: ['c1', 'c2'],
      announcedIds: [],
      counts: { c1: 1, c2: 1 },
    });

    await PlaylistService.refresh();

    expect(PlaylistService.takeLiveCategoryNotices()).toEqual([
      { playlistId: 'x', accountName: 'Acct', count: 1 },
    ]);
    expect(storageMock.liveCategorySnapshots.get('x')).toEqual({
      knownIds: ['c1', 'c2'],
      announcedIds: ['c3'],
      counts: { c1: 1, c2: 1 },
    });
  });

  it('seeds a snapshot on first load and announces each new category set once', async () => {
    account({ mode: 'include', ids: ['c1'] });

    await PlaylistService.refresh();
    expect(PlaylistService.hasLiveCategoryNotices()).toBe(false);
    expect(storageMock.liveCategorySnapshots.get('x')).toEqual({
      knownIds: ['c1', 'c2'],
      announcedIds: [],
      counts: { c1: 1, c2: 1 },
    });

    liveStreams.push(
      { stream_id: 103, category_id: 'c3', tv_archive: 0 },
      { stream_id: 104, category_id: 'c4', tv_archive: 0 },
      { stream_id: 105, category_id: 'c4', tv_archive: 0 },
    );
    await PlaylistService.refresh();
    expect(PlaylistService.hasLiveCategoryNotices()).toBe(true);
    expect(PlaylistService.takeLiveCategoryNotices()).toEqual([
      { playlistId: 'x', accountName: 'Acct', count: 2 },
    ]);
    expect(PlaylistService.hasLiveCategoryNotices()).toBe(false);
    expect(storageMock.liveCategorySnapshots.get('x')).toMatchObject({
      knownIds: ['c1', 'c2'],
      announcedIds: ['c3', 'c4'],
      counts: { c1: 1, c2: 1, c3: 1, c4: 2 },
    });

    await PlaylistService.refresh();
    expect(PlaylistService.takeLiveCategoryNotices()).toEqual([]);
  });

  it('announces only the categories added since the last notice', async () => {
    account({ mode: 'include', ids: ['c1'] });
    storageMock.liveCategorySnapshots.set('x', {
      knownIds: ['c1', 'c2'],
      announcedIds: ['c3'],
      counts: { c1: 1, c2: 1 },
    });
    liveStreams.push(
      { stream_id: 103, category_id: 'c3', tv_archive: 0 },
      { stream_id: 104, category_id: 'c4', tv_archive: 0 },
    );

    await PlaylistService.refresh();

    expect(PlaylistService.takeLiveCategoryNotices()).toEqual([
      { playlistId: 'x', accountName: 'Acct', count: 1 },
    ]);
  });

  it('does not re-announce a category that briefly disappeared', async () => {
    account({ mode: 'include', ids: ['c1'] });
    storageMock.liveCategorySnapshots.set('x', {
      knownIds: ['c1', 'c2'],
      announcedIds: [],
      counts: { c1: 1, c2: 1 },
    });
    liveStreams.push({ stream_id: 103, category_id: 'c3', tv_archive: 0 });
    await PlaylistService.refresh();
    expect(PlaylistService.takeLiveCategoryNotices()).toHaveLength(1);

    liveStreams.pop();
    await PlaylistService.refresh();
    expect(storageMock.liveCategorySnapshots.get('x')).toMatchObject({ announcedIds: ['c3'] });

    liveStreams.push({ stream_id: 103, category_id: 'c3', tv_archive: 0 });
    await PlaylistService.refresh();
    expect(PlaylistService.takeLiveCategoryNotices()).toEqual([]);
  });

  it('drops a queued notice once its account is removed, re-filtered, or reviewed', async () => {
    const queue = async () => {
      account({ mode: 'include', ids: ['c1'] });
      storageMock.liveCategorySnapshots.set('x', { knownIds: ['c1', 'c2'], announcedIds: [], counts: {} });
      await PlaylistService.refresh();
    };
    liveStreams.push({ stream_id: 103, category_id: 'c3', tv_archive: 0 });

    await queue();
    storageMock.getPlaylists.mockReturnValue([]);
    expect(PlaylistService.hasLiveCategoryNotices()).toBe(false);
    expect(PlaylistService.takeLiveCategoryNotices()).toEqual([]);

    await queue();
    account({ mode: 'exclude', ids: ['c2'] });
    expect(PlaylistService.takeLiveCategoryNotices()).toEqual([]);

    await queue();
    storageMock.liveCategorySnapshots.set('x', { knownIds: ['c1', 'c2', 'c3'], announcedIds: [], counts: {} });
    expect(PlaylistService.takeLiveCategoryNotices()).toEqual([]);

    await queue();
    expect(PlaylistService.takeLiveCategoryNotices()).toEqual([
      { playlistId: 'x', accountName: 'Acct', count: 1 },
    ]);
  });

  it('never announces new categories in exclude mode', async () => {
    account({ mode: 'exclude', ids: ['c2'] });
    storageMock.liveCategorySnapshots.set('x', {
      knownIds: ['c1', 'c2'],
      announcedIds: [],
      counts: { c1: 1, c2: 1 },
    });
    liveStreams.push({ stream_id: 103, category_id: 'c3', tv_archive: 0 });

    await PlaylistService.refresh();

    expect(PlaylistService.hasLiveCategoryNotices()).toBe(false);
    expect(storageMock.liveCategorySnapshots.get('x')).toMatchObject({
      announcedIds: [],
      counts: { c1: 1, c2: 1, c3: 1 },
    });
  });

  it('does not rewrite an unchanged snapshot', async () => {
    account({ mode: 'include', ids: ['c1'] });
    await PlaylistService.refresh();
    storageMock.setLiveCategorySnapshot.mockClear();

    await PlaylistService.refresh();

    expect(storageMock.setLiveCategorySnapshot).not.toHaveBeenCalled();
  });
});
describe('PlaylistService.load', () => {
  it('uses the cached playlist without hitting the network', async () => {
    const cached = [channel({ id: 'a', name: 'Alpha', group: 'News', playlistIds: ['P1'] })];
    const epgSources = [{ url: 'http://e', playlistIds: ['P1'], kind: 'm3u' }];
    storageMock.getPlaylists.mockReturnValue([
      { id: 'P1', name: 'P1', url: 'http://host/p1.m3u' },
    ]);
    cacheMock.getCachedPlaylist.mockResolvedValue({ channels: cached, epgSources });
    const result = await PlaylistService.load();
    expect(result).toEqual(cached);
    expect(PlaylistService.allChannels).toBe(cached);
    expect(PlaylistService.groups).toEqual(['News']);
    expect(PlaylistService.epgSources).toEqual(epgSources);
    expect(fetchTextMock).not.toHaveBeenCalled();
  });

  it('boots from an expired cache and exposes its age for the overdue refresh', async () => {
    const intervalMs = 6 * 60 * 60 * 1000;
    const timestamp = Date.now() - 2 * intervalMs;
    const cached = [channel({ id: 'a', name: 'Alpha', group: 'News', playlistIds: ['P1'] })];
    storageMock.getPlaylists.mockReturnValue([
      { id: 'P1', name: 'P1', url: 'http://host/p1.m3u' },
    ]);
    cacheMock.getCachedPlaylist.mockImplementation(async (maxAgeMs: number | null) =>
      maxAgeMs === null || Date.now() - timestamp < maxAgeMs
        ? { channels: cached, epgSources: [], timestamp }
        : null);

    expect(await PlaylistService.load()).toEqual(cached);
    expect(fetchTextMock).not.toHaveBeenCalled();
    expect(PlaylistService.getNextRefreshDelayMs(intervalMs)).toBe(0);
  });

  it('refreshes from the network on a cache miss', async () => {
    cacheMock.getCachedPlaylist.mockResolvedValue(null);
    storageMock.getPlaylists.mockReturnValue([{ name: 'P2', url: 'http://host2/p2.m3u' }]);
    fetchTextMock.mockResolvedValue(P2);
    const result = await PlaylistService.load();
    expect(result.map(c => c.name)).toEqual(['Bravo Dup', 'Charlie']);
    expect(fetchTextMock).toHaveBeenCalled();
  });

  it('does not infer cached channel types from their URLs', async () => {
    const cached = [
      channel({
        name: 'Alpha',
        url: 'http://host/movie/u1/p1/201.mp4',
        group: 'Group 1',
        playlistIds: ['x'],
      }),
      channel({
        name: 'Bravo',
        url: 'http://host/SeRiEs/u1/p1/301.mkv',
        group: 'Group 1',
        playlistIds: ['x', 'm'],
      }),
      channel({
        name: 'Charlie',
        url: 'http://host/live/u1/p1/101.ts',
        group: 'Group 1',
        playlistIds: ['x'],
      }),
    ];
    storageMock.getPlaylists.mockReturnValue([
      { id: 'x', name: 'Acct', url: 'http://host', source: 'xtream',
        xtream: { username: 'u1', password: 'p1' } },
      { id: 'm', name: 'M3U', url: 'http://host/list.m3u', source: 'url' },
    ]);
    cacheMock.getCachedPlaylist.mockResolvedValue({ channels: cached, epgSources: [] });

    const result = await PlaylistService.load();

    expect(result.map(channel => channel.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(result[1].playlistIds).toEqual(['x', 'm']);
    expect(fetchTextMock).not.toHaveBeenCalled();
  });
});

describe('PlaylistService.indexOf', () => {
  beforeEach(() => {
    storageMock.getPlaylists.mockReturnValue([
      { name: 'P1', url: 'http://host1/p1.m3u' },
      { name: 'P2', url: 'http://host2/p2.m3u' },
    ]);
    fetchTextMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes('p1') ? P1 : P2),
    );
  });

  it('maps each channel to its global index after load', async () => {
    await PlaylistService.refresh();
    PlaylistService.channels.forEach((ch, i) =>
      expect(PlaylistService.indexOf(ch)).toBe(i));
  });

  it('returns -1 for a channel not in the list', async () => {
    await PlaylistService.refresh();
    expect(PlaylistService.indexOf(channel({ name: 'Ghost' }))).toBe(-1);
  });

  it('stays in sync after a re-load (no stale indices)', async () => {
    await PlaylistService.refresh();
    storageMock.getPlaylists.mockReturnValue([{ name: 'P2', url: 'http://host2/p2.m3u' }]);
    await PlaylistService.refresh();
    expect(PlaylistService.channels.map(c => PlaylistService.indexOf(c)))
      .toEqual(PlaylistService.channels.map((_, i) => i));
  });

  it('returns -1 after reset()', async () => {
    await PlaylistService.refresh();
    const first = PlaylistService.channels[0];
    PlaylistService.reset();
    expect(PlaylistService.indexOf(first)).toBe(-1);
  });
});

describe('PlaylistService.getByGroup', () => {
  beforeEach(() => {
    PlaylistService.channels = [
      channel({ id: 'a', name: 'Alpha', group: 'News', playlistIds: ['P1'], url: 'http://host/a' }),
      channel({ id: 'b', name: 'Bravo', group: 'Sports', playlistIds: ['P1'], url: 'http://host/b' }),
      channel({ id: 'c', name: 'Charlie', group: 'News', playlistIds: ['P2'], url: 'http://host/c' }),
    ];
  });

  it('returns everything for "All"', () => {
    expect(PlaylistService.getByGroup('builtin:all').map(c => c.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('filters by group', () => {
    expect(PlaylistService.getByGroup('source:News').map(c => c.name)).toEqual(['Alpha', 'Charlie']);
  });

  it('keeps a provider group named Favorites separate from the built-in filter', () => {
    PlaylistService.channels[0].group = 'Favorites';
    storageMock.getFavorites.mockReturnValue([channelKey(PlaylistService.channels[1])]);
    expect(PlaylistService.getByGroup('source:Favorites').map(c => c.name)).toEqual(['Alpha']);
    expect(PlaylistService.getByGroup('builtin:favorites').map(c => c.name)).toEqual(['Bravo']);
  });

  it('filters by playlist when provided', () => {
    expect(PlaylistService.getByGroup('builtin:all', 'P1').map(c => c.name)).toEqual(['Alpha', 'Bravo']);
    expect(PlaylistService.getByGroup('source:News', 'P2').map(c => c.name)).toEqual(['Charlie']);
  });

  it('resolves "Favorites" against StorageService, keyed by channelKey', () => {
    storageMock.getFavorites.mockReturnValue([channelKey(PlaylistService.channels[1])]);
    expect(PlaylistService.getByGroup('builtin:favorites').map(c => c.name)).toEqual(['Bravo']);
  });

  it('keeps query-identified streams separate in Favorites', () => {
    const first = channel({ name: 'Alpha', url: 'http://host/a?id=1' });
    const second = channel({ name: 'Bravo', url: 'http://host/a?id=2' });
    PlaylistService.channels = [first, second];
    storageMock.getFavorites.mockReturnValue([channelKey(first)]);

    expect(PlaylistService.getByGroup('builtin:favorites').map(c => c.name)).toEqual(['Alpha']);
  });
});

function localSearchResults(query: string, playlist?: string): Channel[] {
  return PlaylistService.searchLocalRanked(
    query,
    PlaylistService.channels.length,
    playlist,
  ).items;
}

describe('PlaylistService.searchLocalRanked', () => {
  beforeEach(() => {
    PlaylistService.channels = [
      channel({ name: 'Alpha', group: 'News', playlistIds: ['P1'] }),
      channel({ name: 'Bravo', group: 'Sports', playlistIds: ['P1'] }),
      channel({ name: 'Charlie', group: 'News', playlistIds: ['P2'] }),
    ];
  });

  it('matches channel names case-insensitively, spanning all groups/playlists', () => {
    expect(localSearchResults('A').map(c => c.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(localSearchResults('char').map(c => c.name)).toEqual(['Charlie']);
  });

  it('builds the local fallback index only when search is used', () => {
    const internals = PlaylistService as unknown as {
      channelSearchIndex: unknown[];
    };
    PlaylistService.getByGroup('builtin:all');
    expect(internals.channelSearchIndex).toHaveLength(0);

    localSearchResults('alpha');
    expect(internals.channelSearchIndex).toHaveLength(3);
  });

  it('scopes results to a single playlist when one is given', () => {
    expect(localSearchResults('a', 'P1').map(c => c.name)).toEqual(['Alpha', 'Bravo']);
    expect(localSearchResults('a', 'P2').map(c => c.name)).toEqual(['Charlie']);
  });

  it('returns no results for an empty or whitespace query', () => {
    expect(localSearchResults('')).toEqual([]);
    expect(localSearchResults('   ')).toEqual([]);
  });

  it('matches channel genres through natural-language-lite synonyms', () => {
    expect(localSearchResults('footy').map(c => c.name)).toEqual(['Bravo']);
    expect(localSearchResults('headlines').map(c => c.name)).toEqual(['Alpha', 'Charlie']);
  });
});

describe('PlaylistService.getGroupsForPlaylist', () => {
  beforeEach(() => {
    PlaylistService.channels = [
      channel({ name: 'Alpha', group: 'News', playlistIds: ['P1'] }),
      channel({ name: 'Bravo', group: 'Sports', playlistIds: ['P1'] }),
      channel({ name: 'Charlie', group: 'Movies', playlistIds: ['P2'] }),
    ];
  });

  it('returns the distinct groups within a playlist', () => {
    expect(PlaylistService.getGroupsForPlaylist('P1')).toEqual(['News', 'Sports']);
  });

  it('returns all groups when no playlist is given', () => {
    expect(PlaylistService.getGroupsForPlaylist()).toEqual(['News', 'Sports', 'Movies']);
  });

  it('serves group counts from the derived index without rescanning channels', () => {
    let groupReads = 0;
    let urlReads = 0;
    PlaylistService.channels = Array.from({ length: 5000 }, (_, index) => {
      const item = channel({
        name: `ch${index}`,
        playlistIds: [`P${index % 2}`],
      });
      Object.defineProperty(item, 'group', {
        configurable: true,
        get: () => {
          groupReads++;
          return `Group ${index}`;
        },
      });
      Object.defineProperty(item, 'url', {
        configurable: true,
        get: () => {
          urlReads++;
          return `http://host/${index}`;
        },
      });
      return item;
    });

    const groups = PlaylistService.getGroupsForPlaylist();
    groupReads = 0;
    urlReads = 0;
    for (const group of groups) {
      expect(PlaylistService.getGroupCount(`source:${group}`)).toBe(1);
    }

    expect(groupReads).toBe(0);
    expect(PlaylistService.getGroupCount('builtin:favorites')).toBe(0);
    expect(urlReads).toBe(0);
    expect(PlaylistService.getGroupCount('builtin:all', 'P1')).toBe(2500);
  });
});

describe('PlaylistService.reset', () => {
  it('clears channels, groups, playlistTabs and epgSources', async () => {
    storageMock.getPlaylists.mockReturnValue([
      { id: 'a', name: 'P1', url: 'http://host/1.m3u' },
    ]);
    fetchTextMock.mockResolvedValueOnce(P1);
    await PlaylistService.refresh();
    expect(PlaylistService.channels.length).toBeGreaterThan(0);
    expect(PlaylistService.groups.length).toBeGreaterThan(0);
    expect(PlaylistService.playlistTabs).toEqual([{ id: 'a', name: 'P1' }]);
    expect(PlaylistService.epgSources.length).toBeGreaterThan(0);

    PlaylistService.reset();

    expect(PlaylistService.channels).toEqual([]);
    expect(PlaylistService.groups).toEqual([]);
    expect(PlaylistService.playlistTabs).toEqual([]);
    expect(PlaylistService.epgSources).toEqual([]);
  });
});

describe('PlaylistService.searchLocalRanked', () => {
  beforeEach(() => {
    PlaylistService.channels = [
      channel({ id: '1', name: 'Alpha', playlistIds: ['a'] }),
      channel({ id: '2', name: 'XAlpha', playlistIds: ['a'] }),
      channel({ id: '3', name: 'Alpha HD', playlistIds: ['b'] }),
    ];
  });

  it('returns [] for a blank query', () => {
    expect(localSearchResults('  ')).toEqual([]);
  });

  it('ranks exact and prefix matches above a mid-word match', () => {
    expect(localSearchResults('alpha').map(c => c.name)).toEqual(['Alpha', 'Alpha HD', 'XAlpha']);
  });

  it('scopes to a single playlist when given', () => {
    expect(localSearchResults('alpha', 'b').map(c => c.name)).toEqual(['Alpha HD']);
  });
});

describe('PlaylistService customization', () => {
  const KEY_A = channelKey({ url: 'http://stream/u1' } as Channel);
  const KEY_B = channelKey({ url: 'http://stream/u2' } as Channel);

  function record(over: Partial<ChannelCustomization> = {}): ChannelCustomization {
    return {
      version: CONFIG.CHANNEL_CUSTOMIZATION_VERSION,
      overrides: {}, order: [], groupOrder: [], groupOverrides: {}, customGroups: [], ...over,
    };
  }

  function useRecord(data: ChannelCustomization | null): void {
    storageMock.getChannelCustomization.mockReturnValue(data);
    ChannelCustomizationService.reload();
  }

  beforeEach(() => {
    storageMock.getPlaylists.mockReturnValue([{ id: 'a', name: 'P1', url: 'http://host1/p1.m3u' }]);
    fetchTextMock.mockResolvedValue(P1);
    useRecord(null);
  });

  it('keeps the raw parse on allChannels and the customized view on channels', async () => {
    useRecord(record({ overrides: { [KEY_B]: { hidden: true } }, order: [KEY_B, KEY_A] }));
    await PlaylistService.refresh();

    expect(PlaylistService.allChannels.map(c => c.name)).toEqual(['Alpha', 'Bravo']);
    expect(PlaylistService.channels.map(c => c.name)).toEqual(['Alpha']);
    // The raw parse is cached, so an edit never forces a re-fetch.
    expect(cacheMock.scheduleCachedPlaylist).toHaveBeenCalledWith(
      PlaylistService.allChannels,
      PlaylistService.epgSources,
      expect.any(Number),
      6 * 60 * 60 * 1000,
      { signature: 's1', generation: 0 },
    );
  });

  it('re-derives indices after an edit so index-based consumers follow', async () => {
    await PlaylistService.refresh();
    expect(PlaylistService.indexOf(PlaylistService.channels[0])).toBe(0);

    useRecord(record({ order: [KEY_B, KEY_A] }));
    PlaylistService.applyCustomization();

    expect(PlaylistService.channels.map(c => c.name)).toEqual(['Bravo', 'Alpha']);
    expect(PlaylistService.indexOfKey(KEY_A)).toBe(1);
    expect(PlaylistService.indexOfKey(KEY_B)).toBe(0);
    expect(PlaylistService.indexOfKey('missing')).toBe(-1);
    expect(PlaylistService.getByIndex(0)?.name).toBe('Bravo');
  });

  it('keeps empty custom groups in global navigation only', async () => {
    useRecord(record({ customGroups: ['Empty'] }));
    await PlaylistService.refresh();

    expect(PlaylistService.groups).toContain('Empty');
    expect(PlaylistService.getGroupsForPlaylist()).toContain('Empty');
    expect(PlaylistService.getGroupsForPlaylist('a')).not.toContain('Empty');
  });

  it('reveals hidden channels while edit mode asks for them', async () => {
    useRecord(record({ overrides: { [KEY_B]: { hidden: true } } }));
    await PlaylistService.refresh();
    expect(PlaylistService.channels.map(c => c.name)).toEqual(['Alpha']);

    PlaylistService.setIncludeHidden(true);
    expect(PlaylistService.channels.map(c => c.name)).toEqual(['Alpha', 'Bravo']);
    PlaylistService.setIncludeHidden(false);
    expect(PlaylistService.channels.map(c => c.name)).toEqual(['Alpha']);
  });

  it('reveals hidden channels when the show-hidden setting is on', async () => {
    useRecord(record({ overrides: { [KEY_B]: { hidden: true } } }));
    storageMock.getShowHiddenChannels.mockReturnValue(true);
    try {
      await PlaylistService.refresh();
      expect(PlaylistService.channels.map(c => c.name)).toEqual(['Alpha', 'Bravo']);
    } finally {
      storageMock.getShowHiddenChannels.mockReturnValue(false);
    }
  });

  it('keeps the EPG channel set stable while hidden channels are revealed', async () => {
    useRecord(record({ overrides: { [KEY_B]: { hidden: true } } }));
    await PlaylistService.refresh();
    expect(PlaylistService.getEpgEligibleChannels().map(c => c.name)).toEqual(['Alpha']);

    // A widened selection would force an EPG refetch, so neither toggle may
    // widen it: both only reveal hidden channels for editing.
    PlaylistService.setIncludeHidden(true);
    expect(PlaylistService.channels.map(c => c.name)).toEqual(['Alpha', 'Bravo']);
    expect(PlaylistService.getEpgEligibleChannels().map(c => c.name)).toEqual(['Alpha']);
    PlaylistService.setIncludeHidden(false);

    storageMock.getShowHiddenChannels.mockReturnValue(true);
    try {
      PlaylistService.applyCustomization();
      expect(PlaylistService.channels.map(c => c.name)).toEqual(['Alpha', 'Bravo']);
      expect(PlaylistService.getEpgEligibleChannels().map(c => c.name)).toEqual(['Alpha']);
    } finally {
      storageMock.getShowHiddenChannels.mockReturnValue(false);
      PlaylistService.applyCustomization();
    }
  });

  it('drops concealed channels from every list but keeps them in the EPG set', async () => {
    useRecord(record({}));
    await PlaylistService.refresh();
    const concealing = vi.spyOn(ParentalControlService, 'concealing', 'get')
      .mockReturnValue(true);
    const concealed = vi.spyOn(ParentalControlService, 'isConcealed')
      .mockImplementation(request => request.target.kind === 'live-channel'
        && request.target.channelKey === KEY_B);
    try {
      PlaylistService.applyCustomization();
      expect(PlaylistService.channels.map(c => c.name)).toEqual(['Alpha']);
      expect(PlaylistService.indexOfKey(KEY_B)).toBe(-1);
      expect(PlaylistService.getEpgEligibleChannels().map(c => c.name))
        .toEqual(['Alpha', 'Bravo']);
    } finally {
      concealing.mockRestore();
      concealed.mockRestore();
      PlaylistService.applyCustomization();
    }
    expect(PlaylistService.channels.map(c => c.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('maps visible channels to their playlist-cache record', async () => {
    useRecord(record({ order: [KEY_B, KEY_A] }));
    await PlaylistService.refresh();
    expect(PlaylistService.getChannelCacheSource()).toBeNull();

    const ref = { store: 'playlist-cache', key: 'k', timestamp: 1 };
    cacheMock.cacheRecordRef.mockImplementation(value =>
      value === PlaylistService.allChannels ? ref : null);
    const concealing = vi.spyOn(ParentalControlService, 'concealing', 'get')
      .mockReturnValue(true);
    const concealed = vi.spyOn(ParentalControlService, 'isConcealed')
      .mockImplementation(request => request.target.kind === 'live-channel'
        && request.target.channelKey === KEY_A);
    try {
      PlaylistService.applyCustomization();
      expect(PlaylistService.getChannelCacheSource()).toEqual({
        record: ref,
        length: 2,
        selection: new Uint32Array([1]),
      });
      concealing.mockReturnValue(false);
      PlaylistService.applyCustomization();
      expect(PlaylistService.getChannelCacheSource()?.selection)
        .toEqual(new Uint32Array([1, 0]));
    } finally {
      concealing.mockRestore();
      concealed.mockRestore();
      cacheMock.cacheRecordRef.mockReset();
      cacheMock.cacheRecordRef.mockReturnValue(null);
      PlaylistService.applyCustomization();
    }
  });

  it('applies renames and group assignments and orders the groups', async () => {
    useRecord(record({
      overrides: { [KEY_A]: { name: 'Alpha Two', group: 'Custom' } },
      groupOrder: [UNCATEGORIZED_GROUP, 'Custom'],
      customGroups: ['Custom'],
    }));
    await PlaylistService.refresh();

    const alpha = PlaylistService.channels[0];
    expect(alpha.name).toBe('Alpha Two');
    expect(alpha.sourceName).toBe('Alpha');
    expect(alpha.group).toBe('Custom');
    expect(alpha.sourceGroup).toBe('News');
    expect(PlaylistService.groups).toEqual([UNCATEGORIZED_GROUP, 'Custom']);
    expect(PlaylistService.getGroupsForPlaylist('a')).toEqual([UNCATEGORIZED_GROUP, 'Custom']);
  });

  it('applies customization to a cached playlist without a fetch', async () => {
    const cached = [
      channel({ name: 'Alpha', url: 'http://stream/u1', group: 'News', playlistIds: ['a'] }),
      channel({ name: 'Bravo', url: 'http://stream/u2', group: 'News', playlistIds: ['a'] }),
    ];
    cacheMock.getCachedPlaylist.mockResolvedValue({ channels: cached, epgSources: [] });
    useRecord(record({ order: [KEY_B, KEY_A] }));

    const result = await PlaylistService.load();
    expect(result.map(c => c.name)).toEqual(['Bravo', 'Alpha']);
    expect(fetchTextMock).not.toHaveBeenCalled();
  });

  it('keeps channels added by a later refresh behind the arranged block', async () => {
    useRecord(record({ order: [KEY_B, KEY_A] }));
    await PlaylistService.refresh();
    expect(PlaylistService.channels.map(c => c.name)).toEqual(['Bravo', 'Alpha']);

    fetchTextMock.mockResolvedValue(`${P1}
#EXTINF:-1 tvg-id="d",Delta
http://stream/u4`);
    await PlaylistService.refresh();
    expect(PlaylistService.channels.map(c => c.name)).toEqual(['Bravo', 'Alpha', 'Delta']);
  });
});
