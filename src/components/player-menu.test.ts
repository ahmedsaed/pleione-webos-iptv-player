// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AudioTrackOption, SubtitleTrackOption } from '../types';
import { PlayerMenu } from './player-menu';
import { Focus } from '../navigation/focus-scope';

let container: HTMLElement;
let el: HTMLElement;
let anchor: HTMLElement;
let audioTracks: AudioTrackOption[];
let subtitleTracks: SubtitleTrackOption[];
let selectAudioTrack: ReturnType<typeof vi.fn>;
let selectSubtitleTrack: ReturnType<typeof vi.fn>;
let getSubtitleOffsetState: ReturnType<typeof vi.fn>;
let openSubtitleOffset: ReturnType<typeof vi.fn>;
let subtitleSearchAvailable: ReturnType<typeof vi.fn>;
let openSubtitleSearch: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;
let menu: PlayerMenu;

const AUDIO: AudioTrackOption[] = [
  { index: 0, label: 'Track 1', active: true },
  { index: 1, label: 'Track 2', active: false },
  { index: 2, label: 'Track 3', active: false },
];

const SUBS: SubtitleTrackOption[] = [
  { index: 0, label: 'Track 1', active: false },
  { index: 1, label: 'Track 2', active: true },
];

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  container.innerHTML = '<div id="player-menu" class="player-menu hidden"></div>'
    + '<div id="player-osd" class="player-osd"><button id="anchor"></button></div>';
  document.body.appendChild(container);
  el = container.querySelector<HTMLElement>('#player-menu')!;
  anchor = container.querySelector<HTMLElement>('#anchor')!;

  audioTracks = AUDIO;
  subtitleTracks = [];
  selectAudioTrack = vi.fn();
  selectSubtitleTrack = vi.fn();
  getSubtitleOffsetState = vi.fn(() => ({ available: false, label: '0.00 s' }));
  openSubtitleOffset = vi.fn();
  subtitleSearchAvailable = vi.fn(() => false);
  openSubtitleSearch = vi.fn();
  onClose = vi.fn();
  menu = new PlayerMenu(container, {
    getAudioTracks: () => audioTracks,
    selectAudioTrack,
    getSubtitleTracks: () => subtitleTracks,
    selectSubtitleTrack,
    getSubtitleOffsetState,
    openSubtitleOffset,
    subtitleSearchAvailable,
    openSubtitleSearch,
    anchor: () => anchor,
    onClose,
  });
});

afterEach(() => {
  Focus.uninstall();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function items(): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>('.menu-item'));
}

function focusedIndex(): number {
  return items().findIndex(item => item.classList.contains('focused'));
}

