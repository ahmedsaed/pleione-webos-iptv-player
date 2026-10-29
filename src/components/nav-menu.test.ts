// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NavMenu, NAV_MENU_REVEAL_DWELL_MS, NAV_MENU_REVEAL_EDGE } from './nav-menu';
import { Focus } from '../navigation/focus-scope';
import type { PlaylistEntry } from '../types';

function account(id: string, name: string): PlaylistEntry {
  return { id, name, url: 'http://host/a', source: 'xtream', xtream: { username: 'u', password: 'p' } };
}

let menu: NavMenu;
let handlers: {
  onSelect: ReturnType<typeof vi.fn>;
  onBack: ReturnType<typeof vi.fn>;
  onDismiss: ReturnType<typeof vi.fn>;
  onLockNow: ReturnType<typeof vi.fn>;
  onSelectAccount: ReturnType<typeof vi.fn>;
  canReveal: ReturnType<typeof vi.fn>;
  current: ReturnType<typeof vi.fn>;
};

const root = () => document.querySelector<HTMLElement>('.nav-menu')!;
const focusedKey = () => root().querySelector<HTMLElement>('.focused')?.dataset.key ?? null;
const sections = () => Array.from(root().querySelectorAll<HTMLElement>('.nav-menu-sections .nav-menu-item'))
  .map((el) => el.dataset.section);

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  handlers = {
    onSelect: vi.fn(), onBack: vi.fn(), onDismiss: vi.fn(), onLockNow: vi.fn(), onSelectAccount: vi.fn(),
    canReveal: vi.fn(() => true),
    current: vi.fn(() => null),
  };
  menu = new NavMenu(handlers);
  menu.init();
  Focus.install();
});

afterEach(() => Focus.uninstall());

