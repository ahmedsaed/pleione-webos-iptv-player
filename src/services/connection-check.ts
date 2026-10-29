import type { PlaylistEntry } from '../types';
import { createXtreamClient } from './xtream-client';
import { isSourceEnabled } from '../utils/playlist';
import { createLogger } from '../utils/logger';

const log = createLogger('Connection');

export type ConnectionState = 'ok' | 'rejected' | 'unreachable';

// Home loads no channels, so the start screen only asks each enabled Xtream
// account whether it still signs in. An M3U playlist has no check cheaper
// than downloading it, so it waits for Live.
export async function checkConnections(playlists: PlaylistEntry[]): Promise<ConnectionState> {
  const accounts = playlists.filter(p => p.source === 'xtream' && p.xtream && isSourceEnabled(p));
  if (!accounts.length) return 'ok';
  const states = await Promise.all(accounts.map(async (account): Promise<ConnectionState> => {
    try {
      const info = await createXtreamClient({ baseUrl: account.url, ...account.xtream! }, account.id)
        .getAccountInfo();
      return !info ? 'unreachable' : info.auth ? 'ok' : 'rejected';
    } catch {
      return 'unreachable';
    }
  }));
  const failed = states.filter(state => state !== 'ok');
  if (!failed.length) return 'ok';
  const state = failed.indexOf('unreachable') >= 0 ? 'unreachable' : 'rejected';
  log.warn('Startup connection check failed', 'event=startup.connection.failed',
    `reason=${state}`, `failed=${String(failed.length)}`, `accounts=${String(accounts.length)}`);
  return state;
}
