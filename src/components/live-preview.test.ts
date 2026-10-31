// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LivePreview } from './live-preview';
import { EpgService } from '../services/epg-service';
import { PlaylistService } from '../services/playlist-service';
import { CONFIG } from '../config';
import type { LivePlaybackSnapshot, Programme } from '../types';
import { setDisplayTz } from '../utils/time';
import type { ChannelList } from './channel-list';
import type { Player } from './player';
import { morph } from '../utils/morph';

vi.mock('../utils/morph', async (original) => {
  const actual = await original<typeof import('../utils/morph')>();
  return { ...actual, morph: vi.fn(actual.morph) };
});

vi.mock('../services/epg-service', () => ({
  EpgService: {
    findChannelId: vi.fn(() => 'ch1'),
    getNowPlaying: vi.fn(),
    getUpcoming: vi.fn(),
  },
}));

const now = new Date('2026-09-15T20:36:00Z');
function program(start: number, stop: number, title = 'Program 1', description = ''): Programme {
  return {
    start: new Date(now.getTime() + start * 60000),
    stop: new Date(now.getTime() + stop * 60000),
    title, description, category: '', icon: '',
  };
}
function state(): LivePlaybackSnapshot {
  return {
    channel: {
      id: 'ch1', name: 'Channel 1', url: 'http://host/ch1', logo: '',
      group: '', extras: null, playlistIds: ['p1'],
      catchup: '', catchupSource: '', catchupDays: 0,
    },
    status: 'playing', muted: false,
  };
}

interface LivePreviewInternals {
  readonly slot: HTMLElement | null;
  applyState(state: LivePlaybackSnapshot | null): void;
  fitPrograms(): void;
}

