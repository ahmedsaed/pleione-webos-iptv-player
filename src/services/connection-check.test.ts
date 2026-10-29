import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PlaylistEntry } from '../types';

const { fetchTextMock } = vi.hoisted(() => ({ fetchTextMock: vi.fn() }));
vi.mock('../utils/fetch-helper', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/fetch-helper')>(),
  fetchLimitedText: fetchTextMock,
}));

import { checkConnections } from './connection-check';

const xtream = (id: string, extra: Partial<PlaylistEntry> = {}): PlaylistEntry => ({
  id, name: id, url: `http://host/${id}`, source: 'xtream',
  xtream: { username: 'u1', password: 'p1' }, ...extra,
});
const m3u: PlaylistEntry = { id: 'm1', name: 'm1', url: 'http://host/a.m3u' };

beforeEach(() => fetchTextMock.mockReset());

describe('checkConnections', () => {
  it('makes exactly one sign-in request per Xtream account and none for M3U', async () => {
    fetchTextMock.mockResolvedValue(JSON.stringify({ user_info: { auth: 1 } }));
    expect(await checkConnections([m3u, xtream('x1')])).toBe('ok');
    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(fetchTextMock.mock.calls[0][0]).toBe('http://host/x1/player_api.php?username=u1&password=p1');
  });

  it('skips turned-off accounts and asks nothing of an M3U-only setup', async () => {
    expect(await checkConnections([m3u, xtream('x1', { enabled: false })])).toBe('ok');
    expect(fetchTextMock).not.toHaveBeenCalled();
  });

  it('reports rejected credentials', async () => {
    fetchTextMock.mockResolvedValue(JSON.stringify({ user_info: { auth: 0 } }));
    expect(await checkConnections([xtream('x1')])).toBe('rejected');
  });

  it('reports an unreachable server before a rejection, once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchTextMock
      .mockResolvedValueOnce(JSON.stringify({ user_info: { auth: 0 } }))
      .mockRejectedValueOnce(new Error('offline'));
    expect(await checkConnections([xtream('x1'), xtream('x2')])).toBe('unreachable');
    const events = warn.mock.calls.map(args => args.join(' '))
      .filter(line => line.includes('event=startup.connection.failed'));
    expect(events).toEqual([expect.stringContaining('reason=unreachable failed=2 accounts=2')]);
    warn.mockRestore();
  });
});
