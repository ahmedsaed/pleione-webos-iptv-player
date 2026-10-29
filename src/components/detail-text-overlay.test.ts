// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetailTextOverlay } from './detail-text-overlay';
import { Focus } from '../navigation/focus-scope';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DetailTextOverlay', () => {
  it('shows the full text escaped, holds the keys, and closes on Back', () => {
    const overlay = new DetailTextOverlay('prompt.test.plot');
    const onClose = vi.fn();
    overlay.show('Movie A', '<img src=x onerror=alert(1)>A long plot.', onClose);
    const el = document.querySelector('.detail-text-prompt')!;
    expect(el.querySelector('.detail-text-title')?.textContent).toBe('Movie A');
    expect(el.querySelector('.detail-text-body')?.textContent).toContain('A long plot.');
    expect(el.querySelector('img')).toBeNull();
    expect(Focus.owner()?.id).toBe('prompt.test.plot');

    overlay.handleAction('down');
    expect(overlay.visible).toBe(true);
    overlay.handleAction('back');
    expect(overlay.visible).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(Focus.owner()?.id).not.toBe('prompt.test.plot');
  });

  it('closes on OK and on a pointer click', () => {
    const overlay = new DetailTextOverlay('prompt.test.plot2');
    overlay.show('Movie A', 'Plot.', vi.fn());
    overlay.handleAction('select');
    expect(overlay.visible).toBe(false);
    overlay.show('Movie A', 'Plot.', vi.fn());
    document.querySelector<HTMLElement>('.detail-text-dialog')!.click();
    expect(overlay.visible).toBe(false);
  });
});