describe('LivePreview', () => {
  let root: HTMLElement;
  let preview: LivePreview;
  let view: LivePreviewInternals;
  let favorite: boolean;
  let suppressed: boolean;
  let playerPlay: ReturnType<typeof vi.fn>;
  let liveSnapshot: ReturnType<typeof vi.fn>;
  let livePreviewMode: boolean;
  let actions: {
    onClose: ReturnType<typeof vi.fn>;
    onExpand: ReturnType<typeof vi.fn>;
    onPlayFullscreen: ReturnType<typeof vi.fn>;
    onHighlightEntryPoint: ReturnType<typeof vi.fn>;
    onSetPlaying: ReturnType<typeof vi.fn>;
    onWatch: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    setDisplayTz('feed', 0);
    vi.mocked(EpgService.findChannelId).mockReturnValue('ch1');
    vi.mocked(EpgService.getNowPlaying).mockReturnValue(program(-36, 24));
    vi.mocked(EpgService.getUpcoming).mockReturnValue([
      program(24, 74, 'Program 2'), program(74, 114, 'Program 3'), program(114, 174, 'Program 4'),
      program(174, 234, 'Program 5'),
    ]);
    root = document.createElement('aside');
    document.body.appendChild(root);
    favorite = false;
    suppressed = false;
    actions = {
      onClose: vi.fn(), onExpand: vi.fn(), onPlayFullscreen: vi.fn(),
      onHighlightEntryPoint: vi.fn(), onSetPlaying: vi.fn(), onWatch: vi.fn(),
    };
    playerPlay = vi.fn();
    liveSnapshot = vi.fn(() => null);
    livePreviewMode = false;
    const player = {
      getVideoElement: vi.fn(() => null),
      getLivePlaybackSnapshot: liveSnapshot,
      getCurrentIndex: vi.fn(() => 1),
      isInLivePreview: vi.fn(() => livePreviewMode),
      enterLivePreview: vi.fn(() => { livePreviewMode = true; }),
      exitLivePreview: vi.fn(() => { livePreviewMode = false; }),
      play: playerPlay,
      stop: actions.onClose,
      showOSD: vi.fn(),
    } as unknown as Player;
    const channelList = {
      isEditing: false,
      highlightEntryPoint: actions.onHighlightEntryPoint,
      render: vi.fn(),
      setPlaying: actions.onSetPlaying,
    } as unknown as ChannelList;
    preview = new LivePreview(root, {
      channelView: document.createElement('div'),
      player,
      channelList,
      getCurrentView: () => 'channels',
      showChannels: vi.fn(),
      showPlayer: actions.onExpand,
      playFullscreen: actions.onPlayFullscreen,
      expansionBlocked: () => false,
      isFavorite: () => favorite,
      suppressed: () => suppressed,
      onWatch: actions.onWatch,
    });
    view = preview as unknown as LivePreviewInternals;
  });

  afterEach(() => {
    view.applyState(null);
    PlaylistService.reset();
    root.remove();
    vi.clearAllMocks();
    vi.useRealTimers();
    setDisplayTz('device', null);
  });

  it('shows the channel, the current program with progress, and four future items', () => {
    view.applyState(state());
    expect(root.querySelector('.live-preview-channel')?.textContent).toBe('Channel 1');
    expect(root.querySelector('.live-preview-slot .live-preview-badge')?.textContent).toContain('LIVE');
    expect(root.querySelector('.live-preview-title')?.textContent).toBe('Program 1');
    expect(root.querySelector('.live-preview-time-range')?.textContent).toBe('20:00–21:00');
    expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('60');
    expect(root.querySelector('.live-preview-remaining')?.textContent).toContain('24');
    expect(root.querySelectorAll('.live-preview-program')).toHaveLength(4);
    expect(root.querySelector('.live-preview-program time')?.textContent).toBe('21:00–21:50');
    expect(EpgService.getUpcoming).toHaveBeenCalledWith('ch1', CONFIG.PLAYER.LIVE_PREVIEW_UPCOMING_COUNT);
  });

  it('has no controls: nothing in the pane takes focus', () => {
    view.applyState(state());
    expect(root.querySelectorAll('button, [data-focusable]')).toHaveLength(0);
    expect(root.querySelector('.live-preview-clock')).toBeNull();
    expect(root.querySelector('.live-preview-legend')).toBeNull();
  });

  it('marks a favorite channel with a star', () => {
    view.applyState(state());
    expect(root.querySelector('.live-preview-favorite')).toBeNull();
    favorite = true;
    view.applyState(state());
    expect(root.querySelector('.live-preview-favorite .favorite-glyph.set')).not.toBeNull();
  });

  it('shows the current program description', () => {
    vi.mocked(EpgService.getNowPlaying).mockReturnValue(program(-36, 24, 'Program 1', 'Synthetic description'));
    view.applyState(state());
    expect(root.querySelector('.live-preview-description')?.textContent).toBe('Synthetic description');
  });

  it('keeps the slot through EPG changes and status messages without recreating video', () => {
    view.applyState(state());
    const slot = view.slot;
    vi.setSystemTime(new Date(now.getTime() + 60000));
    vi.mocked(EpgService.getNowPlaying).mockReturnValue(program(-1, 59, 'Program 5'));
    view.applyState(state());
    expect(view.slot).toBe(slot);
    expect(root.querySelector('.live-preview-title')?.textContent).toBe('Program 5');
    view.applyState({ ...state(), status: 'buffering' });
    expect(view.slot).toBe(slot);
    expect(root.querySelector('.live-preview-message')?.textContent).toContain('Connecting');
    expect(root.querySelector('video')).toBeNull();
  });

  it('retunes to a focused channel without leaving the list', () => {
    PlaylistService.channels = [state().channel];
    preview.retune(0, { group: 'builtin:all' });
    expect(playerPlay).toHaveBeenCalledWith(0, undefined, { group: 'builtin:all' });
    expect(livePreviewMode).toBe(true);
    expect(actions.onExpand).not.toHaveBeenCalled();
    expect(actions.onWatch).not.toHaveBeenCalled();
  });

  it('does not retune while Live shows the Guide', () => {
    PlaylistService.channels = [state().channel];
    suppressed = true;
    preview.retune(0, null);
    expect(playerPlay).not.toHaveBeenCalled();
  });

  it('retunes the same stable channel when its refreshed URL changed', () => {
    const oldChannel = { ...state().channel, url: 'http://host/ch1?token=old' };
    PlaylistService.channels = [{ ...oldChannel, url: 'http://host/ch1?token=new' }];
    liveSnapshot.mockReturnValue({ ...state(), channel: oldChannel });
    preview.retune(0, null);
    expect(playerPlay).toHaveBeenCalledWith(0, undefined, null);
  });

  it('watches full screen on OK: the preview stream when it is that channel', () => {
    const current = state();
    PlaylistService.channels = [current.channel];
    liveSnapshot.mockReturnValue(current);
    view.applyState(current);
    preview.selectChannel(0, undefined, null, 'expand-current');
    expect(actions.onExpand).toHaveBeenCalledOnce();
    expect(playerPlay).not.toHaveBeenCalled();
    expect(actions.onWatch).toHaveBeenCalledWith(0);
  });

  it('watches full screen on OK: a channel the preview is not showing starts there', () => {
    const current = state();
    PlaylistService.channels = [current.channel, { ...current.channel, id: 'ch2', url: 'http://host/ch2' }];
    liveSnapshot.mockReturnValue(current);
    view.applyState(current);
    preview.selectChannel(1, undefined, null, 'expand-current');
    expect(actions.onPlayFullscreen).toHaveBeenCalledWith(1, undefined, null);
    expect(actions.onExpand).not.toHaveBeenCalled();
    expect(actions.onWatch).toHaveBeenCalledWith(1);
  });

  it('routes a numbered channel straight to full screen', () => {
    preview.selectChannel(1, undefined, { group: 'builtin:all' }, 'fullscreen');
    expect(actions.onPlayFullscreen).toHaveBeenCalledWith(1, undefined, { group: 'builtin:all' });
    expect(actions.onWatch).toHaveBeenCalledWith(1);
    expect(playerPlay).not.toHaveBeenCalled();
  });

  it('watches full screen when the pointer clicks the video', () => {
    view.applyState(state());
    view.slot!.click();
    expect(actions.onExpand).toHaveBeenCalledOnce();
    expect(actions.onWatch).toHaveBeenCalledWith(1);
    expect(root.hasAttribute('data-self-activate')).toBe(true);
  });

  it('focuses the current playing channel when returning from full screen', () => {
    liveSnapshot.mockReturnValue(state());
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame')
      .mockImplementation(callback => {
        callback(0);
        return 1;
      });
    expect(preview.returnFromFullscreen(true)).toBe(true);
    expect(actions.onSetPlaying).toHaveBeenCalledWith(1);
    expect(requestFrame).toHaveBeenCalledOnce();
    expect(actions.onHighlightEntryPoint).toHaveBeenCalledOnce();
  });

  it('does not take the stream back into the pane while Live shows the Guide', () => {
    liveSnapshot.mockReturnValue(state());
    suppressed = true;
    expect(preview.returnFromFullscreen(true)).toBe(false);
    expect(livePreviewMode).toBe(false);
  });

  it('stops a preview the Guide replaces', () => {
    liveSnapshot.mockReturnValue(state());
    livePreviewMode = true;
    suppressed = true;
    preview.refresh();
    expect(actions.onClose).toHaveBeenCalledOnce();
    expect(preview.isShowing).toBe(false);
  });

  it('closes on Stop', () => {
    view.applyState(state());
    expect(preview.handleAction('stop')).toBe(true);
    expect(actions.onClose).toHaveBeenCalledOnce();
    expect(preview.handleAction('select')).toBe(false);
  });

  it('keeps a cross-day group of upcoming programs', () => {
    vi.mocked(EpgService.getUpcoming).mockReturnValue([
      program(24, 74, 'Program 2'),
      program(240, 300, 'Program 3'),
    ]);
    view.applyState(state());
    expect(root.querySelectorAll('.live-preview-program')).toHaveLength(2);
    expect(root.querySelector('.live-preview-day-separator')).not.toBeNull();
  });

  it('leaves program details empty when all EPG is absent', () => {
    vi.mocked(EpgService.findChannelId).mockReturnValue(null);
    view.applyState(state());
    expect(root.querySelector('.live-preview-title')).toBeNull();
    expect(root.querySelector('.live-preview-upcoming')).toBeNull();
    expect(root.querySelector('.live-preview-empty')).toBeNull();
    expect(root.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('handles partial EPG and invalid durations without invented programs', () => {
    vi.mocked(EpgService.getNowPlaying).mockReturnValue(program(1, 1));
    vi.mocked(EpgService.getUpcoming).mockReturnValue([program(24, 24), program(25, 50)]);
    view.applyState(state());
    expect(root.querySelector('[role="progressbar"]')).toBeNull();
    expect(root.querySelectorAll('.live-preview-program')).toHaveLength(1);
  });

  it('gives overlapping EPG entries distinct morph keys', () => {
    vi.mocked(EpgService.getUpcoming).mockReturnValue([
      program(24, 50, 'Program 2'),
      program(24, 74, 'Program 3'),
    ]);
    view.applyState(state());
    const keys = Array.from(root.querySelectorAll('.live-preview-program'))
      .map(row => row.getAttribute('data-key'));
    expect(new Set(keys).size).toBe(2);
  });

  it('recalculates the last visible program when the layout changes', () => {
    const rect = (bottom: number, height: number): DOMRect => ({
      x: 0, y: bottom - height, top: bottom - height, right: 100,
      bottom, left: 0, width: 100, height, toJSON: () => ({}),
    });
    let detailsBottom = 300;
    view.applyState(state());
    const details = root.querySelector<HTMLElement>('.live-preview-details')!;
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.live-preview-program'));
    vi.spyOn(details, 'getBoundingClientRect')
      .mockImplementation(() => rect(detailsBottom, detailsBottom));
    rows.forEach((row, index) => {
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(200 + index * 40, 40));
    });

    view.fitPrograms();
    expect(rows[2].classList.contains('last-visible')).toBe(true);
    expect(rows[3].style.display).toBe('none');

    detailsBottom = 400;
    preview.refreshLayout();
    expect(rows[2].classList.contains('last-visible')).toBe(false);
    expect(rows[3].classList.contains('last-visible')).toBe(true);
    expect(rows[3].style.display).toBe('');
  });

  it('adds a date to future programs across midnight', () => {
    vi.mocked(EpgService.getUpcoming).mockReturnValue([program(240, 300)]);
    view.applyState(state());
    expect(root.querySelector('.live-preview-day-separator')?.textContent).toContain('Tomorrow');
    expect(root.querySelector('.live-preview-day-separator')?.textContent).toContain('09/16');
    expect(root.querySelector('.live-preview-program time')?.textContent).toBe('00:36–01:36');
  });

  it('groups three sparse upcoming programs across three display days', () => {
    vi.mocked(EpgService.getUpcoming).mockReturnValue([
      program(240, 300, 'Program 2'),
      program(1680, 1740, 'Program 3'),
      program(3120, 3180, 'Program 4'),
    ]);
    view.applyState(state());
    const labels = Array.from(root.querySelectorAll('.live-preview-day-separator'))
      .map(element => element.textContent?.trim());
    expect(labels).toEqual(['Tomorrow, 09/16', 'Thu, 09/17', 'Fri, 09/18']);
    expect(root.querySelectorAll('.live-preview-program')).toHaveLength(3);
  });

  it('escapes all channel and programme text', () => {
    const malicious = '<img src=x onerror=alert(1)>';
    const value = state();
    value.channel.name = malicious;
    vi.mocked(EpgService.getNowPlaying).mockReturnValue(program(-10, 10, malicious, malicious));
    vi.mocked(EpgService.getUpcoming).mockReturnValue([program(10, 60, malicious)]);
    view.applyState(value);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.live-preview-channel')?.textContent).toBe(malicious);
    expect(root.querySelector('.live-preview-title')?.textContent).toBe(malicious);
    expect(root.querySelector('.live-preview-description')?.textContent).toBe(malicious);
  });

  it('schedules lightweight refresh and cancels it when stopped or suspended', () => {
    const refresh = vi.spyOn(preview, 'refresh').mockImplementation(() => {});
    view.applyState(state());
    view.applyState(state());
    // The tick hands a preview that stopped to the full refresh.
    vi.advanceTimersByTime(CONFIG.PLAYER.LIVE_PREVIEW_REFRESH_MS);
    expect(refresh).toHaveBeenCalledOnce();
    view.applyState(state());
    preview.suspend();
    vi.advanceTimersByTime(CONFIG.PLAYER.LIVE_PREVIEW_REFRESH_MS);
    expect(refresh).toHaveBeenCalledOnce();
    view.applyState(null);
    expect(root.classList.contains('hidden')).toBe(true);
  });

  describe('while the preview idles', () => {
    let fit: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      // A previewable channel, so a full refresh would keep it showing.
      localStorage.setItem(`${CONFIG.STORAGE_PREFIX}playlists`,
        JSON.stringify([{ id: 'p1', name: 'P1', url: 'http://host/a' }]));
      PlaylistService.channels = [state().channel];
      PlaylistService.allChannels = [state().channel];
      liveSnapshot.mockImplementation(() => state());
      livePreviewMode = true;
      view.applyState(state());
      fit = vi.spyOn(view, 'fitPrograms');
      vi.mocked(morph).mockClear();
    });
    afterEach(() => localStorage.clear());

    it('neither morphs nor fits on an unchanged tick', () => {
      vi.advanceTimersByTime(10 * CONFIG.PLAYER.LIVE_PREVIEW_REFRESH_MS);
      expect(morph).not.toHaveBeenCalled();
      expect(fit).not.toHaveBeenCalled();
    });

    it('moves the progress bar in place at most every progress interval', () => {
      const bar = root.querySelector<HTMLElement>('.live-preview-progress > div')!;
      const width = bar.style.width;
      vi.advanceTimersByTime(CONFIG.PLAYER.LIVE_PREVIEW_PROGRESS_MS - 1000);
      expect(bar.style.width).toBe(width);
      vi.advanceTimersByTime(1000);
      expect(bar.style.width).not.toBe(width);
      expect(morph).not.toHaveBeenCalled();
      expect(fit).not.toHaveBeenCalled();
    });

    it('counts the minutes left down on the minute', () => {
      const left = root.querySelector('.live-preview-remaining')!;
      expect(left.textContent).toContain('24');
      vi.advanceTimersByTime(60 * 1000);
      expect(left.textContent).toContain('23');
      expect(morph).not.toHaveBeenCalled();
    });

    it('re-renders and refits at a programme boundary', () => {
      vi.mocked(EpgService.getNowPlaying).mockReturnValue(program(24, 74, 'Program 2'));
      vi.mocked(EpgService.getUpcoming).mockReturnValue([program(74, 114, 'Program 3')]);
      vi.advanceTimersByTime(CONFIG.PLAYER.LIVE_PREVIEW_REFRESH_MS);
      expect(morph).toHaveBeenCalledOnce();
      expect(fit).toHaveBeenCalledOnce();
      expect(root.querySelector('.live-preview-title')?.textContent).toBe('Program 2');
    });

    it('re-renders when the status or the favorite changes', () => {
      liveSnapshot.mockImplementation(() => ({ ...state(), status: 'buffering' }));
      vi.advanceTimersByTime(CONFIG.PLAYER.LIVE_PREVIEW_REFRESH_MS);
      expect(root.querySelector('.live-preview-message')?.textContent).toContain('Connecting');
      favorite = true;
      vi.advanceTimersByTime(CONFIG.PLAYER.LIVE_PREVIEW_REFRESH_MS);
      expect(root.querySelector('.live-preview-favorite')).not.toBeNull();
      expect(morph).toHaveBeenCalledTimes(2);
    });
  });
});
