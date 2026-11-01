// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BufferingIndicator, type BufferingProbe } from './player-buffering';
import { CONFIG } from '../config';

const POLL = CONFIG.PLAYER.BUFFERING_POLL_MS;

describe('BufferingIndicator', () => {
  let container: HTMLElement;
  let state: BufferingProbe | null;
  let indicator: BufferingIndicator;
  const spinner = () => container.querySelector<HTMLElement>('.player-buffering')!;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    state = { currentTime: 0, paused: false, seeking: false };
    indicator = new BufferingIndicator(container, () => state && { ...state });
  });
  afterEach(() => {
    indicator.stop();
    vi.useRealTimers();
  });

  it('is a hidden cue, never a focus target', () => {
    expect(spinner().classList.contains('hidden')).toBe(true);
    expect(spinner().getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('[data-focusable], [data-key]')).toBeNull();
  });

  it('shows from a load until the clock moves', () => {
    indicator.expect();
    expect(indicator.visible).toBe(true);
    vi.advanceTimersByTime(POLL * 4);
    expect(indicator.visible).toBe(true);
    state!.currentTime = 0.3;
    vi.advanceTimersByTime(POLL);
    expect(indicator.visible).toBe(false);
  });

  it('shows through a seek until playback moves past its target', () => {
    state = { currentTime: 100, paused: false, seeking: false };
    vi.advanceTimersByTime(POLL);
    indicator.expect();
    state = { currentTime: 400, paused: false, seeking: true };
    vi.advanceTimersByTime(POLL * 3);
    expect(indicator.visible).toBe(true);
    // Landed, but no frame yet (webOS may send no `waiting` here).
    state.seeking = false;
    vi.advanceTimersByTime(POLL * 3);
    expect(indicator.visible).toBe(true);
    state.currentTime = 400.25;
    vi.advanceTimersByTime(POLL);
    expect(indicator.visible).toBe(false);
  });

  it('hides once a seek lands while paused', () => {
    state = { currentTime: 400, paused: true, seeking: true };
    indicator.expect();
    expect(indicator.visible).toBe(true);
    state.seeking = false;
    vi.advanceTimersByTime(POLL);
    expect(indicator.visible).toBe(false);
  });

  it('shows when playing video stops advancing for a second, and hides when it moves', () => {
    indicator.expect();
    state!.currentTime = 1;
    vi.advanceTimersByTime(POLL);
    expect(indicator.visible).toBe(false);
    vi.advanceTimersByTime(CONFIG.PLAYER.BUFFERING_FROZEN_MS - POLL * 2);
    expect(indicator.visible).toBe(false);
    vi.advanceTimersByTime(POLL * 2);
    expect(indicator.visible).toBe(true);
    state!.currentTime = 1.5;
    vi.advanceTimersByTime(POLL);
    expect(indicator.visible).toBe(false);
  });

  it('never shows for a paused video that stands still', () => {
    indicator.expect();
    indicator.playing();
    state!.paused = true;
    vi.advanceTimersByTime(CONFIG.PLAYER.BUFFERING_FROZEN_MS * 3);
    expect(indicator.visible).toBe(false);
  });

  it('hides on `playing`', () => {
    indicator.expect();
    indicator.playing();
    expect(indicator.visible).toBe(false);
  });

  it('hides and stops polling when there is nothing to watch', () => {
    indicator.expect();
    state = null;
    vi.advanceTimersByTime(POLL);
    expect(indicator.visible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
