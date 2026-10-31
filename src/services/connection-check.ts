import type { PlaylistEntry } from '../types';
import { createXtreamClient } from './xtream-client';
import { isSourceEnabled } from '../utils/playlist';
import { createLogger } from '../utils/logger';

const log = createLogger('Connection');

export type ConnectionState = 'ok' | 'rejected' | 'unreachable';

// The account that failed the check, and how; an unreachable server names
// the account before a rejected sign-in does.
export interface ConnectionIssue {
  state: Exclude<ConnectionState, 'ok'>;
  accountId: string;
  accountName: string;
}

// Home loads no channels, so the start screen only asks each enabled Xtream
// account whether it still signs in. An M3U playlist has no check cheaper
// than downloading it, so it waits for Live.
export async function checkConnections(playlists: PlaylistEntry[]): Promise<ConnectionIssue | null> {
  const accounts = playlists.filter(p => p.source === 'xtream' && p.xtream && isSourceEnabled(p));
  if (!accounts.length) return null;
  const states = await Promise.all(accounts.map(async (account): Promise<ConnectionState> => {
    try {
      const info = await createXtreamClient({ baseUrl: account.url, ...account.xtream! }, account.id)
        .getAccountInfo(undefined, { retryTimeouts: false });
      return !info ? 'unreachable' : info.auth ? 'ok' : 'rejected';
    } catch {
      return 'unreachable';
    }
  }));
  const failed = states.filter(state => state !== 'ok');
  if (!failed.length) return null;
  const state = failed.indexOf('unreachable') >= 0 ? 'unreachable' : 'rejected';
  log.warn('Startup connection check failed', 'event=startup.connection.failed',
    `reason=${state}`, `failed=${String(failed.length)}`, `accounts=${String(accounts.length)}`);
  const account = accounts[states.indexOf(state)];
  return { state, accountId: account.id, accountName: account.name };
}

export type ConnectionListener = (issue: ConnectionIssue | null, checking: boolean) => void;

// The startup check behind Home's banner: a failure shows it, Try again runs
// the check again with the banner kept up, and a pass clears it. Only the
// latest run reports.
export class StartupConnection {
  private run = 0;
  private current: ConnectionIssue | null = null;

  constructor(
    private readonly playlists: () => PlaylistEntry[],
    private readonly listener: ConnectionListener,
    private readonly check: typeof checkConnections = checkConnections,
  ) {}

  get issue(): ConnectionIssue | null { return this.current; }

  async verify(): Promise<void> {
    const run = ++this.run;
    if (this.current) this.listener(this.current, true);
    const issue = await this.check(this.playlists());
    if (run !== this.run) return;
    this.current = issue;
    this.listener(issue, false);
  }

  // No account to check: the banner goes, and a pending check is dropped.
  clear(): void {
    this.run++;
    if (!this.current) return;
    this.current = null;
    this.listener(null, false);
  }
}
