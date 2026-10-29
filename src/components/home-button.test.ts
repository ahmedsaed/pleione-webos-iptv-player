// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HomeButton } from './home-button';

describe('HomeButton', () => {
  let onHome: ReturnType<typeof vi.fn>;
  let button: HomeButton;

  beforeEach(() => {
    document.body.innerHTML = '';
    onHome = vi.fn();
    button = new HomeButton(onHome);
  });

  it('is offered only on a section, and labeled Home', () => {
    const el = button.element;
    expect(el.getAttribute('aria-label')).toBe('Home');
    expect(el.hasAttribute('data-view')).toBe(false);
    button.showOn('movies');
    expect(el.getAttribute('data-view')).toBe('movies');
    button.showOn(null);
    expect(el.hasAttribute('data-view')).toBe(false);
  });

  it('goes Home on a click, self-activating and never taking focus or a ring', () => {
    const el = button.element;
    expect(el.hasAttribute('data-self-activate')).toBe(true);
    expect(el.hasAttribute('data-focusable')).toBe(false);
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    el.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });
});
