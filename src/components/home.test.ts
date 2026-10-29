// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PlaylistEntry } from '../types';

const state = vi.hoisted(() => ({
  channels: 0,
  guide: false,
}));

vi.mock('../services/storage-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/storage-service')>();
  return {
    StorageService: Object.assign(Object.create(actual.StorageService), {
      getShowGuideTab: () => state.guide,
    }),
  };
});
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
  state.guide = false;
  handlers = {
    onOpenSection: vi.fn(), onPlayNumber: vi.fn(), onSelectAccount: vi.fn(),
    onLockNow: vi.fn(), onLeaveLeft: vi.fn(), onBack: vi.fn(),
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

  it('fits the Guide in when its hidden preference is on', () => {
    state.guide = true;
    home.setSources(true, [account], account);
    home.render();
    expect(rows()).toEqual([['epg', 'movies', 'series'], ['search', 'settings']]);
    expect(container.querySelector('.home-card[data-section="settings"]')?.getAttribute('style'))
      .toContain('flex-grow:2');
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

  it('hands Left off Live to the host and keeps Right at the far edge', () => {
    home.setSources(true, [account], account);
    home.render();
    home.focusEntry();
    key('left');
    expect(handlers.onLeaveLeft).toHaveBeenCalledTimes(1);
    key('right', 'right', 'right');
    expect(focused()).toBe('section:series');
    expect(handlers.onLeaveLeft).toHaveBeenCalledTimes(1);
  });

  it('a spanning card is one stop, from either column above it', () => {
    state.guide = true;
    home.setSources(true, [account], account);
    home.render();
    home.focusEntry('series');
    key('down');
    expect(focused()).toBe('section:settings');
    key('left');
    expect(focused()).toBe('section:search');
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