describe('NavMenu', () => {
  it('lists Home and the sections an M3U setup has, without the hidden Guide', () => {
    menu.setSections(false);
    expect(sections()).toEqual(['home', 'live', 'search', 'settings']);
    menu.setSections(true);
    expect(sections()).toEqual(['home', 'live', 'movies', 'series', 'search', 'settings']);
  });

  it('lists the Guide when the hidden preference shows it', () => {
    localStorage.setItem('iptv_show_guide_tab', 'true');
    menu.setSections(true);
    expect(sections()).toContain('epg');
  });

  it('opens on the current section, marked apart from focus, and owns the keys', () => {
    menu.setSections(true);
    handlers.current.mockReturnValue('movies');
    menu.open('key');
    Focus.flush();
    expect(menu.isOpen).toBe(true);
    expect(root().classList.contains('open')).toBe(true);
    expect(Focus.owner()?.id).toBe('navmenu');
    expect(focusedKey()).toBe('section:movies');
    expect(root().querySelector('.nav-menu-item.current')?.getAttribute('data-section')).toBe('movies');

    menu.handleAction('down');
    Focus.flush();
    expect(focusedKey()).toBe('section:series');
    // The cue stays on the current section, not on focus.
    expect(root().querySelector('.nav-menu-item.current')?.getAttribute('data-section')).toBe('movies');
  });

  it('Up and Down stop at the ends', () => {
    menu.setSections(false);
    handlers.current.mockReturnValue('home');
    menu.open('key');
    menu.handleAction('up');
    Focus.flush();
    expect(focusedKey()).toBe('section:home');
    for (let i = 0; i < 6; i++) menu.handleAction('down');
    Focus.flush();
    expect(focusedKey()).toBe('section:settings');
  });

  it('OK switches section and closes, handing the keys back', () => {
    menu.setSections(true);
    handlers.current.mockReturnValue('live');
    menu.open('key');
    menu.handleAction('down');
    menu.handleAction('select');
    expect(handlers.onSelect).toHaveBeenCalledWith('movies', 'key');
    expect(menu.isOpen).toBe(false);
    expect(Focus.owner()).toBeNull();
  });

  it('Right closes without switching; Back is the host\'s', () => {
    menu.setSections(true);
    handlers.current.mockReturnValue('live');
    menu.open('key');
    menu.handleAction('back');
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(menu.isOpen).toBe(true);
    menu.handleAction('right');
    expect(menu.isOpen).toBe(false);
    expect(handlers.onDismiss).toHaveBeenCalledTimes(1);
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it('shows the account first and Lock now last while a PIN session lasts', () => {
    menu.setSections(true);
    menu.setAccounts([account('a1', 'Alpha'), account('a2', 'Bravo')], 'a2');
    menu.setParentalSession(true);
    handlers.current.mockReturnValue('live');
    menu.open('key');
    expect(root().querySelector('.nav-menu-account .nav-menu-label')?.textContent).toBe('Bravo');
    for (let i = 0; i < 10; i++) menu.handleAction('down');
    Focus.flush();
    expect(focusedKey()).toBe('lock-now');
    menu.handleAction('select');
    expect(handlers.onLockNow).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 10; i++) menu.handleAction('up');
    Focus.flush();
    expect(focusedKey()).toBe('account');
    menu.handleAction('select');
    expect(menu.accountMenuOpen).toBe(true);
    expect(Focus.owner()?.id).toBe('navmenu.accounts');
  });

  it('hides the account row without accounts', () => {
    menu.setSections(false);
    menu.open('key');
    expect(root().querySelector('.nav-menu-account')?.classList.contains('hidden')).toBe(true);
    menu.handleAction('up');
    Focus.flush();
    expect(focusedKey()).toBe('section:home');
  });

  describe('the pointer at the left edge', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      menu.setSections(true);
      document.elementFromPoint = () => null;
    });
    afterEach(() => {
      vi.useRealTimers();
      document.documentElement.classList.remove('keyboard-nav');
    });

    it('reveals it after resting there, only where the host allows', () => {
      handlers.canReveal.mockReturnValue(false);
      Focus.pointer(300, 500);
      Focus.pointer(NAV_MENU_REVEAL_EDGE, 500);
      vi.advanceTimersByTime(NAV_MENU_REVEAL_DWELL_MS);
      expect(menu.isOpen).toBe(false);

      handlers.canReveal.mockReturnValue(true);
      handlers.current.mockReturnValue('movies');
      Focus.pointer(300, 500);
      Focus.pointer(0, 500);
      vi.advanceTimersByTime(NAV_MENU_REVEAL_DWELL_MS - 1);
      expect(menu.isOpen).toBe(false);
      vi.advanceTimersByTime(1);
      expect(menu.isOpen).toBe(true);
      // Opened by the pointer, it still marks the section under it.
      expect(root().querySelector('.nav-menu-item.current')?.getAttribute('data-section')).toBe('movies');
    });

    it('stays open wherever the pointer drifts, and reveals once per visit to the edge', () => {
      Focus.pointer(300, 500);
      Focus.pointer(0, 500);
      vi.advanceTimersByTime(NAV_MENU_REVEAL_DWELL_MS);
      expect(menu.isOpen).toBe(true);
      for (const x of [600, 1400, 1919, 900]) Focus.pointer(x, 300);
      expect(menu.isOpen).toBe(true);

      // Closed with the pointer back at the edge, it waits for a new visit.
      Focus.pointer(0, 500);
      menu.close('key');
      Focus.pointer(2, 600);
      vi.advanceTimersByTime(NAV_MENU_REVEAL_DWELL_MS * 2);
      expect(menu.isOpen).toBe(false);
      Focus.pointer(300, 600);
      Focus.pointer(0, 600);
      vi.advanceTimersByTime(NAV_MENU_REVEAL_DWELL_MS);
      expect(menu.isOpen).toBe(true);
    });

    it('waits while a rail under it still edge-scrolls back', () => {
      const track = document.createElement('div');
      track.setAttribute('data-edge-scroll', '');
      document.body.appendChild(track);
      let scrolled = 40;
      Object.defineProperty(track, 'scrollLeft', { get: () => scrolled });
      document.elementFromPoint = () => track;
      Focus.pointer(300, 500);
      Focus.pointer(0, 500);
      vi.advanceTimersByTime(NAV_MENU_REVEAL_DWELL_MS * 3);
      expect(menu.isOpen).toBe(false);
      scrolled = 0;
      vi.advanceTimersByTime(NAV_MENU_REVEAL_DWELL_MS);
      expect(menu.isOpen).toBe(true);
    });

    it('opens nothing for a sweep past it, a cursor first seen there, or a key meanwhile', () => {
      Focus.pointer(300, 500);
      Focus.pointer(0, 500);
      Focus.pointer(300, 500);
      vi.advanceTimersByTime(NAV_MENU_REVEAL_DWELL_MS);
      expect(menu.isOpen).toBe(false);

      // A fresh menu has seen no pointer: its first report is a parked cursor.
      Focus.uninstall();
      document.body.innerHTML = '';
      menu = new NavMenu(handlers);
      menu.init();
      Focus.pointer(0, 0);
      vi.advanceTimersByTime(NAV_MENU_REVEAL_DWELL_MS);
      expect(menu.isOpen).toBe(false);

      Focus.pointer(300, 500);
      Focus.pointer(0, 500);
      document.documentElement.classList.add('keyboard-nav');
      vi.advanceTimersByTime(NAV_MENU_REVEAL_DWELL_MS);
      expect(menu.isOpen).toBe(false);
    });
  });

  it('a click on an item switches; one on the scrim closes', () => {
    menu.setSections(true);
    handlers.current.mockReturnValue('live');
    menu.open('pointer');
    const item = root().querySelector<HTMLElement>('[data-section="series"]')!;
    document.elementFromPoint = () => item;
    root().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handlers.onSelect).toHaveBeenCalledWith('series', 'pointer');

    menu.open('pointer');
    const scrim = root().querySelector<HTMLElement>('.nav-menu-scrim')!;
    document.elementFromPoint = () => scrim;
    root().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(menu.isOpen).toBe(false);
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  });
});
