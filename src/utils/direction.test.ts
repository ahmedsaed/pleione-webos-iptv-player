// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  inlineStart, isRtl, logicalAction, resetScrollModel, screenSide,
  scrollFromLeft, scrollStart, setScrollFromLeft, setScrollStart,
} from './direction';

// A 100px scroller over 400px of content, so it scrolls 300px. jsdom has no
// layout: the engine's scrollLeft is modeled for one of the two RTL models.
function scroller(model: 'negative' | 'default', direction: 'ltr' | 'rtl'): HTMLElement {
  const el = document.createElement('div');
  el.style.direction = direction;
  document.body.appendChild(el);
  Object.defineProperty(el, 'scrollWidth', { value: 400 });
  Object.defineProperty(el, 'clientWidth', { value: 100 });
  // The view's left edge, 0..300, stored physically.
  let left = direction === 'rtl' ? 300 : 0;
  Object.defineProperty(el, 'scrollLeft', {
    get: () => (direction === 'ltr' || model === 'default' ? left : left - 300),
    set: (value: number) => {
      const physical = direction === 'ltr' || model === 'default' ? value : value + 300;
      left = Math.max(0, Math.min(300, physical));
    },
  });
  return el;
}

function setDirection(dir: 'ltr' | 'rtl', model: 'negative' | 'default' = 'negative'): void {
  document.documentElement.dir = dir;
  document.documentElement.classList.toggle('q-rtl-scroll-default', model === 'default');
  resetScrollModel();
}

describe('direction', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('dir');
    document.documentElement.className = '';
    document.body.innerHTML = '';
    resetScrollModel();
    vi.restoreAllMocks();
  });

  it('keeps Left and Right as pressed in left to right', () => {
    setDirection('ltr');
    expect(isRtl()).toBe(false);
    expect(logicalAction('left')).toBe('left');
    expect(screenSide('right')).toBe('right');
    expect(inlineStart()).toBe('left');
  });

  it('turns Left and Right around in right to left, and nothing else', () => {
    setDirection('rtl');
    expect(isRtl()).toBe(true);
    expect(logicalAction('left')).toBe('right');
    expect(logicalAction('right')).toBe('left');
    expect(logicalAction('up')).toBe('up');
    expect(logicalAction('select')).toBe('select');
    expect(screenSide('left')).toBe('right');
    expect(inlineStart()).toBe('right');
  });

  for (const model of ['negative', 'default'] as const) {
    it(`reads and writes right-to-left offsets in the ${model} scrollLeft model`, () => {
      setDirection('rtl', model);
      const el = scroller(model, 'rtl');
      // A right-to-left scroller starts at its right edge.
      expect(scrollStart(el)).toBe(0);
      expect(scrollFromLeft(el)).toBe(300);
      setScrollStart(el, 120);
      expect(scrollStart(el)).toBe(120);
      expect(scrollFromLeft(el)).toBe(180);
      setScrollFromLeft(el, 0);
      expect(scrollStart(el)).toBe(300);
      // A relative step moves the view right in both models.
      el.scrollLeft += 50;
      expect(scrollFromLeft(el)).toBe(50);
    });
  }

  it('passes a left-to-right scroller through in a right-to-left document', () => {
    setDirection('rtl', 'default');
    const el = scroller('default', 'ltr');
    setScrollStart(el, 40);
    expect(el.scrollLeft).toBe(40);
    expect(scrollStart(el)).toBe(40);
    expect(scrollFromLeft(el)).toBe(40);
  });
});
