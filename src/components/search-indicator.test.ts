import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchIndicator } from './search-indicator';

describe('SearchIndicator', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows only after the delay', () => {
    const onShow = vi.fn();
    const indicator = new SearchIndicator(onShow, 200);
    indicator.set('searching');
    vi.advanceTimersByTime(199);
    expect(indicator.shown).toBeNull();
    expect(onShow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(indicator.shown).toBe('searching');
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('never shows for results that arrive within the delay', () => {
    const onShow = vi.fn();
    const indicator = new SearchIndicator(onShow, 200);
    indicator.set('searching');
    vi.advanceTimersByTime(150);
    indicator.set(null);
    vi.advanceTimersByTime(500);
    expect(indicator.shown).toBeNull();
    expect(onShow).not.toHaveBeenCalled();
  });

  it('hides as soon as the results or an empty answer render', () => {
    const indicator = new SearchIndicator(vi.fn(), 200);
    indicator.set('searching');
    vi.advanceTimersByTime(200);
    expect(indicator.shown).toBe('searching');
    indicator.set(null);
    expect(indicator.shown).toBeNull();
  });

  it('keeps one delay across typing, and follows the preparing state', () => {
    const onShow = vi.fn();
    const indicator = new SearchIndicator(onShow, 200);
    indicator.set('preparing');
    vi.advanceTimersByTime(120);
    indicator.set('preparing');
    vi.advanceTimersByTime(80);
    expect(indicator.shown).toBe('preparing');
    indicator.set('searching');
    expect(indicator.shown).toBe('searching');
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('starts over after a reset', () => {
    const onShow = vi.fn();
    const indicator = new SearchIndicator(onShow, 200);
    indicator.set('searching');
    indicator.reset();
    vi.advanceTimersByTime(300);
    expect(onShow).not.toHaveBeenCalled();
    indicator.set('searching');
    vi.advanceTimersByTime(200);
    expect(onShow).toHaveBeenCalledTimes(1);
  });
});