describe('PlayerMenu', () => {
  it('opens the audio picker on the active track, without a Back row', () => {
    audioTracks = [{ ...AUDIO[0], active: false }, { ...AUDIO[1], active: true }, AUDIO[2]];
    menu.open('audio');
    expect(menu.visible).toBe(true);
    expect(menu.openKind).toBe('audio');
    expect(el.querySelector('h2')!.textContent).toBe('Audio Track');
    expect(items().map(row => row.dataset.trackIndex)).toEqual(['0', '1', '2']);
    expect(items()[1].querySelector('.menu-check')!.textContent).toBe('✓');
    expect(items()[0].querySelector('.menu-check')!.textContent).toBe('');
    expect(focusedIndex()).toBe(1);
    expect(el.querySelectorAll('.focused')).toHaveLength(1);
  });

  it('sits above the controls, its right edge on the control it opened from', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1920);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1080);
    container.querySelector<HTMLElement>('#player-osd')!.getBoundingClientRect = () =>
      ({ left: 40, right: 1880, top: 860, bottom: 1060 }) as DOMRect;
    anchor.getBoundingClientRect = () => ({ left: 1700, right: 1760, top: 990, bottom: 1050 }) as DOMRect;
    menu.open('audio');
    expect(el.style.right).toBe('160px');
    expect(el.style.bottom).toBe('236px');
    expect(el.style.maxHeight).toBe('764px');
  });

  it('moves with Up/Down and clamps at the ends', () => {
    menu.open('audio');
    menu.handleAction('up');
    expect(focusedIndex()).toBe(0);
    menu.handleAction('down');
    expect(focusedIndex()).toBe(1);
    for (let i = 0; i < 5; i++) menu.handleAction('down');
    expect(focusedIndex()).toBe(2);
  });

  it('picks a track, closes, and tells the host', () => {
    menu.open('audio');
    menu.handleAction('down');
    menu.handleAction('down');
    menu.handleAction('select');
    expect(selectAudioTrack).toHaveBeenCalledWith(2);
    expect(menu.visible).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(['back', 'left', 'right'] as const)('closes on %s without picking', (action) => {
    menu.open('audio');
    menu.handleAction(action);
    expect(menu.visible).toBe(false);
    expect(selectAudioTrack).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('greys a track marked unavailable (a collapsed rendition), not the others', () => {
    audioTracks = [
      { index: 0, label: 'Track 1', active: true },
      { index: 1, label: 'Track 2', active: false, available: false },
    ];
    menu.open('audio');
    expect(items().map(row => row.classList.contains('unavailable'))).toEqual([false, true]);
  });

  it('lists Off and the tracks in the subtitle picker, focusing the active one', () => {
    subtitleTracks = SUBS;
    menu.open('subtitles');
    expect(el.querySelector('h2')!.textContent).toBe('Subtitles');
    const rows = items();
    expect(rows.map(row => row.dataset.trackIndex)).toEqual(['-1', '0', '1']);
    expect(rows[0].textContent).toContain('Off');
    expect(rows[2].querySelector('.menu-check')!.textContent).toBe('✓');
    expect(focusedIndex()).toBe(2);
  });

  it('marks and focuses Off when no subtitle shows, and Off turns them off', () => {
    subtitleTracks = [{ index: 0, label: 'Track 1', active: false }];
    menu.open('subtitles');
    expect(items()[0].querySelector('.menu-check')!.textContent).toBe('✓');
    expect(focusedIndex()).toBe(0);
    menu.handleAction('select');
    expect(selectSubtitleTrack).toHaveBeenCalledWith(-1);
    expect(menu.visible).toBe(false);
  });

  it('offers online search and subtitle sync when available', () => {
    subtitleTracks = [{ index: 0, label: 'Track 1', active: true }];
    subtitleSearchAvailable.mockReturnValue(true);
    getSubtitleOffsetState.mockReturnValue({ available: true, label: '+0.25 s' });
    menu.open('subtitles');
    const actions = items().map(row => row.dataset.menuAction);
    expect(actions).toEqual(['__subs_track__', '__subs_track__', '__subs_search__', '__subs_offset__']);
    const offset = items()[3];
    expect(offset.textContent).toContain('Subtitle Sync');
    expect(offset.textContent).toContain('+0.25 s');

    offset.click();
    expect(openSubtitleOffset).toHaveBeenCalledOnce();
    expect(menu.visible).toBe(false);

    menu.open('subtitles');
    items()[2].click();
    expect(openSubtitleSearch).toHaveBeenCalledOnce();
    expect(selectSubtitleTrack).not.toHaveBeenCalled();
    expect(menu.visible).toBe(false);
  });

  it('greys a subtitle track marked unavailable, but never the Off row', () => {
    subtitleTracks = [{ index: 0, label: 'Track 1', active: false, available: false }];
    menu.open('subtitles');
    expect(items().map(row => row.classList.contains('unavailable'))).toEqual([false, true]);
  });

  it('keeps focus on its row across a refresh, else steps to the row above', () => {
    subtitleTracks = SUBS;
    menu.open('subtitles');
    menu.refresh();
    expect(focusedIndex()).toBe(2);
    subtitleTracks = [SUBS[0]];
    menu.refresh();
    expect(focusedIndex()).toBe(1);
  });

  describe('pointer', () => {
    it('picks a clicked track', () => {
      menu.open('audio');
      el.querySelector<HTMLElement>('[data-track-index="1"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(selectAudioTrack).toHaveBeenCalledWith(1);
      expect(menu.visible).toBe(false);
    });

    it('moves its focus to a hovered row', () => {
      menu.open('audio');
      items()[2].dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
      expect(focusedIndex()).toBe(2);
      expect(el.querySelectorAll('.focused')).toHaveLength(1);
    });

    it('leaves a raw mouseover, which a resting pointer fires in key mode, to the key handler', () => {
      menu.open('audio');
      items()[2].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(focusedIndex()).toBe(0);
    });

    it('does not stack listeners across opens (one pick per click)', () => {
      menu.open('audio');
      menu.hide();
      menu.open('audio');
      items()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(selectAudioTrack).toHaveBeenCalledTimes(1);
    });
  });

  it('scrolls only its list to reveal the focused row', () => {
    menu.open('audio');
    const list = el.querySelector<HTMLElement>('.menu-items')!;
    const second = items()[1];
    const scrollIntoView = vi.fn();
    second.scrollIntoView = scrollIntoView;
    Object.defineProperty(list, 'scrollTop', { value: 0, writable: true, configurable: true });
    list.getBoundingClientRect = () => ({ top: 100, bottom: 300 }) as DOMRect;
    second.getBoundingClientRect = () => ({ top: 280, bottom: 340 }) as DOMRect;

    menu.handleAction('down');

    expect(list.scrollTop).toBe(40);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('opens on its active row without a glide, and steps a held key instantly', () => {
    audioTracks = Array.from({ length: 6 }, (_, i) => ({ index: i, label: `Track ${i + 1}`, active: i === 5 }));
    const writes: string[] = [];
    let top = 0;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('menu-items')) return { top: 100, bottom: 300 } as DOMRect;
      return { top: 280, bottom: 340 } as DOMRect;
    });
    const list = (): HTMLElement => el.querySelector<HTMLElement>('.menu-items')!;
    menu.open('audio');
    menu.hide();
    Object.defineProperty(list(), 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        writes.push(list().style.getPropertyValue('scroll-behavior'));
        top = value;
      },
    });
    menu.open('audio');
    expect(writes).toEqual(['auto']);

    list().style.setProperty('scroll-behavior', 'smooth');
    vi.advanceTimersByTime(1000);
    menu.handleAction('up');
    vi.advanceTimersByTime(80);
    menu.handleAction('up');
    expect(writes).toEqual(['auto', 'smooth', 'auto']);
    expect(list().style.getPropertyValue('scroll-behavior')).toBe('smooth');
  });

  describe('hide transition', () => {
    // Chromium 53 predates `once`: it ignores `once` in an options object
    // and keeps the listener attached after it fires.
    function ignoreListenerOptions(): { attached: () => number } {
      const listeners = new Set<EventListenerOrEventListenerObject>();
      const add = el.addEventListener.bind(el);
      const remove = el.removeEventListener.bind(el);
      el.addEventListener = (type: string, fn: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions) => {
        if (type === 'transitionend' && fn) listeners.add(fn);
        add(type, fn, typeof options === 'object' ? !!options.capture : options);
      };
      el.removeEventListener = (type: string, fn: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions) => {
        if (type === 'transitionend' && fn) listeners.delete(fn);
        remove(type, fn, options);
      };
      return { attached: () => listeners.size };
    }

    function transitionEnd(): void {
      el.dispatchEvent(new Event('transitionend'));
    }

    it('adds the hidden class once the fade-out ends', () => {
      menu.open('audio');
      menu.hide();
      expect(el.classList.contains('hidden')).toBe(false);
      transitionEnd();
      expect(el.classList.contains('hidden')).toBe(true);
    });

    it('keeps no listener behind on an engine without `once`', () => {
      const engine = ignoreListenerOptions();
      for (let i = 0; i < 5; i++) {
        menu.open('audio');
        menu.hide();
        transitionEnd();
      }
      expect(engine.attached()).toBe(0);
    });

    it('drops an unfinished fade-out when the picker reopens', () => {
      const engine = ignoreListenerOptions();
      menu.open('audio');
      menu.hide();
      menu.open('subtitles');
      expect(engine.attached()).toBe(0);
      transitionEnd();
      expect(el.classList.contains('hidden')).toBe(false);
      expect(menu.visible).toBe(true);
    });
  });

  it('hides itself after the idle timeout', () => {
    menu.open('audio');
    vi.advanceTimersByTime(5000);
    expect(menu.visible).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
