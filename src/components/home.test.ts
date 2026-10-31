// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PlaylistEntry } from '../types';

const state = vi.hoisted(() => ({
  channels: 0,
}));

vi.mock('../services/playlist-service', () => ({
  PlaylistService: {
    get channels() { return new Array(state.channels); },
    getByGroup: () => { throw new Error('Home must not read channel lists'); },
  },
}));

import { Home, bentoRows } from './home';
import { Focus } from '../navigation/focus-scope';

const account: PlaylistEntry = {
  id: 'x1', name: 'Alpha', url: 'http://host', source: 'xtream', xtream: { username: 'u', password: 'p' },
};

let container: HTMLElement;
let home: Home;
let handlers: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  Element.prototype.scrollIntoView = () => undefined;
  document.body.innerHTML = '<div id="home"></div>';
  container = document.getElementById('home')!;
  state.channels = 0;
  handlers = {
    onOpenSection: vi.fn(), onPlayNumber: vi.fn(), onSelectAccount: vi.fn(),
    onLockNow: vi.fn(), onBack: vi.fn(),
    onAddSource: vi.fn(), onRetryConnection: vi.fn(), onEditAccount: vi.fn(),
    loadSetupInfo: vi.fn(() => Promise.resolve(null)),
  };
  home = new Home(container, handlers as never);
  Focus.install();
  Focus.setBase(() => home.focusScope);
});

afterEach(() => {
  home.hidden();
  Focus.uninstall();
});

const cards = () => Array.from(container.querySelectorAll<HTMLElement>('.home-card'))
  .map((el) => el.dataset.section);
const rows = () => Array.from(container.querySelectorAll<HTMLElement>('.home-bento-row'))
  .map((row) => Array.from(row.querySelectorAll<HTMLElement>('.home-card')).map((el) => el.dataset.section));
const focused = () => container.querySelector<HTMLElement>('.focused')?.dataset.key;
const sub = (section: string) =>
  container.querySelector(`.home-card[data-section="${section}"] .home-card-sub`)?.textContent ?? null;

function key(...actions: Array<'up' | 'down' | 'left' | 'right'>): void {
  for (const action of actions) home.handleAction(action);
  Focus.flush();
}

describe('bentoRows', () => {
  it('stacks two cards, pairs four, and stretches an odd last card across its row', () => {
    expect(bentoRows(['search', 'settings'])).toEqual([['search'], ['settings']]);
    expect(bentoRows(['epg', 'search', 'settings'])).toEqual([['epg', 'search'], ['settings', 'settings']]);
    expect(bentoRows(['movies', 'series', 'search', 'settings']))
      .toEqual([['movies', 'series'], ['search', 'settings']]);
    expect(bentoRows(['epg', 'movies', 'series', 'search', 'settings']))
      .toEqual([['epg', 'movies', 'series'], ['search', 'settings', 'settings']]);
  });
});

