// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Focus } from '../navigation/focus-scope';
import { LiveHeader } from './live-header';

let header: LiveHeader;
let view: HTMLElement;
let handlers: { onMode: ReturnType<typeof vi.fn>; onEdit: ReturnType<typeof vi.fn>; onLeave: ReturnType<typeof vi.fn> };

const focusedKey = () => header.element.querySelector<HTMLElement>('.focused')?.dataset.key ?? null;
const option = (mode: string) => header.element.querySelector<HTMLElement>(`[data-live-mode="${mode}"]`)!;

beforeEach(() => {
  document.body.innerHTML = '<div class="view" id="v"></div>';
  view = document.getElementById('v')!;
  handlers = { onMode: vi.fn(), onEdit: vi.fn(), onLeave: vi.fn() };
  header = new LiveHeader(handlers);
  Focus.install();
});

afterEach(() => {
  header.detach();
  Focus.uninstall();
});

describe('LiveHeader', () => {
  it('shows the title, the count, the mode switch, and the clock at the top of its view', () => {
    header.attach(view, 'list');
    header.setCount(150);
    expect(view.firstElementChild).toBe(header.element);
    expect(header.element.querySelector('.live-header-title')?.textContent).toBe('Live');
    expect(header.element.querySelector('.live-header-count')?.textContent).toBe('150 channels');
    expect(header.element.querySelector('.live-header-clock')?.textContent).toMatch(/^\d\d:\d\d$/);
    expect(option('list').classList.contains('active')).toBe(true);
    expect(option('list').getAttribute('aria-pressed')).toBe('true');
    // The Red key marks the mode it switches to.
    expect(option('guide').querySelector('.live-red-key')).not.toBeNull();
    expect(option('list').querySelector('.live-red-key')).toBeNull();
  });

  it('takes the keys on the current mode and moves along the controls', () => {
    header.attach(view, 'list');
    header.enter();
    Focus.flush();
    expect(Focus.owner()).toBe(header.focusScope);
    expect(focusedKey()).toBe('live-mode:list');
    header.handleAction('right');
    Focus.flush();
    expect(focusedKey()).toBe('live-mode:guide');
    header.handleAction('right');
    Focus.flush();
    expect(focusedKey()).toBe('live-mode:guide');
    header.handleAction('left');
    header.handleAction('left');
    Focus.flush();
    expect(focusedKey()).toBe('live-edit');
  });

  it('switches the mode on OK and gives the keys back without a leave', () => {
    header.attach(view, 'list');
    header.enter();
    header.handleAction('right');
    header.handleAction('select');
    expect(handlers.onMode).toHaveBeenCalledWith('guide');
    expect(handlers.onLeave).not.toHaveBeenCalled();
    expect(header.isActive).toBe(false);
  });

  it('returns to the content on Down, Back, or OK on the shown mode', () => {
    header.attach(view, 'list');
    for (const action of ['down', 'back', 'select'] as const) {
      header.enter();
      header.handleAction(action);
      expect(header.isActive).toBe(false);
    }
    expect(handlers.onLeave).toHaveBeenCalledTimes(3);
    expect(handlers.onMode).not.toHaveBeenCalled();
  });

  it('flips the mode with the Red key', () => {
    header.attach(view, 'guide');
    header.enter();
    header.handleAction('red');
    expect(handlers.onMode).toHaveBeenCalledWith('list');
  });

  it('offers editing only over the list', () => {
    header.attach(view, 'list');
    header.enter();
    header.handleAction('left');
    header.handleAction('select');
    expect(handlers.onEdit).toHaveBeenCalled();
    header.attach(view, 'guide');
    expect(header.element.querySelector('[data-key="live-edit"]')).toBeNull();
  });

  it('shows no count and no Edit while the channels load', () => {
    header.attach(view, 'list');
    header.setCount(null);
    expect(header.element.querySelector('.live-header-count')).toBeNull();
    expect(header.element.querySelector('[data-key="live-edit"]')).toBeNull();
    // Left from List has nowhere to go.
    header.enter();
    header.handleAction('left');
    Focus.flush();
    expect(focusedKey()).toBe('live-mode:list');
    header.leave(false);
    header.setCount(2);
    expect(header.element.querySelector('.live-header-count')?.textContent).toBe('2 channels');
    expect(header.element.querySelector('[data-key="live-edit"]')).not.toBeNull();
  });

  it('switches on a pointer click', () => {
    header.attach(view, 'guide');
    option('list').click();
    expect(handlers.onMode).toHaveBeenCalledWith('list');
  });
});
