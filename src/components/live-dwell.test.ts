import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveDwell } from './live-dwell';

describe('LiveDwell', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retunes once focus rests on a row for the delay', () => {
    const retune = vi.fn();
    const dwell = new LiveDwell(800, retune);
    dwell.focus(4, null);
    vi.advanceTimersByTime(799);
    expect(retune).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(retune).toHaveBeenCalledWith(4);
    expect(dwell.waiting).toBeNull();
  });

  it('never tunes the rows that focus only passes through', () => {
    const retune = vi.fn();
    const dwell = new LiveDwell(800, retune);
    for (let row = 1; row <= 6; row++) {
      dwell.focus(row, null);
      vi.advanceTimersByTime(150);
    }
    vi.advanceTimersByTime(800);
    expect(retune).toHaveBeenCalledTimes(1);
    expect(retune).toHaveBeenCalledWith(6);
  });

  it('does not retune to the channel the preview already shows', () => {
    const retune = vi.fn();
    const dwell = new LiveDwell(800, retune);
    dwell.focus(2, null);
    dwell.focus(3, 3);
    vi.advanceTimersByTime(2000);
    expect(retune).not.toHaveBeenCalled();
  });

  it('keeps the wait when the same row is reported again', () => {
    const retune = vi.fn();
    const dwell = new LiveDwell(800, retune);
    dwell.focus(5, null);
    vi.advanceTimersByTime(500);
    dwell.focus(5, null);
    vi.advanceTimersByTime(300);
    expect(retune).toHaveBeenCalledWith(5);
  });

  it('cancels a pending retune', () => {
    const retune = vi.fn();
    const dwell = new LiveDwell(800, retune);
    dwell.focus(1, null);
    dwell.cancel();
    vi.advanceTimersByTime(2000);
    expect(retune).not.toHaveBeenCalled();
  });
});