describe('Home', () => {
  it('shows the name, the clock, and the account over a bento with Live first', () => {
    home.setSources(true, [account], account);
    home.render();
    expect(container.querySelector('.home-title')?.textContent).toBe('Pleione');
    expect(container.querySelector('.home-clock')?.textContent).toMatch(/^\d\d:\d\d$/);
    expect(cards()).toEqual(['live', 'movies', 'series', 'search', 'settings']);
    expect(rows()).toEqual([['movies', 'series'], ['search', 'settings']]);
    expect(container.querySelector('.home-account')?.classList.contains('hidden')).toBe(false);
    // No rails: Home lists no titles or channels.
    expect(container.querySelector('.catalog-tile, .catalog-rail')).toBeNull();
  });

  it('stacks Search and Settings beside Live for an M3U setup, without an account', () => {
    home.setSources(false, [], null);
    home.render();
    expect(rows()).toEqual([['search'], ['settings']]);
    expect(container.querySelector('.home-bento-cols-1')).not.toBeNull();
    expect(container.querySelector('.home-account')?.classList.contains('hidden')).toBe(true);
  });

  it('counts nothing: Live, Movies, and Series carry no subtitle', () => {
    state.channels = 150;
    home.setSources(true, [account], account);
    home.render();
    expect(sub('live')).toBeNull();
    expect(sub('movies')).toBeNull();
    expect(sub('series')).toBeNull();
    expect(sub('search')).toBe('Channels, movies, and series');
    expect(sub('settings')).toBe('Sources and appearance');
  });

  it('moves across the bento by its grid, and Live returns Right to the row it was left from', () => {
    home.setSources(true, [account], account);
    home.render();
    home.focusEntry();
    Focus.flush();
    expect(focused()).toBe('section:live');
    key('right');
    expect(focused()).toBe('section:movies');
    key('right');
    expect(focused()).toBe('section:series');
    key('down');
    expect(focused()).toBe('section:settings');
    key('left');
    expect(focused()).toBe('section:search');
    key('left');
    expect(focused()).toBe('section:live');
    key('right');
    expect(focused()).toBe('section:search');
    key('up');
    expect(focused()).toBe('section:movies');
    key('up');
    expect(focused()).toBe('account');
    key('down');
    expect(focused()).toBe('section:movies');
  });

  it('keeps Left off Live and Right at the far edge in place', () => {
    home.setSources(true, [account], account);
    home.render();
    home.focusEntry();
    key('left');
    expect(focused()).toBe('section:live');
    key('right', 'right', 'right');
    expect(focused()).toBe('section:series');
    expect(handlers.onBack).not.toHaveBeenCalled();
  });

  it('opens a card with OK and focuses a given one', () => {
    home.setSources(false, [], null);
    home.render();
    home.focusEntry('settings');
    Focus.flush();
    expect(focused()).toBe('section:settings');
    home.handleAction('select');
    expect(handlers.onOpenSection).toHaveBeenCalledWith('settings', 'key');
  });

  it('hands Back and channel numbers to the host', () => {
    home.setSources(true, [account], account);
    home.render();
    home.handleAction('back');
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    home.handleAction('number', { number: 12, digits: '12' } as never);
    expect(handlers.onPlayNumber).toHaveBeenCalledWith(12);
  });

  it('shows Lock now beside the avatar during a PIN session, reached by Up', () => {
    home.setSources(true, [account], account);
    home.setParentalSession(true);
    home.render();
    const lock = container.querySelector<HTMLElement>('[data-lock-now]')!;
    expect(lock.textContent).toContain('Lock now');
    home.focusEntry();
    key('up');
    expect(focused()).toBe('account');
    key('left');
    expect(focused()).toBe('lock-now');
    home.handleAction('select');
    expect(handlers.onLockNow).toHaveBeenCalledTimes(1);
  });

  it('sends Down from the header to Live when the last card left the bento', () => {
    home.setSources(true, [account], account);
    home.setParentalSession(true);
    home.render();
    home.focusEntry('movies');
    key('up', 'left');
    expect(focused()).toBe('lock-now');
    // The Xtream account goes, and Movies with it.
    home.setSources(false, [], null);
    home.render();
    expect(focused()).toBe('lock-now');
    key('down');
    expect(focused()).toBe('section:live');
  });

  it('tints the glow toward the focused card', () => {
    home.setSources(true, [account], account);
    home.render();
    home.focusEntry('series');
    expect(container.querySelector('.home-view')?.getAttribute('data-tint')).toBe('series');
  });

  it('ticks the clock on the minute', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:30Z'));
    try {
      home.setSources(false, [], null);
      home.render();
      container.getClientRects = () => [{}] as unknown as DOMRectList;
      const before = container.querySelector('.home-clock')!.textContent;
      vi.advanceTimersByTime(31_000);
      expect(container.querySelector('.home-clock')!.textContent).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe('Home first run', () => {
  const info = {
    ip: '10.0.0.2', port: 1, setupUrl: 'http://host/setup?token=t1', manualUrl: 'http://host/a', pairingCode: '1234',
  };

  it('shows the welcome, phone setup, and the two Add cards instead of the bento', async () => {
    handlers.loadSetupInfo.mockResolvedValue(info);
    home.setSources(false, [], null);
    home.setFirstRun(true);
    home.render();
    expect(container.querySelector('.home-bento')).toBeNull();
    expect(container.querySelector('.home-welcome-title')?.textContent).toBe('Welcome to Pleione');
    expect(container.querySelector('.home-setup')?.textContent).toContain('Checking setup service');
    await settle();
    expect(handlers.loadSetupInfo).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.home-setup-qr')?.getAttribute('src')).toMatch(/^data:image\//);
    expect(container.querySelector('.home-setup-url')?.textContent).toBe('http://host/a');
    expect(container.querySelector('.home-setup-code')?.textContent).toBe('1234');
    expect(Array.from(container.querySelectorAll<HTMLElement>('[data-add]')).map((el) => el.dataset.key))
      .toEqual(['add:xtream', 'add:playlist']);
  });

  it('says so when the setup service is unavailable', async () => {
    home.setFirstRun(true);
    home.render();
    await settle();
    expect(container.querySelector('.home-setup')?.textContent).toContain('currently unavailable');
    expect(container.querySelector('.home-setup-qr')).toBeNull();
  });

  it('starts on Add Xtream, moves between the cards, and opens their Add flows with OK', () => {
    home.setFirstRun(true);
    home.render();
    home.focusEntry();
    Focus.flush();
    expect(focused()).toBe('add:xtream');
    home.handleAction('select');
    expect(handlers.onAddSource).toHaveBeenLastCalledWith('xtream', 'key');
    key('down');
    expect(focused()).toBe('add:playlist');
    key('down', 'right');
    expect(focused()).toBe('add:playlist');
    home.handleAction('select');
    expect(handlers.onAddSource).toHaveBeenLastCalledWith('playlist', 'key');
    key('up');
    expect(focused()).toBe('add:xtream');
    key('left');
    expect(focused()).toBe('add:xtream');
  });

  it('a pointer click on a card opens its Add flow', () => {
    home.setFirstRun(true);
    home.render();
    const card = container.querySelector<HTMLElement>('[data-key="add:playlist"]')!;
    document.elementFromPoint = () => card;
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handlers.onAddSource).toHaveBeenCalledWith('playlist', 'pointer');
  });
});

describe('Home connection banner', () => {
  const issue = { state: 'rejected' as const, accountId: 'x1', accountName: '<b>Alpha</b>' };

  beforeEach(() => {
    home.setSources(true, [account], account);
    home.render();
    home.focusEntry();
    Focus.flush();
  });

  it('names the account, escaped, and says why', () => {
    home.setConnection(issue);
    expect(container.querySelector('.home-alert-title')?.textContent).toBe('Can’t connect to <b>Alpha</b>');
    expect(container.querySelector('.home-alert-title b')).toBeNull();
    expect(container.querySelector('.home-alert-body')?.textContent)
      .toBe('The server didn’t accept the username or password.');
    home.setConnection({ ...issue, state: 'unreachable' });
    expect(container.querySelector('.home-alert-body')?.textContent).toContain('isn’t responding');
  });

  it('takes the keys only while Home rests where it opened', () => {
    home.setConnection(issue);
    home.focusAlert();
    Focus.flush();
    expect(focused()).toBe('alert:retry');
    key('down', 'right');
    expect(focused()).toBe('section:movies');
    home.setConnection(issue);
    home.focusAlert();
    Focus.flush();
    expect(focused()).toBe('section:movies');
  });

  it('sits between the header and the bento, and never traps the keys', () => {
    home.setConnection(issue);
    key('up');
    expect(focused()).toBe('alert:retry');
    key('right');
    expect(focused()).toBe('alert:edit');
    key('right');
    expect(focused()).toBe('alert:edit');
    key('up');
    expect(focused()).toBe('account');
    key('down');
    expect(focused()).toBe('alert:edit');
    key('left', 'left');
    expect(focused()).toBe('alert:retry');
    key('down');
    expect(focused()).toBe('section:live');
  });

  it('Try again asks the host, once while it checks; Edit account names the account', () => {
    home.setConnection(issue);
    home.focusAlert();
    home.handleAction('select');
    expect(handlers.onRetryConnection).toHaveBeenCalledTimes(1);
    home.setConnection(issue, true);
    expect(container.querySelector('.home-alert-body')?.textContent).toBe('Checking…');
    home.handleAction('select');
    expect(handlers.onRetryConnection).toHaveBeenCalledTimes(1);
    key('right');
    home.handleAction('select');
    expect(handlers.onEditAccount).toHaveBeenCalledWith(issue, 'key');
  });

  it('goes on success and hands the keys back to the bento', () => {
    home.setConnection(issue);
    home.focusAlert();
    Focus.flush();
    expect(focused()).toBe('alert:retry');
    home.setConnection(null);
    Focus.flush();
    expect(container.querySelector('.home-alert')).toBeNull();
    expect(container.querySelector('.home-view-alert')).toBeNull();
    expect(focused()).toBe('section:live');
  });
});
