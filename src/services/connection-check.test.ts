import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PlaylistEntry } from '../types';

const { fetchTextMock } = vi.hoisted(() => ({ fetchTextMock: vi.fn() }));
vi.mock('../utils/fetch-helper', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/fetch-helper')>(),
  fetchLimitedText: fetchTextMock,
}));

import { FetchTextError } from '../utils/fetch-helper';
import { checkConnections, StartupConnection, type ConnectionIssue } from './connection-check';
import { createXtreamClient, resetXtreamSignIns } from './xtream-client';

const xtream = (id: string, extra: Partial<PlaylistEntry> = {}): PlaylistEntry => ({
  id, name: id, url: `http://host/${id}`, source: 'xtream',
  xtream: { username: 'u1', password: 'p1' }, ...extra,
});
const m3u: PlaylistEntry = { id: 'm1', name: 'm1', url: 'http://host/a.m3u' };

beforeEach(() => {
  fetchTextMock.mockReset();
  resetXtreamSignIns();
});

describe('checkConnections', () => {
  it('makes exactly one sign-in request per Xtream account and none for M3U', async () => {
    fetchTextMock.mockResolvedValue(JSON.stringify({ user_info: { auth: 1 } }));
    expect(await checkConnections([m3u, xtream('x1')])).toBeNull();
    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    expect(fetchTextMock.mock.calls[0][0]).toBe('http://host/x1/player_api.php?username=u1&password=p1');
  });

  it('leaves its passed sign-in for the channel load, and asks again after a failure', async () => {
    fetchTextMock.mockResolvedValueOnce(JSON.stringify({ user_info: { auth: 0 } }));
    expect(await checkConnections([xtream('x1')]))
      .toEqual({ state: 'rejected', accountId: 'x1', accountName: 'x1' });
    fetchTextMock.mockResolvedValue(JSON.stringify({ user_info: { auth: 1 } }));
    expect(await checkConnections([xtream('x1')])).toBeNull();
    expect(fetchTextMock).toHaveBeenCalledTimes(2);

    const load = createXtreamClient({ baseUrl: 'http://host/x1', username: 'u1', password: 'p1' });
    expect(await load.getAccountInfo()).toMatchObject({ auth: true });
    expect(fetchTextMock).toHaveBeenCalledTimes(2);
  });

  it('reports a timed-out server without retrying the timeout', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchTextMock.mockRejectedValueOnce(new FetchTextError('timeout', 'Request timed out'));
    expect(await checkConnections([xtream('x1')]))
      .toEqual({ state: 'unreachable', accountId: 'x1', accountName: 'x1' });
    expect(fetchTextMock).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('skips turned-off accounts and asks nothing of an M3U-only setup', async () => {
    expect(await checkConnections([m3u, xtream('x1', { enabled: false })])).toBeNull();
    expect(fetchTextMock).not.toHaveBeenCalled();
  });

  it('reports rejected credentials and names the account', async () => {
    fetchTextMock.mockResolvedValue(JSON.stringify({ user_info: { auth: 0 } }));
    expect(await checkConnections([xtream('x1')]))
      .toEqual({ state: 'rejected', accountId: 'x1', accountName: 'x1' });
  });

  it('reports an unreachable server before a rejection, once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchTextMock
      .mockResolvedValueOnce(JSON.stringify({ user_info: { auth: 0 } }))
      .mockRejectedValueOnce(new Error('offline'));
    expect(await checkConnections([xtream('x1'), xtream('x2')]))
      .toEqual({ state: 'unreachable', accountId: 'x2', accountName: 'x2' });
    const events = warn.mock.calls.map(args => args.join(' '))
      .filter(line => line.includes('event=startup.connection.failed'));
    expect(events).toEqual([expect.stringContaining('reason=unreachable failed=2 accounts=2')]);
    warn.mockRestore();
  });
});

describe('StartupConnection', () => {
  const issue: ConnectionIssue = { state: 'rejected', accountId: 'x1', accountName: 'Alpha' };

  function setup(results: Array<ConnectionIssue | null>) {
    const check = vi.fn(() => Promise.resolve(results.shift() ?? null));
    const listener = vi.fn();
    const connection = new StartupConnection(() => [xtream('x1')], listener, check);
    return { check, listener, connection };
  }

  it('reports nothing while a first check passes', async () => {
    const { listener, connection } = setup([null]);
    await connection.verify();
    expect(listener.mock.calls).toEqual([[null, false]]);
    expect(connection.issue).toBeNull();
  });

  it('shows a failure, keeps it up while Try again checks, and clears it on success', async () => {
    const { check, listener, connection } = setup([issue, null]);
    await connection.verify();
    expect(listener.mock.calls).toEqual([[issue, false]]);
    expect(connection.issue).toBe(issue);
    await connection.verify();
    expect(check).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.slice(1)).toEqual([[issue, true], [null, false]]);
    expect(connection.issue).toBeNull();
  });

  it('keeps the banner when Try again fails again', async () => {
    const { listener, connection } = setup([issue, issue]);
    await connection.verify();
    await connection.verify();
    expect(listener.mock.calls.slice(1)).toEqual([[issue, true], [issue, false]]);
    expect(connection.issue).toBe(issue);
  });

  it('only the latest check reports, and clear drops a pending one', async () => {
    let resolve: (value: ConnectionIssue | null) => void = () => undefined;
    const check = vi.fn(() => new Promise<ConnectionIssue | null>((r) => { resolve = r; }));
    const listener = vi.fn();
    const connection = new StartupConnection(() => [], listener, check);
    const pending = connection.verify();
    connection.clear();
    resolve(issue);
    await pending;
    expect(listener).not.toHaveBeenCalled();
    expect(connection.issue).toBeNull();
  });
});
